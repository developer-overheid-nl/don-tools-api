package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
)

var (
	// ErrKeycloakConfig is returned when required configuration is missing.
	ErrKeycloakConfig = errors.New("keycloak configuratie ontbreekt")
	// ErrKeycloakConflict indicates the client already exists.
	ErrKeycloakConflict = errors.New("keycloak client bestaat al")
	// ErrKeycloakUnauthorized indicates authorization failures.
	ErrKeycloakUnauthorized = errors.New("autorisatie voor keycloak mislukt")
)

// KeycloakService handles interactions with the Keycloak Admin API.
type KeycloakService struct {
	httpClient        *http.Client
	adminClientsURL   string
	tokenURL          string
	clientID          string
	clientSecret      string
	tokenRequestExtra map[string]string
}

// NewKeycloakService creates a new service with the given configuration.
func NewKeycloakService(httpClient *http.Client, adminClientsURL, tokenURL, clientID, clientSecret string) *KeycloakService {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &KeycloakService{
		httpClient:      httpClient,
		adminClientsURL: strings.TrimSpace(adminClientsURL),
		tokenURL:        strings.TrimSpace(tokenURL),
		clientID:        strings.TrimSpace(clientID),
		clientSecret:    strings.TrimSpace(clientSecret),
	}
}

// NewKeycloakServiceFromEnv constructs the service using environment variables.
func NewKeycloakServiceFromEnv() *KeycloakService {
	base := strings.TrimSpace(os.Getenv("KEYCLOAK_ADMIN_BASE_URL"))
	realm := strings.TrimSpace(os.Getenv("KEYCLOAK_REALM"))
	if realm == "" {
		realm = "don"
	}
	var adminURL string
	if base != "" {
		adminURL = strings.TrimSuffix(base, "/") + "/admin/realms/" + realm + "/clients"
	}
	return NewKeycloakService(nil, adminURL, os.Getenv("AUTH_TOKEN_URL"), os.Getenv("AUTH_CLIENT_ID"), os.Getenv("AUTH_CLIENT_SECRET"))
}

// CreateClient creates a new client in Keycloak using the admin API.
func (s *KeycloakService) CreateClient(ctx context.Context, input models.KeycloakClientInput) (*models.KeycloakClientResult, error) {
	if strings.TrimSpace(s.adminClientsURL) == "" {
		return nil, ErrKeycloakConfig
	}
	token, err := s.fetchToken(ctx)
	if err != nil {
		return nil, err
	}

	payload := buildKeycloakPayload(input)
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.adminClientsURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	respBody := strings.TrimSpace(string(data))

	switch resp.StatusCode {
	case http.StatusCreated, http.StatusNoContent:
		return &models.KeycloakClientResult{
			Status:   resp.StatusCode,
			Location: resp.Header.Get("Location"),
			Message:  "Keycloak client aangemaakt",
		}, nil
	case http.StatusConflict:
		return nil, ErrKeycloakConflict
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, ErrKeycloakUnauthorized
	default:
		if respBody == "" {
			respBody = resp.Status
		}
		return nil, fmt.Errorf("keycloak response %d: %s", resp.StatusCode, respBody)
	}
}

func (s *KeycloakService) fetchToken(ctx context.Context) (string, error) {
	if strings.TrimSpace(s.tokenURL) == "" || strings.TrimSpace(s.clientID) == "" || strings.TrimSpace(s.clientSecret) == "" {
		return "", ErrKeycloakConfig
	}
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", s.clientID)
	form.Set("client_secret", s.clientSecret)
	for k, v := range s.tokenRequestExtra {
		form.Set(k, v)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		return "", fmt.Errorf("token request status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	if strings.TrimSpace(tok.AccessToken) == "" {
		return "", errors.New("empty access_token in response")
	}
	return tok.AccessToken, nil
}

func buildKeycloakPayload(input models.KeycloakClientInput) map[string]any {
	payload := map[string]any{
		"clientId":                     input.ClientName,
		"enabled":                      true,
		"publicClient":                 true,
		"directAccessGrantsEnabled":    false,
		"standardFlowEnabled":          false,
		"serviceAccountsEnabled":       false,
		"authorizationServicesEnabled": false,
		"protocol":                     "openid-connect",
	}

	attributes := make(map[string]string)
	if email := strings.TrimSpace(input.Email); email != "" {
		attributes["email"] = email
	}
	if len(attributes) > 0 {
		payload["attributes"] = attributes
	}
	return payload
}
