// Copyright (c) 2023-2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

package common

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func getWithETag(handler http.Handler, method, ifNoneMatch string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "/matches/abc", nil)
	if ifNoneMatch != "" {
		request.Header.Set("If-None-Match", ifNoneMatch)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	return recorder
}

func TestConditionalGetTagsAndRepeatsUnchangedResponses(t *testing.T) {
	handler := ConditionalGetMiddleware(handlerWriting(seatViewSized()))

	first := getWithETag(handler, http.MethodGet, "")
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("first response carried no ETag")
	}
	if !strings.HasPrefix(etag, `W/"`) {
		t.Errorf("ETag = %q, want a weak tag", etag)
	}
	if first.Code != http.StatusOK || first.Body.Len() == 0 {
		t.Fatalf("first response = %d with %d bytes, want 200 with a body", first.Code, first.Body.Len())
	}

	second := getWithETag(handler, http.MethodGet, etag)
	if second.Code != http.StatusNotModified {
		t.Errorf("status = %d, want %d", second.Code, http.StatusNotModified)
	}
	if second.Body.Len() != 0 {
		t.Errorf("304 carried %d bytes, want none", second.Body.Len())
	}
	if got := second.Header().Get("ETag"); got != etag {
		t.Errorf("304 ETag = %q, want %q", got, etag)
	}
}

// The whole point is that a hand which has moved is never answered with 304.
func TestConditionalGetResendsWhenTheStateChanges(t *testing.T) {
	body := seatViewSized()
	first := getWithETag(ConditionalGetMiddleware(handlerWriting(body)), http.MethodGet, "")
	stale := first.Header().Get("ETag")

	moved := getWithETag(ConditionalGetMiddleware(handlerWriting(body+`{"seat":"S"}`)), http.MethodGet, stale)
	if moved.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", moved.Code, http.StatusOK)
	}
	if moved.Body.Len() == 0 {
		t.Error("changed state was answered without a body")
	}
	if moved.Header().Get("ETag") == stale {
		t.Error("changed state reused the previous ETag")
	}
}

// A command must always run; answering one from a cached copy would drop a
// player's move.
func TestConditionalGetIgnoresNonReadMethods(t *testing.T) {
	handler := ConditionalGetMiddleware(handlerWriting(seatViewSized()))

	first := getWithETag(handler, http.MethodGet, "")
	posted := getWithETag(handler, http.MethodPost, first.Header().Get("ETag"))

	if posted.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", posted.Code, http.StatusOK)
	}
	if posted.Body.Len() == 0 {
		t.Error("POST was answered without a body")
	}
	if got := posted.Header().Get("ETag"); got != "" {
		t.Errorf("POST carried ETag %q, want none", got)
	}
}

func TestConditionalGetLeavesErrorsAlone(t *testing.T) {
	handler := ConditionalGetMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"match not found"}`))
	}))

	response := getWithETag(handler, http.MethodGet, "*")
	if response.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if response.Body.String() != `{"message":"match not found"}` {
		t.Errorf("body = %q, want the handler's own", response.Body.String())
	}
	if got := response.Header().Get("ETag"); got != "" {
		t.Errorf("error response carried ETag %q, want none", got)
	}
}

// A seat view belongs to one player and one token; a shared cache must never
// be allowed to hand it to anyone else.
func TestConditionalGetMarksResponsesPrivate(t *testing.T) {
	response := getWithETag(ConditionalGetMiddleware(handlerWriting(seatViewSized())), http.MethodGet, "")
	if got := response.Header().Get("Cache-Control"); !strings.Contains(got, "private") {
		t.Errorf("Cache-Control = %q, want it to contain private", got)
	}
}

func TestETagMatches(t *testing.T) {
	etag := `W/"abc123"`
	for _, header := range []string{etag, `"abc123"`, "*", `W/"zzz", W/"abc123"`, ` W/"abc123" `} {
		if !etagMatches(header, etag) {
			t.Errorf("If-None-Match %q did not match %q", header, etag)
		}
	}
	for _, header := range []string{"", `W/"zzz"`, `"abc1234"`} {
		if etagMatches(header, etag) {
			t.Errorf("If-None-Match %q unexpectedly matched %q", header, etag)
		}
	}
}

// The two middlewares run together in production, so the combination is what
// has to behave: an unchanged poll costs headers, a changed one arrives gzipped
// and intact.
func TestConditionalGetComposesWithCompression(t *testing.T) {
	body := seatViewSized()
	handler := CompressionMiddleware(ConditionalGetMiddleware(handlerWriting(body)))

	request := httptest.NewRequest(http.MethodGet, "/matches/abc", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, request)

	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("compressed response carried no ETag")
	}
	if got := first.Header().Get("Content-Encoding"); got != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip", got)
	}

	repeat := httptest.NewRequest(http.MethodGet, "/matches/abc", nil)
	repeat.Header.Set("Accept-Encoding", "gzip")
	repeat.Header.Set("If-None-Match", etag)
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, repeat)

	if second.Code != http.StatusNotModified {
		t.Errorf("status = %d, want %d", second.Code, http.StatusNotModified)
	}
	if second.Body.Len() != 0 {
		t.Errorf("304 carried %d bytes, want none", second.Body.Len())
	}
	// A 304 must not claim an encoding it has no body to carry.
	if got := second.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("304 Content-Encoding = %q, want none", got)
	}
}
