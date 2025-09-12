package models

// ToolsParams bundelt query en body input voor POST/GET endpoints
// - OASUrl: query of body (JSON) parameter met de URL naar een OAS
// - OAS: JSON body met het volledige OpenAPI document (als alternatief voor OASUrl)
type ToolsParams struct {
	OASUrl string                 `json:"oasUrl,omitempty" query:"oasUrl" example:"https://example.com/openapi.yaml"`
	OAS    map[string]interface{} `json:"oas,omitempty"`
}
