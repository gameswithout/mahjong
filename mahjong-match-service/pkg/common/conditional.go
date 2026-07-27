// Copyright (c) 2023-2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

package common

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
)

// ConditionalGetMiddleware answers an unchanged seat view with 304 instead of
// resending it.
//
// Every seat polls its own view every few seconds, but a hand only advances
// when somebody acts — so while a player is deciding, each of the other three
// clients asks for and receives a body it already has, several kilobytes at a
// time over a cellular link. The tag is a hash of the bytes the handler
// produced, which costs a hash per request and saves the whole body whenever
// nothing moved.
//
// The tag is weak (`W/`): it marks semantic equivalence, not byte equality,
// which is the honest claim once the response may be compressed downstream.
// Being byte-derived also makes it safe by construction — different bytes can
// never share a tag, so the worst case is a missed 304 rather than a stale
// board.
func ConditionalGetMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Commands change state and must always be executed and answered in
		// full; only reads can be satisfied by "you already have this".
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			next.ServeHTTP(w, r)

			return
		}

		recorder := &conditionalWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)

		// Only a plain 200 is safely repeatable from a cached copy. Anything
		// else — an error, a redirect, a handler that already committed to its
		// own encoding — goes back untouched.
		if recorder.status != http.StatusOK || recorder.Header().Get("Content-Encoding") != "" {
			recorder.flush()

			return
		}

		etag := weakETag(recorder.body)
		w.Header().Set("ETag", etag)
		// The seat view is specific to one player and one bearer token, so it
		// must never be held in a shared cache. Private still permits the
		// conditional request this middleware exists to answer.
		w.Header().Set("Cache-Control", "private, no-cache")

		if etagMatches(r.Header.Get("If-None-Match"), etag) {
			// A 304 carries no body: net/http will not write one for this
			// status, and the client keeps what it already had.
			w.WriteHeader(http.StatusNotModified)

			return
		}

		recorder.flush()
	})
}

func weakETag(body []byte) string {
	sum := sha256.Sum256(body)

	// Half the digest is far more than enough to make an accidental collision
	// between two seat views impossible in practice, and keeps the header that
	// every poll carries in both directions short.
	return `W/"` + base64.RawURLEncoding.EncodeToString(sum[:16]) + `"`
}

// etagMatches implements the If-None-Match comparison this middleware needs:
// a comma-separated list of candidates, "*" matching anything present, and the
// weak-comparison rule that ignores the W/ prefix.
func etagMatches(header, etag string) bool {
	header = strings.TrimSpace(header)
	if header == "" {
		return false
	}
	if header == "*" {
		return true
	}
	for _, candidate := range strings.Split(header, ",") {
		if strings.EqualFold(trimWeak(candidate), trimWeak(etag)) {
			return true
		}
	}

	return false
}

func trimWeak(tag string) string {
	return strings.TrimPrefix(strings.TrimSpace(tag), "W/")
}

// conditionalWriter buffers a response so its bytes can be hashed before any
// of them are committed to the wire.
type conditionalWriter struct {
	http.ResponseWriter

	status  int
	body    []byte
	flushed bool
}

func (w *conditionalWriter) WriteHeader(status int) {
	if w.flushed {
		return
	}
	w.status = status
}

func (w *conditionalWriter) Write(data []byte) (int, error) {
	if w.flushed {
		return w.ResponseWriter.Write(data)
	}
	w.body = append(w.body, data...)

	return len(data), nil
}

// flush emits the buffered response unchanged. Calling it more than once is a
// no-op, so the caller can flush on any path without tracking which ran.
func (w *conditionalWriter) flush() {
	if w.flushed {
		return
	}
	w.flushed = true
	w.ResponseWriter.WriteHeader(w.status)
	if len(w.body) == 0 {
		return
	}
	_, _ = w.ResponseWriter.Write(w.body)
	w.body = nil
}
