package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gameswithout/mahjong/rulesengine"
	"github.com/gameswithout/mahjong/server/auth"
	"github.com/gameswithout/mahjong/server/match"
)

func main() {
	baseURL := firstNonEmpty(os.Getenv("AGS_BASE_URL"), os.Getenv("ACCELBYTE_BASE_URL"))
	namespace := firstNonEmpty(os.Getenv("AGS_NAMESPACE"), os.Getenv("ACCELBYTE_NAMESPACE"))
	if baseURL == "" || namespace == "" {
		log.Fatal("AGS_BASE_URL/ACCELBYTE_BASE_URL and AGS_NAMESPACE/ACCELBYTE_NAMESPACE are required")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","service":"walking-skeleton"}`))
	})
	eventLogPath := firstNonEmpty(os.Getenv("MATCH_RUNTIME_EVENT_LOG"), "tmp/match-events.jsonl")
	if directory := filepath.Dir(eventLogPath); directory != "." {
		if err := os.MkdirAll(directory, 0o750); err != nil {
			log.Fatalf("create match event-log directory: %v", err)
		}
	}
	eventStore, err := rulesengine.NewFileEventStore(eventLogPath)
	if err != nil {
		log.Fatalf("configure match event log: %v", err)
	}
	runtime := match.NewRuntime(eventStore, time.Now)
	mux.Handle("/ws", &match.Handler{
		Verifier: auth.AGSVerifier{
			BaseURL:    baseURL,
			Namespace:  namespace,
			HTTPClient: &http.Client{Timeout: 5 * time.Second},
		},
		Runtime: runtime,
	})

	address := firstNonEmpty(os.Getenv("MATCH_RUNTIME_ADDR"), ":8081")
	log.Printf("walking skeleton listening on %s", address)
	log.Printf("health: http://%s/healthz", address)
	log.Printf("websocket: ws://%s/ws", address)
	log.Printf("event log: %s", eventLogPath)
	if err := http.ListenAndServe(address, mux); err != nil {
		log.Fatal(err)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
