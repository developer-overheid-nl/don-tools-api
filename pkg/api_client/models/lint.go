package models

import "time"

// LintMessageInfo bevat detailinformatie over een lintmelding
type LintMessageInfo struct {
	ID            string `json:"id"`
	LintMessageID string `json:"lintMessageId,omitempty"`
	Message       string `json:"message"`
	Path          string `json:"path,omitempty"`
}

// LintMessage beschrijft één lintregel overtreding
type LintMessage struct {
	ID        string            `json:"id"`
	Code      string            `json:"code"`
	Severity  string            `json:"severity"`
	CreatedAt time.Time         `json:"createdAt"`
	Infos     []LintMessageInfo `json:"infos,omitempty"`
}

// LintResult is het resultaat van een lint-run
type LintResult struct {
	ID        string        `json:"id"`
	ApiID     string        `json:"apiId,omitempty"`
	Successes bool          `json:"successes"`
	Failures  int           `json:"failures"`
	Score     int           `json:"score"`
	Messages  []LintMessage `json:"messages"`
	CreatedAt time.Time     `json:"createdAt"`
}
