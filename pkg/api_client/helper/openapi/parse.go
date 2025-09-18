package openapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/google/uuid"
)

// spectralResult vertegenwoordigt één entry uit `spectral lint -f json`
type spectralResult struct {
	Code     string        `json:"code"`
	Message  string        `json:"message"`
	Path     []interface{} `json:"path"`
	Severity int           `json:"severity"`
	Source   string        `json:"source"`
}

func sevToString(sev int) string {
	switch sev { // spectral: 0=error,1=warn,2=info,3=hint
	case 0:
		return "error"
	case 1:
		return "warning"
	case 2:
		return "info"
	case 3:
		return "hint"
	default:
		return "unknown"
	}
}

// ParseOutput zet spectral JSON output om naar LintMessages
func ParseOutput(output string, now time.Time) []models.LintMessage {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return nil
	}

	var results []spectralResult
	if err := json.Unmarshal([]byte(trimmed), &results); err != nil {
		// Niet-JSON output: maak één melding met de ruwe tekst
		id := uuid.New().String()
		return []models.LintMessage{{
			ID:        id,
			Code:      "lint-output",
			Severity:  "info",
			CreatedAt: now,
			Infos: []models.LintMessageInfo{{
				ID:            uuid.New().String(),
				LintMessageID: id,
				Message:       trimmed,
			}},
		}}
	}

	var msgs []models.LintMessage
	for _, r := range results {
		id := uuid.New().String()
		// Bouw pad string
		var pathStr string
		if len(r.Path) > 0 {
			var parts []string
			for _, p := range r.Path {
				parts = append(parts, toString(p))
			}
			pathStr = strings.Join(parts, ".")
		}
		if pathStr == "" {
			pathStr = r.Source
		}
		msgs = append(msgs, models.LintMessage{
			ID:        id,
			Code:      r.Code,
			Severity:  sevToString(r.Severity),
			CreatedAt: now,
			Infos: []models.LintMessageInfo{{
				ID:            uuid.New().String(),
				LintMessageID: id,
				Message:       r.Message,
				Path:          pathStr,
			}},
		})
	}
	return msgs
}

func toString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		// JSON numbers decode to float64
		// strip .0 if integer
		if t == float64(int64(t)) {
			return strconvItoa(int(t))
		}
		return strings.TrimRight(strings.TrimRight(fmtFloat(t), "0"), ".")
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

func strconvItoa(i int) string  { return fmt.Sprintf("%d", i) }
func fmtFloat(f float64) string { return fmt.Sprintf("%f", f) }

func GetOASFromBody(body *models.OasInput) []byte {
	if body == nil {
		return nil
	}
	// 1) Voorkeur: URL ophalen als opgegeven
	if u := strings.TrimSpace(body.OasUrl); u != "" {
		if b, err := FetchURL(u); err == nil {
			return b
		}
		return nil
	}
	// 2) Fallback: body-string (JSON of YAML)
	if s := strings.TrimSpace(body.OasBody); s != "" {
		return []byte(s)
	}
	return nil
}

// FetchURL haalt de inhoud op van een URL met een korte timeout
func FetchURL(rawURL string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d bij ophalen van URL", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}
