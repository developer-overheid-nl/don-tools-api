package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/invopop/yaml"
)

// DereferenceService resolveert externe $ref verwijzingen naar één document
type DereferenceService struct {
	client *http.Client
}

// NewDereferenceService constructor
func NewDereferenceService() *DereferenceService {
	return &DereferenceService{
		client: &http.Client{Timeout: 20 * time.Second},
	}
}

// Dereference neemt een OpenAPI document als bytes en levert een volledig gedereferencede versie terug
func (s *DereferenceService) Dereference(ctx context.Context, oas []byte, source string) ([]byte, string, error) {
	trimmed := strings.TrimSpace(string(oas))
	if trimmed == "" {
		return nil, "", ErrEmptyOAS
	}

	var raw any
	if err := yaml.Unmarshal(oas, &raw); err != nil {
		return nil, "", fmt.Errorf("kon OpenAPI document niet parsen: %w", err)
	}

	normalized := normalizeYAML(raw)
	root, ok := normalized.(map[string]any)
	if !ok {
		return nil, "", fmt.Errorf("verwacht een object als root van het OpenAPI document")
	}

	resolver := newRefResolver(s.client)
	rootKey := "__root__"
	resolver.docs[rootKey] = root

	var baseURL *url.URL
	if sourceURL := strings.TrimSpace(source); sourceURL != "" {
		if parsed, err := url.Parse(sourceURL); err == nil && parsed.Scheme != "" {
			baseURL = parsed
			resolver.bases[rootKey] = parsed
		}
	}

	resolvedAny, err := resolver.resolveNode(ctx, root, rootKey, baseURL)
	if err != nil {
		return nil, "", err
	}

	resolved, ok := resolvedAny.(map[string]any)
	if !ok {
		return nil, "", fmt.Errorf("onverwachte structuur na dereferencing")
	}

	name := deriveDocumentName(resolved, baseURL)

	jsonBytes, err := json.Marshal(resolved)
	if err != nil {
		return nil, "", fmt.Errorf("kon gedereferencede output niet serialiseren: %w", err)
	}

	output, filename, err := DereferenceToPreferedFormat(jsonBytes, GuessExt(oas), name)
	if err != nil {
		return nil, "", err
	}

	return output, filename, nil
}

func DereferenceToPreferedFormat(output []byte, preferredExt, baseName string) ([]byte, string, error) {
	if baseName == "" {
		baseName = "openapi"
	}
	switch strings.ToLower(preferredExt) {
	case ".yaml", ".yml":
		yamlBytes, err := yaml.JSONToYAML(output)
		if err != nil {
			return nil, "", fmt.Errorf("kon JSON niet omzetten naar YAML: %w", err)
		}
		return yamlBytes, baseName + ".yaml", nil
	default:
		return output, baseName + ".json", nil
	}
}

// helper types
type refResolver struct {
	client    *http.Client
	docs      map[string]map[string]any
	bases     map[string]*url.URL
	resolving map[string]bool
}

func newRefResolver(client *http.Client) *refResolver {
	return &refResolver{
		client:    client,
		docs:      make(map[string]map[string]any),
		bases:     make(map[string]*url.URL),
		resolving: make(map[string]bool),
	}
}

func (r *refResolver) resolveNode(ctx context.Context, node any, docKey string, baseURL *url.URL) (any, error) {
	switch typed := node.(type) {
	case map[string]any:
		if refVal, ok := typed["$ref"]; ok {
			if refStr, ok := refVal.(string); ok && refStr != "" {
				resolved, targetKey, targetBase, err := r.resolveRef(ctx, refStr, docKey, baseURL)
				if err != nil {
					return nil, err
				}
				delete(typed, "$ref")
				if resolvedMap, ok := resolved.(map[string]any); ok {
					for k, v := range resolvedMap {
						typed[k] = v
					}
					return r.resolveNode(ctx, typed, targetKey, targetBase)
				}
				// primitive or array result
				if len(typed) == 0 {
					return resolved, nil
				}
				typed["value"] = resolved
				return r.resolveNode(ctx, typed, targetKey, targetBase)
			}
		}
		for key, val := range typed {
			resolved, err := r.resolveNode(ctx, val, docKey, baseURL)
			if err != nil {
				return nil, err
			}
			typed[key] = resolved
		}
		return typed, nil
	case []any:
		for i, elem := range typed {
			resolved, err := r.resolveNode(ctx, elem, docKey, baseURL)
			if err != nil {
				return nil, err
			}
			typed[i] = resolved
		}
		return typed, nil
	default:
		return node, nil
	}
}

func (r *refResolver) resolveRef(ctx context.Context, ref string, docKey string, baseURL *url.URL) (any, string, *url.URL, error) {
	ref = strings.TrimSpace(ref)
	parsed, err := url.Parse(ref)
	if err != nil {
		return nil, "", nil, fmt.Errorf("ongeldige $ref '%s': %w", ref, err)
	}

	var targetURL *url.URL
	if parsed.IsAbs() {
		targetURL = parsed
	} else if baseURL != nil {
		targetURL = baseURL.ResolveReference(parsed)
	} else {
		targetURL = parsed
	}

	fragment := targetURL.Fragment
	targetURL.Fragment = ""
	targetKey := docKey
	if targetURL.Scheme != "" || targetURL.Host != "" || targetURL.Path != "" {
		targetKey = targetURL.String()
	}

	var targetBase *url.URL
	if targetKey == docKey {
		targetBase = baseURL
	} else {
		targetBase = targetURL
	}

	doc, err := r.getDocument(ctx, targetKey, targetURL)
	if err != nil {
		return nil, "", nil, err
	}

	var value any = doc
	if fragment != "" {
		pointer := strings.TrimPrefix(fragment, "#")
		value, err = jsonPointerLookup(doc, pointer)
		if err != nil {
			return nil, "", nil, fmt.Errorf("kon fragment '%s' niet vinden: %w", fragment, err)
		}
	}

	copyValue := deepCopy(value)
	resolved, err := r.resolveNode(ctx, copyValue, targetKey, targetBase)
	if err != nil {
		return nil, "", nil, err
	}

	return resolved, targetKey, targetBase, nil
}

func (r *refResolver) getDocument(ctx context.Context, key string, u *url.URL) (map[string]any, error) {
	if doc, ok := r.docs[key]; ok {
		return doc, nil
	}
	if key == "__root__" {
		return nil, fmt.Errorf("root document niet geladen")
	}
	if u == nil || u.String() == "" {
		return nil, fmt.Errorf("kan $ref niet oplossen zonder basis URL")
	}

	if r.resolving[key] {
		if doc, ok := r.docs[key]; ok {
			return doc, nil
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kon %s niet ophalen: %w", u.String(), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return nil, fmt.Errorf("kon %s niet ophalen: status %d: %s", u.String(), resp.StatusCode, strings.TrimSpace(string(body)))
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var remote any
	if err := yaml.Unmarshal(data, &remote); err != nil {
		return nil, fmt.Errorf("kon externe referentie %s niet parsen: %w", u.String(), err)
	}

	normalized := normalizeYAML(remote)
	remoteMap, ok := normalized.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("externe referentie %s bevat geen object", u.String())
	}

	r.resolving[key] = true
	r.docs[key] = remoteMap
	r.bases[key] = u
	_, err = r.resolveNode(ctx, remoteMap, key, u)
	r.resolving[key] = false
	if err != nil {
		return nil, err
	}

	return remoteMap, nil
}

func normalizeYAML(value any) any {
	switch t := value.(type) {
	case map[any]any:
		m := make(map[string]any, len(t))
		for k, v := range t {
			m[fmt.Sprint(k)] = normalizeYAML(v)
		}
		return m
	case map[string]any:
		for k, v := range t {
			t[k] = normalizeYAML(v)
		}
		return t
	case []any:
		for i, v := range t {
			t[i] = normalizeYAML(v)
		}
		return t
	default:
		return value
	}
}

func deepCopy(value any) any {
	switch v := value.(type) {
	case map[string]any:
		copyMap := make(map[string]any, len(v))
		for k, val := range v {
			copyMap[k] = deepCopy(val)
		}
		return copyMap
	case []any:
		copySlice := make([]any, len(v))
		for i, val := range v {
			copySlice[i] = deepCopy(val)
		}
		return copySlice
	default:
		return v
	}
}

func jsonPointerLookup(doc any, pointer string) (any, error) {
	if pointer == "" {
		return doc, nil
	}
	segments := strings.Split(pointer, "/")
	current := doc
	for _, seg := range segments {
		if seg == "" {
			continue
		}
		seg = strings.ReplaceAll(seg, "~1", "/")
		seg = strings.ReplaceAll(seg, "~0", "~")
		switch typed := current.(type) {
		case map[string]any:
			var ok bool
			current, ok = typed[seg]
			if !ok {
				return nil, fmt.Errorf("pad '%s' niet gevonden", pointer)
			}
		case []any:
			idx, err := strconv.Atoi(seg)
			if err != nil || idx < 0 || idx >= len(typed) {
				return nil, fmt.Errorf("pad '%s' bevat ongeldige index", pointer)
			}
			current = typed[idx]
		default:
			return nil, fmt.Errorf("pad '%s' verwijst naar ongeldige structuur", pointer)
		}
	}
	return current, nil
}

func deriveDocumentName(doc map[string]any, base *url.URL) string {
	name := "openapi"
	if info, ok := doc["info"].(map[string]any); ok {
		if title, ok := info["title"].(string); ok {
			title = strings.TrimSpace(title)
			if title != "" {
				if safe := SanitizeFilename(title); safe != "" {
					name = safe
				}
			}
		}
	}
	if name == "openapi" && base != nil {
		if base.Path != "" {
			baseName := strings.TrimSuffix(path.Base(base.Path), path.Ext(base.Path))
			if safe := SanitizeFilename(baseName); safe != "" {
				name = safe
			}
		}
	}
	return name
}
