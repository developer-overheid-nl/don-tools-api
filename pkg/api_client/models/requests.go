package models

import "encoding/json"

// OASBody representeert een JSON envelope voor het OpenAPI document
type OASBody struct {
	OAS json.RawMessage `json:"oas,omitempty"`
	Raw json.RawMessage `json:"-"`
}

func (b *OASBody) UnmarshalJSON(p []byte) error {
	// 1) Probeer eerst envelope {oas, oasUrl}
	var env struct {
		OAS json.RawMessage `json:"oas"`
	}
	if err := json.Unmarshal(p, &env); err == nil && (len(env.OAS) > 0) {
		b.OAS = env.OAS
		if len(env.OAS) > 0 {
			b.Raw = env.OAS
		}
		return nil
	}

	// 2) Anders: beschouw de héle body als een “pure OAS” JSON
	if json.Valid(p) {
		var m map[string]any
		if err := json.Unmarshal(p, &m); err == nil {
			if _, ok := m["openapi"]; ok || m["swagger"] != nil || m["paths"] != nil {
				b.Raw = append([]byte(nil), p...) // kopie
				b.OAS = b.Raw
				return nil
			}
		}
	}

	// 3) Fallback: ook als het geen geldig JSON-object is, geef de bytes door
	b.Raw = append([]byte(nil), p...)
	b.OAS = b.Raw
	return nil
}
