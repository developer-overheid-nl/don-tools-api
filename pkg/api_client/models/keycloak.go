package models

// KeycloakClientInput represents the payload to create a Keycloak client.
type KeycloakClientInput struct {
	ClientName string `json:"clientName" binding:"required"`
	Email      string `json:"email" binding:"required,email"`
}

// KeycloakClientResult captures the outcome of creating a client.
type KeycloakClientResult struct {
	Status   int    `json:"status"`
	Location string `json:"location,omitempty"`
	Message  string `json:"message"`
}
