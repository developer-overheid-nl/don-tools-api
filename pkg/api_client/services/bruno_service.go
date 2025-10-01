package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/invopop/yaml"
)

// BrunoService implementeert BrunoServicer met de benodigde repository
type BrunoService struct{}

// NewBrunoService Constructor-functie
func NewBrunoService() *BrunoService {
	return &BrunoService{}
}

// ConvertOpenAPIToBruno converteert een OAS document (json/yaml) naar een Bruno collectie ZIP
// Retourneert de zip-bytes en een standaard bestandsnaam.
func (s *BrunoService) ConvertOpenAPIToBruno(oas []byte) ([]byte, string, error) {
	// Valideer input
	if len(strings.TrimSpace(string(oas))) == 0 {
		return nil, "", ErrEmptyOAS
	}
	if patched, err := sanitizeSecurityForBruno(oas); err == nil && len(patched) > 0 {
		oas = patched
	}
	// Schrijf OAS naar tijdelijk bestand
	workDir, err := os.MkdirTemp("", "oas2bruno-*")
	if err != nil {
		return nil, "", err
	}
	defer os.RemoveAll(workDir)

	ext := GuessExt(oas)
	inFile := filepath.Join(workDir, "openapi"+ext)
	if err := os.WriteFile(inFile, oas, 0o600); err != nil {
		return nil, "", err
	}

	outDir := filepath.Join(workDir, "out")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return nil, "", err
	}

	// Run: openapi-to-bruno generate <inFile> <outDir>
	if _, _, err := ExecConverter(2*time.Minute, "openapi-to-bruno", "generate", inFile, outDir); err != nil {
		return nil, "", fmt.Errorf("%w", err)
	}

	// Zip de output directory
	zipBytes, err := ZipDirectory(outDir)
	if err != nil {
		return nil, "", err
	}

	// Probeer naam af te leiden
	name := "bruno-collection"

	return zipBytes, name, nil
}

func sanitizeSecurityForBruno(oas []byte) ([]byte, error) {
	// 1) YAML → JSON indien nodig
	js := oas
	if !json.Valid(oas) {
		if j, err := yaml.YAMLToJSON(oas); err == nil {
			js = j
		}
	}

	var root map[string]any
	if err := json.Unmarshal(js, &root); err != nil {
		return oas, nil // geef origineel terug als we niets kunnen
	}

	// helpers
	getMap := func(v any) map[string]any { m, _ := v.(map[string]any); return m }
	needed := map[string]struct{}{}

	collect := func(sec any) {
		if arr, ok := sec.([]any); ok {
			for _, it := range arr {
				if m, ok := it.(map[string]any); ok {
					for name := range m {
						needed[name] = struct{}{}
					}
				}
			}
		}
	}

	// 2) verzamel alle verwezen schemes
	collect(root["security"])
	if paths := getMap(root["paths"]); len(paths) > 0 {
		for _, v := range paths {
			if pm, ok := v.(map[string]any); ok {
				for method, op := range pm {
					switch strings.ToLower(method) {
					case "get", "post", "put", "patch", "delete", "head", "options", "trace":
						if om, ok := op.(map[string]any); ok {
							collect(om["security"])
						}
					}
				}
			}
		}
	}

	// 3) initialiseers: components + securitySchemes
	comps, _ := root["components"].(map[string]any)
	if comps == nil {
		comps = map[string]any{}
		root["components"] = comps
	}
	schemes, _ := comps["securitySchemes"].(map[string]any)
	if schemes == nil {
		schemes = map[string]any{}
		comps["securitySchemes"] = schemes
	}

	// 4) voeg missende schemes toe (stubs)
	created := false
	for name := range needed {
		if _, ok := schemes[name]; ok {
			continue
		}
		created = true
		if strings.Contains(strings.ToLower(name), "key") {
			schemes[name] = map[string]any{
				"type": "apiKey", "in": "header", "name": "X-API-Key",
			}
		} else {
			schemes[name] = map[string]any{
				"type": "oauth2",
				"flows": map[string]any{
					"clientCredentials": map[string]any{
						"tokenUrl": "https://example.com/oauth/token",
						"scopes":   map[string]any{},
					},
				},
			}
		}
	}
	comps["securitySchemes"] = schemes

	// 5) fallback: als er wel referenties zijn maar we niets konden toevoegen, strip dan security
	if !created && len(needed) > 0 {
		delete(root, "security")
		if paths := getMap(root["paths"]); len(paths) > 0 {
			for pk, pv := range paths {
				if pm, ok := pv.(map[string]any); ok {
					for mk, mv := range pm {
						if om, ok := mv.(map[string]any); ok {
							delete(om, "security")
							pm[mk] = om
						}
					}
					paths[pk] = pm
				}
			}
			root["paths"] = paths
		}
	}

	out, err := json.Marshal(root)
	if err != nil {
		return oas, nil
	}
	return out, nil
}
