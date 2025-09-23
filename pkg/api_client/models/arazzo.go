package models

// ArazzoInput represents the payload for the Arazzo visualization endpoint.
type ArazzoInput struct {
	ArazzoUrl  string `json:"arazzoUrl,omitempty" binding:"omitempty,url"`
	ArazzoBody string `json:"arazzoBody,omitempty"`
	Output     string `json:"output,omitempty" binding:"omitempty,oneof=markdown mermaid both"`
}

// ArazzoVisualization holds the rendered Markdown and Mermaid snippets.
type ArazzoVisualization struct {
	Markdown string `json:"markdown,omitempty"`
	Mermaid  string `json:"mermaid,omitempty"`
}

type ArazzoDocument struct {
	Title       string
	Description string
	Flows       []ArazzoFlow
}

type ArazzoFlow struct {
	ID          string
	Summary     string
	Description string
	Steps       []ArazzoStep
}

type ArazzoStep struct {
	ID          string
	OperationID string
	Description string
	Outputs     []string
}

type RawArazzoSpec struct {
	Info struct {
		Title       string `yaml:"title"`
		Description string `yaml:"description"`
	} `yaml:"info"`
	Workflows []struct {
		WorkflowID  string `yaml:"workflowId"`
		Summary     string `yaml:"summary"`
		Description string `yaml:"description"`
		Steps       []struct {
			StepID      string                 `yaml:"stepId"`
			OperationID string                 `yaml:"operationId"`
			Description string                 `yaml:"description"`
			Outputs     map[string]interface{} `yaml:"outputs"`
		} `yaml:"steps"`
	} `yaml:"workflows"`
}
