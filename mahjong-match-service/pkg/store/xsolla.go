package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const FounderPackSKU = "og_founder_pack"

type Config struct {
	ProjectID      int
	MerchantID     int
	APIKey         string
	WebhookSecret  string
	SKU            string
	Sandbox        bool
	FulfillSandbox bool
	ReturnURL      string
}

func (c Config) Configured() bool {
	return c.ProjectID > 0 && c.MerchantID > 0 && c.APIKey != "" && c.WebhookSecret != ""
}
func (c Config) ProductSKU() string {
	if strings.TrimSpace(c.SKU) != "" {
		return strings.TrimSpace(c.SKU)
	}
	return FounderPackSKU
}

type XsollaClient struct {
	Config  Config
	HTTP    *http.Client
	BaseURL string
}

func (x XsollaClient) Checkout(ctx context.Context, userID, locale string) (string, error) {
	if !x.Config.Configured() {
		return "", fmt.Errorf("Xsolla checkout is not configured")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", fmt.Errorf("create checkout id: %w", err)
	}
	body := map[string]any{
		"sandbox":  x.Config.Sandbox,
		"user":     map[string]any{"id": map[string]any{"value": userID}},
		"purchase": map[string]any{"items": []map[string]any{{"sku": x.Config.ProductSKU(), "quantity": 1}}},
		"settings": map[string]any{"language": locale, "external_id": "founder-" + hex.EncodeToString(nonce[:]), "return_url": x.Config.ReturnURL},
	}
	raw, _ := json.Marshal(body)
	base := strings.TrimRight(x.BaseURL, "/")
	if base == "" {
		base = "https://store.xsolla.com/api"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/v3/project/"+strconv.Itoa(x.Config.ProjectID)+"/admin/payment/token", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(strconv.Itoa(x.Config.MerchantID), x.Config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := x.HTTP
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request Xsolla checkout: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("Xsolla checkout returned HTTP %d", res.StatusCode)
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil || payload.Token == "" {
		return "", fmt.Errorf("Xsolla checkout returned no token")
	}
	host := "https://secure.xsolla.com"
	if x.Config.Sandbox {
		host = "https://sandbox-secure.xsolla.com"
	}
	return host + "/paystation4/?token=" + payload.Token, nil
}
