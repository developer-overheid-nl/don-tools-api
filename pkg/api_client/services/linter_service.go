package services

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	vacuumModel "github.com/daveshanley/vacuum/model"
	"github.com/daveshanley/vacuum/motor"
	"github.com/daveshanley/vacuum/rulesets"
	openapiParser "github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/openapi"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/google/uuid"
	"github.com/invopop/yaml"
)

// LinterService lint OpenAPI documenten via Vacuum
type LinterService struct {
	vacuumOnce    sync.Once
	vacuumRuleSet *rulesets.RuleSet
	vacuumErr     error
}

func NewLinterService() *LinterService { return &LinterService{} }

//go:embed ruleset/adr-vacuum.yaml
var embeddedVacuumRuleset []byte

func (s *LinterService) loadVacuumRuleSet() (*rulesets.RuleSet, error) {
	s.vacuumOnce.Do(func() {
		if len(embeddedVacuumRuleset) == 0 {
			s.vacuumErr = fmt.Errorf("ingebedde vacuum ruleset ontbreekt")
			return
		}
		rsModel := rulesets.BuildDefaultRuleSets()
		userRS, err := rulesets.CreateRuleSetFromData(embeddedVacuumRuleset)
		if err != nil {
			s.vacuumErr = fmt.Errorf("kon vacuum ruleset niet parsen: %w", err)
			return
		}
		s.vacuumRuleSet = rsModel.GenerateRuleSetFromSuppliedRuleSet(userRS)
	})
	if s.vacuumErr != nil {
		return nil, s.vacuumErr
	}
	return s.vacuumRuleSet, nil
}

// LintBytes lint een OpenAPI document via vacuum en de ingesloten ADR ruleset
func (s *LinterService) LintBytes(ctx context.Context, oas []byte) (*models.LintResult, error) {
	start := time.Now()
	log.Printf("[linter] vacuum lint start size=%d", len(oas))
	defer func() {
		log.Printf("[linter] vacuum lint done duration=%s", time.Since(start))
	}()

	ruleSet, err := s.loadVacuumRuleSet()
	if err != nil {
		now := time.Now()
		res := &models.LintResult{
			ID:        uuid.New().String(),
			Successes: false,
			Failures:  1,
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

	deadlineTimeout := 5 * time.Second
	if deadline, ok := ctx.Deadline(); ok {
		if remaining := time.Until(deadline); remaining > 0 {
			deadlineTimeout = remaining
		}
	}

	execution := &motor.RuleSetExecution{
		RuleSet:           ruleSet,
		Spec:              oas,
		SpecFileName:      "body",
		AllowLookup:       true,
		Timeout:           deadlineTimeout,
		SkipDocumentCheck: false,
	}

	result := motor.ApplyRulesToRuleSet(execution)
	if len(result.Errors) > 0 {
		messages := make([]string, 0, len(result.Errors))
		for _, e := range result.Errors {
			if e != nil {
				messages = append(messages, e.Error())
			}
		}
		errMsg := strings.Join(messages, "; ")
		if errMsg == "" {
			errMsg = "vacuum lint failed"
		}
		err := errors.New(errMsg)
		return s.buildResult("", err, "body"), err
	}

	report := vacuumModel.NewRuleResultSet(result.Results).GenerateSpectralReport("body")
	jsonReport, err := json.Marshal(report)
	if err != nil {
		wrapErr := fmt.Errorf("vacuum report marshal: %w", err)
		return s.buildResult("", wrapErr, "body"), wrapErr
	}

	res := s.buildResult(string(jsonReport), nil, "body")
	if err := enrichWithManualChecks(res, oas); err != nil {
		log.Printf("[linter] kon aanvullende checks niet uitvoeren: %v", err)
	}
	return res, nil
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

var versionHeaderNames = []string{"API-Version", "Api-Version", "Api-version", "api-version", "API-version"}

func enrichWithManualChecks(res *models.LintResult, oas []byte) error {
	if res == nil {
		return nil
	}
	root, err := parseSpecToMap(oas)
	if err != nil {
		return err
	}
	paths, _ := root["paths"].(map[string]any)
	if len(paths) == 0 {
		return nil
	}
	existing := make(map[string]struct{}, len(res.Messages))
	for _, msg := range res.Messages {
		path := ""
		if len(msg.Infos) > 0 {
			path = msg.Infos[0].Path
		}
		existing[msg.Code+":"+path] = struct{}{}
	}
	var added bool
	for pathKey, pathVal := range paths {
		operations, ok := pathVal.(map[string]any)
		if !ok {
			continue
		}
		for methodKey, opVal := range operations {
			methodLower := strings.ToLower(methodKey)
			switch methodLower {
			case "get", "post", "put", "delete", "patch", "head", "options", "trace":
				operation, ok := opVal.(map[string]any)
				if !ok {
					continue
				}
				responses, ok := operation["responses"].(map[string]any)
				if !ok {
					continue
				}
				for status, respVal := range responses {
					if !isSuccessStatus(status) {
						continue
					}
					response, ok := normalizeAny(respVal).(map[string]any)
					if !ok {
						continue
					}
					headers, ok := response["headers"].(map[string]any)
					responsePath := fmt.Sprintf("paths.%s.%s.responses.%s", pathKey, methodLower, status)
					if !ok || headers == nil {
						key := "missing-header:" + responsePath
						if _, seen := existing[key]; !seen {
							res.Messages = append(res.Messages, newLintMessage("missing-header", responsePath, "/core/version-header: Return the full version number in a response header: https://logius-standaarden.github.io/API-Design-Rules/#/core/version-header"))
							existing[key] = struct{}{}
							added = true
						}
						continue
					}
					if !hasVersionHeader(headers) {
						key := "missing-version-header:" + responsePath
						if _, seen := existing[key]; !seen {
							res.Messages = append(res.Messages, newLintMessage("missing-version-header", responsePath, "Return the full version number in a response header"))
							existing[key] = struct{}{}
							added = true
						}
					}
				}
			}
		}
	}
	if added {
		errCount := 0
		for _, msg := range res.Messages {
			if strings.ToLower(msg.Severity) == "error" {
				errCount++
			}
		}
		res.Failures = errCount
		res.Score, _ = ComputeAdrScore(res.Messages)
		res.Successes = res.Score == 100
	}
	return nil
}

func newLintMessage(code, path, message string) models.LintMessage {
	msg := models.LintMessage{
		ID:        uuid.New().String(),
		Code:      code,
		Severity:  "error",
		CreatedAt: time.Now(),
	}
	info := models.LintMessageInfo{
		ID:      uuid.New().String(),
		Message: message,
		Path:    path,
	}
	msg.Infos = []models.LintMessageInfo{info}
	return msg
}

func hasVersionHeader(headers map[string]any) bool {
	for _, name := range versionHeaderNames {
		if _, ok := headers[name]; ok {
			return true
		}
	}
	return false
}

func isSuccessStatus(code string) bool {
	if len(code) == 0 {
		return false
	}
	if code == "default" {
		return false
	}
	status, err := strconv.Atoi(code)
	if err != nil {
		return false
	}
	return status >= 200 && status < 400
}

func parseSpecToMap(oas []byte) (map[string]any, error) {
	var doc any
	if err := json.Unmarshal(oas, &doc); err != nil {
		if err := yaml.Unmarshal(oas, &doc); err != nil {
			return nil, err
		}
	}
	normalized := normalizeAny(doc)
	root, ok := normalized.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("root van OpenAPI document is geen object")
	}
	return root, nil
}

func normalizeAny(value any) any {
	switch t := value.(type) {
	case map[any]any:
		m := make(map[string]any, len(t))
		for k, v := range t {
			m[fmt.Sprint(k)] = normalizeAny(v)
		}
		return m
	case map[string]any:
		for k, v := range t {
			t[k] = normalizeAny(v)
		}
		return t
	case []any:
		for i, v := range t {
			t[i] = normalizeAny(v)
		}
		return t
	default:
		return value
	}
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

// buildResult zet validator output + fouten om naar een LintResult incl. score
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

	filtered := msgs[:0]
	for _, m := range msgs {
		if strings.ToLower(m.Severity) == "error" {
			filtered = append(filtered, m)
		}
	}
	msgs = filtered

	var errCount int
	for range msgs {
		errCount++
	}
	score, _ := ComputeAdrScore(msgs)

	return &models.LintResult{
		ID:        uuid.New().String(),
		ApiID:     "",
		Successes: score == 100,
		Failures:  errCount,
		Score:     score,
		Messages:  msgs,
		CreatedAt: now,
	}
}
