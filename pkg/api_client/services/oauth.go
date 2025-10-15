package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// fetchClientCredentialsToken haalt een OAuth2 access token op via het client_credentials grant.
// missingConfig bepaalt welke fout wordt teruggegeven wanneer configuratie ontbreekt.
func fetchClientCredentialsToken(ctx context.Context, httpClient *http.Client, tokenURL, clientID, clientSecret string, missingConfig error) (string, error) {
	if strings.TrimSpace(tokenURL) == "" || strings.TrimSpace(clientID) == "" || strings.TrimSpace(clientSecret) == "" {
		if missingConfig != nil {
			return "", missingConfig
		}
		return "", errors.New("oauth configuratie ontbreekt")
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("token request %s -> %d: %s", tokenURL, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var tok struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("token parse error: %v; body=%s", err, string(body))
	}
	if strings.TrimSpace(tok.AccessToken) == "" {
		return "", errors.New("empty access_token in response")
	}
	return tok.AccessToken, nil
}
