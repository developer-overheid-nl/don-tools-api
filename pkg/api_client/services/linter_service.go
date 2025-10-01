package services

import (
	"context"
	_ "embed"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	openapiParser "github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/openapi"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/google/uuid"
)

const spectralRulesetEnv = "SPECTRAL_RULESET_PATH"

// LinterService wrapt het aanroepen van Spectral
type LinterService struct {
	// cachet het rulesetbestand zodat spectral niet bij elke request over het netwerk hoeft
	rulesetOnce sync.Once
	rulesetPath string
	rulesetErr  error
}

func NewLinterService() *LinterService { return &LinterService{} }

//go:embed ruleset/adr-ruleset.yaml
var embeddedRuleset []byte

func (s *LinterService) resolveRulesetPath() (string, error) {
	if env := strings.TrimSpace(os.Getenv(spectralRulesetEnv)); env != "" {
		return env, nil
	}

	s.rulesetOnce.Do(func() {
		if len(embeddedRuleset) == 0 {
			s.rulesetErr = fmt.Errorf("ingebedde spectral ruleset ontbreekt")
			return
		}
		f, err := os.CreateTemp("", "spectral-ruleset-*.yaml")
		if err != nil {
			s.rulesetErr = fmt.Errorf("kon tijdelijk ruleset-bestand niet maken: %w", err)
			return
		}
		if _, err := f.Write(embeddedRuleset); err != nil {
			_ = f.Close()
			s.rulesetErr = fmt.Errorf("kon ruleset niet schrijven: %w", err)
			return
		}
		if err := f.Close(); err != nil {
			s.rulesetErr = fmt.Errorf("kon ruleset-bestand niet sluiten: %w", err)
			return
		}
		s.rulesetPath = f.Name()
	})

	if s.rulesetErr != nil {
		return "", s.rulesetErr
	}
	if s.rulesetPath == "" {
		return "", fmt.Errorf("ruleset-pad niet beschikbaar")
	}
	return s.rulesetPath, nil
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

	rulesetPath, err := s.resolveRulesetPath()
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
					Message: err.Error(),
					Path:    "ruleset",
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
		"-r", rulesetPath,
		"-f", "json",
		f,
	)
	output, err := cmd.CombinedOutput()
	if _, ok := err.(*exec.ExitError); ok && len(output) > 0 {
		err = nil
	}

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
