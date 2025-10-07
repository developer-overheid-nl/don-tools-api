package models

// KeycloakClientInput represents the payload to create a Keycloak client.
type KeycloakClientInput struct {
	Email string `json:"email" binding:"required,email"`
}

// KeycloakClientResult captures the outcome of creating a client.
type KeycloakClientResult struct {
	APIKey string `json:"apiKey"`
}
