package services

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	openapiParser "github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/openapi"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/google/uuid"
)

// LinterService wrapt het aanroepen van Spectral
type LinterService struct{}

func NewLinterService() *LinterService { return &LinterService{} }

// LintURL lint een OpenAPI via URL en geeft een LintResult terug
func (s *LinterService) LintURL(ctx context.Context, url string) (*models.LintResult, error) {
	// Controleer dat spectral beschikbaar is
	if _, err := exec.LookPath("spectral"); err != nil {
		now := time.Now()
		res := &models.LintResult{
			ID:        uuid.New().String(),
			Successes: false,
			Failures:  1,
			Warnings:  0,
			Score:     0,
			Messages: []models.LintMessage{{
				ID:        uuid.New().String(),
				Code:      "lint-exec",
				Severity:  "error",
				CreatedAt: now,
				Infos: []models.LintMessageInfo{{
					ID:      uuid.New().String(),
					Message: fmt.Sprintf("spectral CLI niet gevonden: %v", err),
					Path:    url,
				}},
			}},
			CreatedAt: now,
		}
		return res, fmt.Errorf("spectral CLI niet gevonden: %w", err)
	}

	cmd := exec.CommandContext(
		ctx,
		"spectral", "lint",
		"-F", "error",
		"-D",
		"-r", "https://static.developer.overheid.nl/adr/2.1/ruleset.yaml",
		"-f", "json",
		url,
	)
	output, err := cmd.CombinedOutput()
	// Bouw resultaat
	return s.buildResult(string(output), err, url), err
}

// LintBytes lint een OpenAPI document uit bytes door via een tijdelijk bestand te linten
func (s *LinterService) LintBytes(ctx context.Context, oas []byte) (*models.LintResult, error) {
	if _, err := exec.LookPath("spectral"); err != nil {
		now := time.Now()
		res := &models.LintResult{
			ID:        uuid.New().String(),
			Successes: false,
			Failures:  1,
			Warnings:  0,
			Score:     0,
			Messages: []models.LintMessage{{
				ID:        uuid.New().String(),
				Code:      "lint-exec",
				Severity:  "error",
				CreatedAt: now,
				Infos: []models.LintMessageInfo{{
					ID:      uuid.New().String(),
					Message: fmt.Sprintf("spectral CLI niet gevonden: %v", err),
					Path:    "body",
				}},
			}},
			CreatedAt: now,
		}
		return res, fmt.Errorf("spectral CLI niet gevonden: %w", err)
	}

	dir, err := os.MkdirTemp("", "oaslint-*")
	if err != nil {
		now := time.Now()
		res := &models.LintResult{
			ID:        uuid.New().String(),
			Successes: false,
			Failures:  1,
			Warnings:  0,
			Score:     0,
			Messages: []models.LintMessage{{
				ID:        uuid.New().String(),
				Code:      "lint-exec",
				Severity:  "error",
				CreatedAt: now,
				Infos: []models.LintMessageInfo{{
					ID:      uuid.New().String(),
					Message: fmt.Sprintf("kon tijdelijke map niet maken: %v", err),
					Path:    "body",
				}},
			}},
			CreatedAt: now,
		}
		return res, err
	}
	defer os.RemoveAll(dir)

	ext := GuessExt(oas)
	f := filepath.Join(dir, "openapi"+ext)
	if err := os.WriteFile(f, oas, 0o600); err != nil {
		now := time.Now()
		res := &models.LintResult{
			ID:        uuid.New().String(),
			Successes: false,
			Failures:  1,
			Warnings:  0,
			Score:     0,
			Messages: []models.LintMessage{{
				ID:        uuid.New().String(),
				Code:      "lint-exec",
				Severity:  "error",
				CreatedAt: now,
				Infos: []models.LintMessageInfo{{
					ID:      uuid.New().String(),
					Message: fmt.Sprintf("kon tijdelijk bestand niet schrijven: %v", err),
					Path:    f,
				}},
			}},
			CreatedAt: now,
		}
		return res, err
	}

	cmd := exec.CommandContext(
		ctx,
		"spectral", "lint",
		"-F", "error",
		"-D",
		"-r", "https://static.developer.overheid.nl/adr/2.1/ruleset.yaml",
		"-f", "json",
		f,
	)
	output, err := cmd.CombinedOutput()
	return s.buildResult(string(output), err, "body"), err
}

// measuredRules zijn de regels die meetellen voor de ADR score
var measuredRules = map[string]struct{}{
	"openapi3":                     {},
	"openapi-root-exists":          {},
	"missing-version-header":       {},
	"missing-header":               {},
	"include-major-version-in-uri": {},
	"paths-no-trailing-slash":      {},
	"info-contact-fields-exist":    {},
	"http-methods":                 {},
	"semver":                       {},
}

// ComputeAdrScore berekent de ADR score en retourneert ook de gefaalde regels
func ComputeAdrScore(msgs []models.LintMessage) (score int, failed []string) {
	failedSet := map[string]struct{}{}
	for _, m := range msgs {
		if strings.ToLower(m.Severity) != "error" {
			continue
		}
		if _, ok := measuredRules[m.Code]; ok {
			failedSet[m.Code] = struct{}{}
		}
	}
	for k := range failedSet {
		failed = append(failed, k)
	}
	sort.Strings(failed)

	total := len(measuredRules)
	if total == 0 {
		return 100, failed
	}
	score = int(math.Round((1 - float64(len(failed))/float64(total)) * 100))
	return score, failed
}

// buildResult zet spectral output + fouten om naar een LintResult incl. score
func (s *LinterService) buildResult(output string, lintErr error, sourcePath string) *models.LintResult {
	now := time.Now()
	var msgs []models.LintMessage
	trimmed := strings.TrimSpace(output)
	if trimmed == "" && lintErr != nil {
		msgID := uuid.New().String()
		msgs = []models.LintMessage{{
			ID:        msgID,
			Code:      "lint-exec",
			Severity:  "error",
			CreatedAt: now,
			Infos: []models.LintMessageInfo{{
				ID:            uuid.New().String(),
				LintMessageID: msgID,
				Message:       lintErr.Error(),
				Path:          sourcePath,
			}},
		}}
	} else {
		msgs = openapiParser.ParseOutput(trimmed, now)
	}

	var errCount, warnCount int
	for _, m := range msgs {
		switch strings.ToLower(m.Severity) {
		case "error":
			errCount++
		case "warning":
			warnCount++
		}
	}
	score, _ := ComputeAdrScore(msgs)
	log.Printf("[lint] messages=%d errors=%d warnings=%d score=%d", len(msgs), errCount, warnCount, score)

	return &models.LintResult{
		ID:        uuid.New().String(),
		ApiID:     "",
		Successes: score == 100,
		Failures:  errCount,
		Warnings:  warnCount,
		Score:     score,
		Messages:  msgs,
		CreatedAt: now,
	}
}
