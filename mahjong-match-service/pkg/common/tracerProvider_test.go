package common

import (
	"context"
	"testing"
)

func TestNewTracerProvider_AllowsDisabledExporter(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_ZIPKIN_ENDPOINT", "")
	provider, err := NewTracerProvider("mahjong-match-service-test")
	if err != nil {
		t.Fatalf("NewTracerProvider() error = %v", err)
	}
	if provider == nil {
		t.Fatal("NewTracerProvider() returned nil")
	}
	if err := provider.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
}
