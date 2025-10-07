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
	"github.com/google/uuid"
)

var (
	// ErrKeycloakConfig is returned when required configuration is missing.
	ErrKeycloakConfig = errors.New("keycloak configuratie ontbreekt")
	// ErrKeycloakConflict indicates the client already exists.
	ErrKeycloakConflict = errors.New("keycloak client bestaat al")
	// ErrKeycloakUnauthorized indicates authorization failures.
	ErrKeycloakUnauthorized = errors.New("autorisatie voor keycloak mislukt")
)

const keycloakClientDescription = "Dit is een read only api key, meer info: https://developer.overheid.nl/"

// KeycloakService handles interactions with the Keycloak Admin API.
type KeycloakService struct {
	httpClient      *http.Client
	adminClientsURL string
	tokenURL        string
	clientID        string
	clientSecret    string
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
	base := strings.TrimSpace(os.Getenv("KEYCLOAK_BASE_URL"))
	realm := strings.TrimSpace(os.Getenv("KEYCLOAK_REALM"))
	var adminURL, tokenURL string
	if base != "" {
		b := strings.TrimSuffix(base, "/")
		adminURL = fmt.Sprintf("%s/admin/realms/%s/clients", b, url.PathEscape(realm))
		tokenURL = fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", base, url.PathEscape(realm))
	}

	return NewKeycloakService(nil,
		adminURL,
		tokenURL,
		os.Getenv("AUTH_CLIENT_ID"),
		os.Getenv("AUTH_CLIENT_SECRET"),
	)
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

	clientID := uuid.New().String()
	payload := buildKeycloakPayload(clientID, input.Email)
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
			APIKey: clientID,
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
	if s.tokenURL == "" || s.clientID == "" || s.clientSecret == "" {
		return "", ErrKeycloakConfig
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", s.clientID)
	form.Set("client_secret", s.clientSecret)

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

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("token request %s -> %d: %s", s.tokenURL, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var tok struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("token parse error: %v; body=%s", err, string(body))
	}
	if tok.AccessToken == "" {
		return "", errors.New("empty access_token in response")
	}
	return tok.AccessToken, nil
}

func buildKeycloakPayload(clientID, email string) map[string]any {
	payload := map[string]any{
		"clientId":                     clientID,
		"name":                         clientID,
		"enabled":                      true,
		"publicClient":                 true,
		"directAccessGrantsEnabled":    false,
		"standardFlowEnabled":          false,
		"serviceAccountsEnabled":       false,
		"authorizationServicesEnabled": false,
		"protocol":                     "openid-connect",
		"description":                  keycloakClientDescription,
	}

	attributes := make(map[string]string)
	if trimmed := strings.TrimSpace(email); trimmed != "" {
		attributes["email"] = trimmed
	}
	if len(attributes) > 0 {
		payload["attributes"] = attributes
	}
	return payload
}
