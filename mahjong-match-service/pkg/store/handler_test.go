package store

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type memoryRepo struct {
	owned              bool
	fulfilled, revoked string
}

func (m *memoryRepo) HasStoreEntitlement(context.Context, string, string) (bool, error) {
	return m.owned, nil
}
func (m *memoryRepo) FulfillStoreOrder(_ context.Context, order, user, sku string, _ bool) error {
	m.owned = true
	m.fulfilled = order + ":" + user + ":" + sku
	return nil
}
func (m *memoryRepo) RevokeStoreOrder(_ context.Context, order string) error {
	m.owned = false
	m.revoked = order
	return nil
}

func signed(body, secret string) string {
	h := sha1.New()
	h.Write([]byte(body))
	h.Write([]byte(secret))
	return "Signature " + hex.EncodeToString(h.Sum(nil))
}

func TestOrderPaidFulfillsFounderPackAfterSignatureVerification(t *testing.T) {
	repo := &memoryRepo{}
	h := &Handler{Config: Config{WebhookSecret: "secret", SKU: FounderPackSKU, FulfillSandbox: true}, Repo: repo}
	body := `{"notification_type":"order_paid","order":{"id":123,"mode":"sandbox"},"user":{"external_id":"ags-user"},"items":[{"sku":"og_founder_pack","quantity":1}]}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/xsolla", strings.NewReader(body))
	req.Header.Set("Authorization", signed(body, "secret"))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	if repo.fulfilled != "123:ags-user:og_founder_pack" {
		t.Fatalf("fulfillment = %q", repo.fulfilled)
	}
}

func TestWebhookRejectsInvalidSignature(t *testing.T) {
	repo := &memoryRepo{}
	h := &Handler{Config: Config{WebhookSecret: "secret"}, Repo: repo}
	req := httptest.NewRequest(http.MethodPost, "/webhooks/xsolla", strings.NewReader(`{"notification_type":"order_paid"}`))
	req.Header.Set("Authorization", "Signature wrong")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", res.Code)
	}
	if repo.owned {
		t.Fatal("invalid webhook granted entitlement")
	}
}

func TestStatusUsesAuthenticatedUser(t *testing.T) {
	repo := &memoryRepo{owned: true}
	h := &Handler{Config: Config{}, Repo: repo, Authenticate: func(*http.Request) (string, error) { return "ags-user", nil }}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/v1/namespaces/ns/store/founder-pack", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"owned":true`) {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
}
