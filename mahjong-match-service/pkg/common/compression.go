// Copyright (c) 2023-2025 AccelByte Inc. All Rights Reserved.
// This is licensed software from AccelByte Inc, for limitations
// and restrictions contact your company contract manager.

package common

import (
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

// minCompressibleBytes is the response size below which gzip is not worth it:
// the gzip header and trailer cost about 20 bytes, and small bodies here are
// error envelopes and acknowledgements that barely compress. Match state, the
// body that actually matters, is 4-10 KB and compresses by roughly 88%.
const minCompressibleBytes = 512

var gzipWriterPool = sync.Pool{
	New: func() any {
		// BestSpeed, not BestCompression: match state is polled continuously by
		// every seat, so per-request CPU is the constrained resource, and the
		// difference between levels on JSON this repetitive is a few percent.
		writer, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed)
		return writer
	},
}

// CompressionMiddleware gzips responses for clients that ask for it. The match
// client polls whole seat views over cellular links, where the response body
// is the dominant cost of playing a hand; neither the gRPC-gateway marshaler
// nor the Extend ingress compresses on its own.
func CompressionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Vary is required whether or not this particular response ends up
		// compressed, so a shared cache never hands a gzipped body to a client
		// that did not ask for one.
		w.Header().Add("Vary", "Accept-Encoding")
		if !acceptsGzip(r.Header.Get("Accept-Encoding")) {
			next.ServeHTTP(w, r)

			return
		}

		writer := &gzipResponseWriter{ResponseWriter: w}
		defer writer.Close()
		next.ServeHTTP(writer, r)
	})
}

// acceptsGzip reports whether the client offered gzip. A "gzip;q=0" offer is
// an explicit refusal, so it is not treated as support.
func acceptsGzip(header string) bool {
	for _, encoding := range strings.Split(header, ",") {
		parts := strings.Split(strings.TrimSpace(encoding), ";")
		if !strings.EqualFold(strings.TrimSpace(parts[0]), "gzip") {
			continue
		}
		for _, parameter := range parts[1:] {
			if strings.EqualFold(strings.ReplaceAll(strings.TrimSpace(parameter), " ", ""), "q=0") {
				return false
			}
		}

		return true
	}

	return false
}

// gzipResponseWriter defers the compress-or-not decision until it has seen
// enough of the body to know whether compressing is worthwhile. Everything
// written before that point is buffered, so a handler that finishes below the
// threshold still gets its bytes through uncompressed.
type gzipResponseWriter struct {
	http.ResponseWriter

	status    int
	buffered  []byte
	gzip      *gzip.Writer
	decided   bool
	compress  bool
	wroteHead bool
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.wroteHead {
		return
	}
	// Hold the status until the body decides on encoding — Content-Encoding
	// has to be set before the header goes out.
	w.status = status
}

func (w *gzipResponseWriter) Write(data []byte) (int, error) {
	if w.decided {
		if w.compress {
			return w.gzip.Write(data)
		}

		return w.ResponseWriter.Write(data)
	}

	w.buffered = append(w.buffered, data...)
	if len(w.buffered) < minCompressibleBytes {
		return len(data), nil
	}
	if err := w.begin(true); err != nil {
		return 0, err
	}

	return len(data), nil
}

// begin commits to an encoding, emits the header, and flushes whatever was
// buffered while the decision was pending.
func (w *gzipResponseWriter) begin(compress bool) error {
	w.decided = true
	// A handler that set its own Content-Encoding (or is streaming an already
	// compressed payload) must be left alone.
	if w.ResponseWriter.Header().Get("Content-Encoding") != "" {
		compress = false
	}
	w.compress = compress

	if compress {
		w.ResponseWriter.Header().Set("Content-Encoding", "gzip")
		// The buffered length is the uncompressed length, which would now be
		// wrong; net/http sets the correct framing once it is gone.
		w.ResponseWriter.Header().Del("Content-Length")
	}

	w.wroteHead = true
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.ResponseWriter.WriteHeader(w.status)

	if !compress {
		if len(w.buffered) == 0 {
			return nil
		}
		_, err := w.ResponseWriter.Write(w.buffered)
		w.buffered = nil

		return err
	}

	writer, _ := gzipWriterPool.Get().(*gzip.Writer)
	writer.Reset(w.ResponseWriter)
	w.gzip = writer
	if len(w.buffered) == 0 {
		return nil
	}
	_, err := w.gzip.Write(w.buffered)
	w.buffered = nil

	return err
}

// Close finishes the response. A handler that wrote less than the threshold
// (or nothing at all) reaches the decision point only here.
func (w *gzipResponseWriter) Close() {
	if !w.decided {
		_ = w.begin(false)
	}
	if w.gzip == nil {
		return
	}
	_ = w.gzip.Close()
	w.gzip.Reset(nil)
	gzipWriterPool.Put(w.gzip)
	w.gzip = nil
}

// Flush keeps streaming handlers working. Anything still buffered has to be
// committed first, otherwise a flush would emit nothing.
func (w *gzipResponseWriter) Flush() {
	if !w.decided {
		_ = w.begin(len(w.buffered) >= minCompressibleBytes)
	}
	if w.gzip != nil {
		_ = w.gzip.Flush()
	}
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
