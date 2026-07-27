// Copyright (c) 2023-2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

package common

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// seatViewSized stands in for a marshaled seat view: several kilobytes of
// repetitive JSON, which is what the middleware exists to shrink.
func seatViewSized() string {
	return strings.Repeat(`{"id":"bamboo-3-1","kind":"bamboo","rank":3,"copy":1},`, 200)
}

func handlerWriting(body string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	})
}

func TestCompressionMiddlewareCompressesLargeResponses(t *testing.T) {
	body := seatViewSized()
	request := httptest.NewRequest(http.MethodGet, "/matches/abc", nil)
	request.Header.Set("Accept-Encoding", "gzip, deflate, br")
	recorder := httptest.NewRecorder()

	CompressionMiddleware(handlerWriting(body)).ServeHTTP(recorder, request)

	result := recorder.Result()
	defer result.Body.Close()

	if got := result.Header.Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := result.Header.Get("Vary"); !strings.Contains(got, "Accept-Encoding") {
		t.Errorf("Vary = %q, want it to contain Accept-Encoding", got)
	}

	reader, err := gzip.NewReader(result.Body)
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	defer reader.Close()

	decompressed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read decompressed body: %v", err)
	}
	if string(decompressed) != body {
		t.Errorf("decompressed body does not round-trip: got %d bytes, want %d", len(decompressed), len(body))
	}
	if recorder.Body.Len() >= len(body) {
		t.Errorf("compressed body is %d bytes, no smaller than the %d-byte original", recorder.Body.Len(), len(body))
	}
}

func TestCompressionMiddlewareSkipsClientsThatDidNotAskForGzip(t *testing.T) {
	body := seatViewSized()
	for _, header := range []string{"", "identity", "br", "gzip;q=0"} {
		request := httptest.NewRequest(http.MethodGet, "/matches/abc", nil)
		if header != "" {
			request.Header.Set("Accept-Encoding", header)
		}
		recorder := httptest.NewRecorder()

		CompressionMiddleware(handlerWriting(body)).ServeHTTP(recorder, request)

		result := recorder.Result()
		if got := result.Header.Get("Content-Encoding"); got != "" {
			t.Errorf("Accept-Encoding %q: Content-Encoding = %q, want none", header, got)
		}
		if recorder.Body.String() != body {
			t.Errorf("Accept-Encoding %q: body was altered", header)
		}
		result.Body.Close()
	}
}

// Below the threshold gzip costs more than it saves, and the body still has to
// arrive intact.
func TestCompressionMiddlewarePassesSmallResponsesThrough(t *testing.T) {
	body := `{"message":"match not found"}`
	request := httptest.NewRequest(http.MethodGet, "/matches/abc", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()

	CompressionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(body))
	})).ServeHTTP(recorder, request)

	result := recorder.Result()
	defer result.Body.Close()

	if got := result.Header.Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want none for a short body", got)
	}
	if result.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want %d", result.StatusCode, http.StatusNotFound)
	}
	if recorder.Body.String() != body {
		t.Errorf("body = %q, want %q", recorder.Body.String(), body)
	}
}

// A handler that only sets a status (CORS preflight, 204s) must still produce
// exactly that status and an empty body.
func TestCompressionMiddlewarePreservesEmptyResponses(t *testing.T) {
	request := httptest.NewRequest(http.MethodOptions, "/matches/abc", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()

	CompressionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, request)

	result := recorder.Result()
	defer result.Body.Close()

	if result.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want %d", result.StatusCode, http.StatusNoContent)
	}
	if recorder.Body.Len() != 0 {
		t.Errorf("body = %q, want empty", recorder.Body.String())
	}
	if got := result.Header.Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want none", got)
	}
}

// The status a handler chose has to survive the deferred header write.
func TestCompressionMiddlewarePreservesStatusOnCompressedResponses(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/matches/abc", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()

	CompressionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(seatViewSized()))
	})).ServeHTTP(recorder, request)

	result := recorder.Result()
	defer result.Body.Close()

	if result.StatusCode != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", result.StatusCode, http.StatusInternalServerError)
	}
	if got := result.Header.Get("Content-Encoding"); got != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip", got)
	}
}

// Many small writes that add up past the threshold have to compress without
// losing the bytes buffered before the decision point.
func TestCompressionMiddlewareBuffersIncrementalWrites(t *testing.T) {
	chunk := strings.Repeat("a", 64)
	request := httptest.NewRequest(http.MethodGet, "/matches/abc", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()

	CompressionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for i := 0; i < 40; i++ {
			_, _ = w.Write([]byte(chunk))
		}
	})).ServeHTTP(recorder, request)

	result := recorder.Result()
	defer result.Body.Close()

	if got := result.Header.Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}

	reader, err := gzip.NewReader(result.Body)
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	defer reader.Close()

	decompressed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read decompressed body: %v", err)
	}
	if want := strings.Repeat(chunk, 40); string(decompressed) != want {
		t.Errorf("decompressed %d bytes, want %d", len(decompressed), len(want))
	}
}
