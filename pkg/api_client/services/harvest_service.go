package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
)

const (
	// Defaults for PDOK-like sources
	defaultUISuffix = "ui/"
	defaultOASPath  = "openapi.json"
)

// HarvesterService haalt index.json op, leidt OAS-URLs af en post naar een register endpoint
type HarvesterService struct {
	httpClient       *http.Client
	registerEndpoint string
}

// NewHarvesterService maakt een nieuwe service met een verplicht register endpoint
func NewHarvesterService(registerEndpoint string) *HarvesterService {
	return &HarvesterService{
		httpClient:       &http.Client{Timeout: 30 * time.Second},
		registerEndpoint: registerEndpoint,
	}
}

// NewHarvesterServiceFromEnv leest het endpoint uit env.
// PDOK_REGISTER_ENDPOINT bepaalt het POST endpoint per omgeving.
func NewHarvesterServiceFromEnv() *HarvesterService {
	reg := strings.TrimSpace(os.Getenv("PDOK_REGISTER_ENDPOINT"))
	if reg == "" {
		reg = "https://api.don.apps.digilab.network/api-register/v1/apis"
	}
	return NewHarvesterService(reg)
}

// RunOnce voert een harvest uit voor één bron
func (s *HarvesterService) RunOnce(ctx context.Context, src models.HarvestSource) error {
	if strings.TrimSpace(s.registerEndpoint) == "" {
		return errors.New("register endpoint is not configured")
	}
	if strings.TrimSpace(src.IndexURL) == "" {
		return errors.New("source indexUrl is empty")
	}

	// Fetch index
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src.IndexURL, nil)
	if err != nil {
		return err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return fmt.Errorf("unexpected status %d from index: %s", resp.StatusCode, string(b))
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	hrefs, err := extractIndexHrefs(body)
	if err != nil {
		return err
	}
	if len(hrefs) == 0 {
		return nil
	}

	uiSuffix := src.UISuffix
	if strings.TrimSpace(uiSuffix) == "" {
		uiSuffix = defaultUISuffix
	}
	oasPath := src.OASPath
	if strings.TrimSpace(oasPath) == "" {
		oasPath = defaultOASPath
	}

	for _, href := range hrefs {
		oasURL := deriveOASURLWith(href, uiSuffix, oasPath)
		payload := models.ApiPost{
			OasUrl:          oasURL,
			OrganisationUri: src.OrganisationUri,
			Contact:         src.Contact,
		}
		fmt.Printf("Payload: %+v\n", payload)
		if err := s.postAPI(ctx, payload); err != nil {
			return fmt.Errorf("post %s failed: %w", oasURL, err)
		}
	}
	return nil
}

// postAPI stuurt de registratie-payload naar het geconfigureerde endpoint
func (s *HarvesterService) postAPI(ctx context.Context, payload models.ApiPost) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.registerEndpoint, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return nil
}

// deriveOASURLWith bepaalt de OAS-URL op basis van href, uiSuffix en oasPath
func deriveOASURLWith(href, uiSuffix, oasPath string) string {
	h := strings.TrimSpace(href)
	sfx := strings.TrimSpace(uiSuffix)
	if sfx == "" {
		sfx = defaultUISuffix
	}
	op := strings.TrimSpace(oasPath)
	if op == "" {
		op = defaultOASPath
	}
	// normaliseer suffix: zonder leading slash en met trailing slash
	if !strings.HasSuffix(sfx, "/") {
		sfx = sfx + "/"
	}
	if strings.HasSuffix(h, sfx) {
		return strings.TrimSuffix(h, sfx) + op
	}
	if strings.HasSuffix(h, "/"+strings.TrimSuffix(sfx, "/")) { // ook varianten zonder slash
		return strings.TrimSuffix(h, "/"+strings.TrimSuffix(sfx, "/")) + "/" + op
	}
	if strings.HasSuffix(h, "/") {
		return h + op
	}
	return h + "/" + op
}

// extractIndexHrefs parseert verschillende mogelijke vormen van index.json en retourneert hrefs
func extractIndexHrefs(data []byte) ([]string, error) {
	type linkObj struct {
		Href string `json:"href"`
	}
	type apiEntryFlexible struct {
		Links json.RawMessage `json:"links"`
	}
	type root struct {
		Apis []apiEntryFlexible `json:"apis"`
	}

	var r root
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("parse index.json: %w", err)
	}

	var out []string
	for _, e := range r.Apis {
		// 1) links als array van objecten
		var arr []linkObj
		if err := json.Unmarshal(e.Links, &arr); err == nil {
			for _, l := range arr {
				if strings.TrimSpace(l.Href) != "" {
					out = append(out, l.Href)
				}
			}
			continue
		}
		// 2) links als enkel object
		var obj linkObj
		if err := json.Unmarshal(e.Links, &obj); err == nil {
			if strings.TrimSpace(obj.Href) != "" {
				out = append(out, obj.Href)
			}
		}
	}
	return out, nil
}
