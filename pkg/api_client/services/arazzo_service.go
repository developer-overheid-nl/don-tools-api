package services

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/invopop/yaml"
)

var (
	// ErrEmptyArazzo is returned when the incoming Arazzo document contains no content.
	ErrEmptyArazzo = errors.New("leeg Arazzo document (geen inhoud)")
	// ErrInvalidArazzoSpec is returned when parsing the document fails or it misses required fields.
	ErrInvalidArazzoSpec = errors.New("ongeldige Arazzo specificatie")
)

// ArazzoVizService provides helpers to render human-readable output for OpenAPI Arazzo.
type ArazzoVizService struct{}

// NewArazzoVizService creates a new instance of the Arazzo visualization service.
func NewArazzoVizService() *ArazzoVizService {
	return &ArazzoVizService{}
}

// Visualize converts an Arazzo specification (YAML or JSON) into markdown and/or mermaid output.
func (s *ArazzoVizService) Visualize(spec []byte) (string, string, error) {
	trimmed := strings.TrimSpace(string(spec))
	if trimmed == "" {
		return "", "", ErrEmptyArazzo
	}

	doc, err := parseArazzoSpec([]byte(trimmed))
	if err != nil {
		return "", "", err
	}

	var mermaid = buildMermaid(doc)
	var markdown = buildMarkdown(doc)

	return markdown, mermaid, nil
}

func parseArazzoSpec(data []byte) (*models.ArazzoDocument, error) {
	var raw models.RawArazzoSpec
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidArazzoSpec, err)
	}
	if len(raw.Workflows) == 0 {
		return nil, ErrInvalidArazzoSpec
	}

	doc := &models.ArazzoDocument{
		Title:       strings.TrimSpace(raw.Info.Title),
		Description: strings.TrimSpace(raw.Info.Description),
	}
	if doc.Title == "" {
		doc.Title = "Arazzo document"
	}

	for _, wf := range raw.Workflows {
		flow := models.ArazzoFlow{
			ID:          strings.TrimSpace(wf.WorkflowID),
			Summary:     strings.TrimSpace(wf.Summary),
			Description: strings.TrimSpace(wf.Description),
		}
		for _, st := range wf.Steps {
			step := models.ArazzoStep{
				ID:          strings.TrimSpace(st.StepID),
				OperationID: strings.TrimSpace(st.OperationID),
				Description: strings.TrimSpace(st.Description),
			}
			if len(st.Outputs) > 0 {
				names := make([]string, 0, len(st.Outputs))
				for name := range st.Outputs {
					if t := strings.TrimSpace(name); t != "" {
						names = append(names, t)
					}
				}
				sort.Strings(names)
				step.Outputs = names
			}
			if step.ID == "" && step.OperationID == "" && step.Description == "" && len(step.Outputs) == 0 {
				continue
			}
			flow.Steps = append(flow.Steps, step)
		}
		if len(flow.Steps) > 0 {
			doc.Flows = append(doc.Flows, flow)
		}
	}
	if len(doc.Flows) == 0 {
		return nil, ErrInvalidArazzoSpec
	}
	return doc, nil
}

var mermaidIDSanitizer = regexp.MustCompile(`[^a-zA-Z0-9_]`)

func sanitizeMermaidID(base string, offset int, used map[string]struct{}) string {
	candidate := strings.TrimSpace(base)
	if candidate == "" {
		candidate = fmt.Sprintf("step_%d", offset)
	}
	candidate = strings.ToLower(candidate)
	candidate = mermaidIDSanitizer.ReplaceAllString(candidate, "_")
	candidate = strings.Trim(candidate, "_")
	if candidate == "" {
		candidate = fmt.Sprintf("step_%d", offset)
	}
	if candidate[0] >= '0' && candidate[0] <= '9' {
		candidate = "s_" + candidate
	}
	original := candidate
	suffix := 2
	for {
		if _, exists := used[candidate]; !exists {
			used[candidate] = struct{}{}
			return candidate
		}
		candidate = fmt.Sprintf("%s_%d", original, suffix)
		suffix++
	}
}

func escapeMermaidText(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.ReplaceAll(s, "\"", "\\\"")
}

func buildMermaid(doc *models.ArazzoDocument) string {
	var b strings.Builder
	b.WriteString("---\n")
	if doc.Title != "" {
		b.WriteString("title: " + escapeMermaidText(doc.Title) + "\n")
	}
	b.WriteString("---\n")
	b.WriteString("graph TD\n")

	used := make(map[string]struct{})
	idx := 0
	for flowIdx, flow := range doc.Flows {
		title := flow.ID
		if title == "" && flow.Summary != "" {
			title = flow.Summary
		}
		if title == "" {
			title = fmt.Sprintf("workflow_%d", flowIdx+1)
		}
		b.WriteString("subgraph " + escapeMermaidText(title) + "\n")

		var prevNode string
		for stepIdx, step := range flow.Steps {
			nodeID := sanitizeMermaidID(step.ID, idx, used)
			idx++

			label := step.ID
			if label == "" {
				label = stepTitle(step)
			}
			if step.OperationID != "" {
				label = fmt.Sprintf("%s (%s)", label, step.OperationID)
			}
			b.WriteString(fmt.Sprintf("%s[\"%s\"]\n", nodeID, escapeMermaidText(label)))

			if stepIdx > 0 && prevNode != "" {
				b.WriteString(fmt.Sprintf("%s ---> %s\n", prevNode, nodeID))
			}
			prevNode = nodeID
		}
		b.WriteString("end\n")
	}
	return b.String()
}

func buildMarkdown(doc *models.ArazzoDocument) string {
	var b strings.Builder

	b.WriteString("## " + doc.Title + "\n\n")
	if doc.Description != "" {
		b.WriteString(doc.Description + "\n\n")
	}

	for _, flow := range doc.Flows {
		heading := flow.ID
		if heading == "" && flow.Summary != "" {
			heading = flow.Summary
		}
		if heading == "" {
			heading = "Workflow"
		}
		b.WriteString("### Workflow: " + heading + "\n\n")
		if flow.Description != "" {
			b.WriteString(flow.Description + "\n\n")
		}

		for i, step := range flow.Steps {
			b.WriteString(fmt.Sprintf("#### %d: %s\n\n", i+1, stepTitle(step)))
			if step.Description != "" {
				b.WriteString(step.Description + "\n\n")
			}
			if step.OperationID != "" {
				b.WriteString(fmt.Sprintf("- Operation: `%s`\n", step.OperationID))
			}
			if len(step.Outputs) > 0 {
				b.WriteString("- Outputs: " + strings.Join(step.Outputs, ", ") + "\n")
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

func stepTitle(step models.ArazzoStep) string {
	if step.ID != "" {
		return step.ID
	}
	if step.OperationID != "" {
		return step.OperationID
	}
	return "Stap"
}
