package store

import (
	"context"
	"crypto/sha1" // Xsolla's webhook protocol requires SHA-1 over raw body + secret.
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

type Repository interface {
	HasStoreEntitlement(context.Context, string, string) (bool, error)
	FulfillStoreOrder(context.Context, string, string, string, bool) error
	RevokeStoreOrder(context.Context, string) error
}

type Authenticate func(*http.Request) (string, error)

type Handler struct {
	Config       Config
	Client       XsollaClient
	Repo         Repository
	Authenticate Authenticate
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/webhooks/xsolla") {
		h.webhook(w, r)
		return
	}
	if !strings.Contains(r.URL.Path, "/store/founder-pack") {
		http.NotFound(w, r)
		return
	}
	userID, err := h.Authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Authentication required.")
		return
	}
	if strings.HasSuffix(r.URL.Path, "/checkout") {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var input struct {
			Locale string `json:"locale"`
		}
		_ = json.NewDecoder(r.Body).Decode(&input)
		url, err := h.Client.Checkout(r.Context(), userID, input.Locale)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"checkout_url": url})
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	owned, err := h.Repo.HasStoreEntitlement(r.Context(), userID, h.Config.ProductSKU())
	if err != nil {
		writeError(w, 500, "Store ownership could not be checked.")
		return
	}
	writeJSON(w, 200, map[string]any{"sku": h.Config.ProductSKU(), "owned": owned, "checkout_available": h.Config.Configured(), "sandbox": h.Config.Sandbox})
}

func (h *Handler) webhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, 400, "Invalid request.")
		return
	}
	if !validSignature(raw, r.Header.Get("Authorization"), h.Config.WebhookSecret) {
		writeError(w, 400, "Invalid signature.")
		return
	}
	var event struct {
		NotificationType string `json:"notification_type"`
		Order            struct {
			ID   json.RawMessage `json:"id"`
			Mode string          `json:"mode"`
		} `json:"order"`
		User struct {
			ExternalID string `json:"external_id"`
			ID         string `json:"id"`
		} `json:"user"`
		Items []struct {
			SKU      string `json:"sku"`
			Quantity int    `json:"quantity"`
		} `json:"items"`
	}
	if json.Unmarshal(raw, &event) != nil {
		writeError(w, 400, "Invalid request.")
		return
	}
	if event.NotificationType == "user_validation" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	orderID := strings.Trim(string(event.Order.ID), "\"")
	if orderID == "" || orderID == "null" {
		writeError(w, 400, "Invalid order.")
		return
	}
	if event.NotificationType == "order_canceled" {
		if h.Repo.RevokeStoreOrder(r.Context(), orderID) != nil {
			writeError(w, 500, "Could not revoke order.")
			return
		}
		w.WriteHeader(204)
		return
	}
	if event.NotificationType != "order_paid" {
		w.WriteHeader(204)
		return
	}
	userID := event.User.ExternalID
	if userID == "" {
		userID = event.User.ID
	}
	for _, item := range event.Items {
		if item.SKU == h.Config.ProductSKU() && item.Quantity > 0 {
			sandbox := event.Order.Mode == "sandbox"
			if !sandbox || h.Config.FulfillSandbox {
				if h.Repo.FulfillStoreOrder(r.Context(), orderID, userID, item.SKU, sandbox) != nil {
					writeError(w, 500, "Could not fulfill order.")
					return
				}
			}
		}
	}
	w.WriteHeader(204)
}

func validSignature(raw []byte, authorization, secret string) bool {
	provided := strings.TrimSpace(strings.TrimPrefix(authorization, "Signature "))
	h := sha1.New()
	_, _ = h.Write(raw)
	_, _ = h.Write([]byte(secret))
	expected := hex.EncodeToString(h.Sum(nil))
	return secret != "" && len(provided) == len(expected) && subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}
