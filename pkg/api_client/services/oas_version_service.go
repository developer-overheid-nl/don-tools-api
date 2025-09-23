package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/invopop/yaml"
)

const jsonSchemaDialectBase = "https://spec.openapis.org/oas/3.1/dialect/base"

var (
	// ErrUnsupportedOASVersion wordt geretourneerd wanneer de openapi-versie niet wordt ondersteund.
	ErrUnsupportedOASVersion = errors.New("openapi versie niet ondersteund voor conversie")
	// ErrVersionFieldMissing wordt geretourneerd als het openapi veld ontbreekt of leeg is.
	ErrVersionFieldMissing = errors.New("openapi versieveld ontbreekt of is ongeldig")
)

// OASVersionService verzorgt conversies tussen OpenAPI 3.0 en 3.1.
type OASVersionService struct{}

// NewOASVersionService maakt een nieuwe service aan.
func NewOASVersionService() *OASVersionService {
	return &OASVersionService{}
}

// ConvertVersion zet een OpenAPI specificatie om van 3.0 naar 3.1 of omgekeerd.
// De output volgt het oorspronkelijke formaat (JSON of YAML).
func (s *OASVersionService) ConvertVersion(oas []byte) ([]byte, string, error) {
	trimmed := strings.TrimSpace(string(oas))
	if trimmed == "" {
		return nil, "", ErrEmptyOAS
	}

	isJSON := json.Valid([]byte(trimmed))

	var working []byte
	var err error
	if isJSON {
		working = []byte(trimmed)
	} else {
		working, err = yaml.YAMLToJSON([]byte(trimmed))
		if err != nil {
			return nil, "", fmt.Errorf("kan YAML niet naar JSON omzetten: %w", err)
		}
	}

	var spec map[string]any
	if err := json.Unmarshal(working, &spec); err != nil {
		return nil, "", fmt.Errorf("kan OpenAPI specificatie niet parseren: %w", err)
	}

	rawVersion := strings.TrimSpace(fmt.Sprint(spec["openapi"]))
	if rawVersion == "" {
		return nil, "", ErrVersionFieldMissing
	}

	var targetVersion string
	switch {
	case strings.HasPrefix(rawVersion, "3.0"):
		targetVersion = "3.1.0"
		convertSchemas30To31(spec)
		if _, exists := spec["jsonSchemaDialect"]; !exists {
			spec["jsonSchemaDialect"] = jsonSchemaDialectBase
		}
		if webhooks, has := spec["x-webhooks"]; has {
			if _, exists := spec["webhooks"]; !exists {
				spec["webhooks"] = webhooks
			}
			delete(spec, "x-webhooks")
		}
	case strings.HasPrefix(rawVersion, "3.1"):
		targetVersion = "3.0.3"
		convertSchemas31To30(spec)
		delete(spec, "jsonSchemaDialect")
		if webhooks, has := spec["webhooks"]; has {
			if _, exists := spec["x-webhooks"]; !exists {
				spec["x-webhooks"] = webhooks
			}
			delete(spec, "webhooks")
		}
	default:
		return nil, "", ErrUnsupportedOASVersion
	}

	spec["openapi"] = targetVersion

	marshaled, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		return nil, "", fmt.Errorf("kan OpenAPI niet serialiseren: %w", err)
	}

	filename := fmt.Sprintf("openapi-%s", strings.ReplaceAll(targetVersion, ".", "-"))

	if isJSON {
		return marshaled, filename + ".json", nil
	}

	yamlBytes, err := yaml.JSONToYAML(marshaled)
	if err != nil {
		return nil, "", fmt.Errorf("kan JSON niet naar YAML omzetten: %w", err)
	}

	return yamlBytes, filename + ".yaml", nil
}

func convertSchemas30To31(node any) {
	switch v := node.(type) {
	case map[string]any:
		for key, val := range v {
			convertSchemas30To31(val)
			v[key] = val
		}
		if nullable, ok := v["nullable"].(bool); ok && nullable {
			mergeTypeWithNull(v)
			delete(v, "nullable")
		}
	case []any:
		for i, item := range v {
			convertSchemas30To31(item)
			v[i] = item
		}
	}
}

func convertSchemas31To30(node any) {
	switch v := node.(type) {
	case map[string]any:
		for key, val := range v {
			convertSchemas31To30(val)
			v[key] = val
		}
		if constVal, hasConst := v["const"]; hasConst {
			if _, hasEnum := v["enum"]; !hasEnum {
				v["enum"] = []any{constVal}
			}
			delete(v, "const")
		}
		normalizeTypeArray(v)
		normalizeEnumNull(v)
	case []any:
		for i, item := range v {
			convertSchemas31To30(item)
			v[i] = item
		}
	}
}

func mergeTypeWithNull(m map[string]any) {
	switch current := m["type"].(type) {
	case string:
		if current == "" {
			m["type"] = []any{"null"}
		} else {
			m["type"] = []any{current, "null"}
		}
	case []any:
		for _, t := range current {
			if s, ok := t.(string); ok && s == "null" {
				return
			}
		}
		m["type"] = append(current, "null")
	case nil:
		m["type"] = []any{"null"}
	default:
		m["type"] = []any{"null"}
	}
}

func normalizeTypeArray(m map[string]any) {
	arr, ok := m["type"].([]any)
	if !ok {
		return
	}

	var filtered []any
	hasNull := false
	for _, item := range arr {
		if s, ok := item.(string); ok && s == "null" {
			hasNull = true
			continue
		}
		if item != nil {
			filtered = append(filtered, item)
		}
	}

	if hasNull {
		m["nullable"] = true
	}

	switch len(filtered) {
	case 0:
		delete(m, "type")
	case 1:
		m["type"] = filtered[0]
	default:
		m["type"] = filtered
	}
}

func normalizeEnumNull(m map[string]any) {
	values, ok := m["enum"].([]any)
	if !ok {
		return
	}

	var filtered []any
	hasNull := false
	for _, item := range values {
		if item == nil {
			hasNull = true
			continue
		}
		filtered = append(filtered, item)
	}

	if hasNull {
		m["nullable"] = true
	}

	if len(filtered) == 0 {
		delete(m, "enum")
		return
	}

	if len(filtered) != len(values) {
		m["enum"] = filtered
	}
}
