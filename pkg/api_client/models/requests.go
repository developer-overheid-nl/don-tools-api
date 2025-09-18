package models

// OasInput representeert de body voor POST endpoints
// Eén van de velden moet gezet zijn: ofwel oasUrl, ofwel oasBody.
type OasInput struct {
	OasUrl  string `json:"oasUrl,omitempty" binding:"omitempty,url"`
	OasBody string `json:"oasBody,omitempty"`
}
