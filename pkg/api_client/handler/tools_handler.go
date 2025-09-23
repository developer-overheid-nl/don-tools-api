package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/openapi"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/problem"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/services"
	"github.com/gin-gonic/gin"
)

type ToolsController struct {
	Bruno     *services.BrunoService
	Postman   *services.PostmanService
	Linter    *services.LinterService
	Converter *services.OASVersionService
	Arazzo    *services.ArazzoVizService
}

func NewToolsController(bruno *services.BrunoService, postman *services.PostmanService, linter *services.LinterService, converter *services.OASVersionService, arazzo *services.ArazzoVizService) *ToolsController {
	return &ToolsController{Bruno: bruno, Postman: postman, Linter: linter, Converter: converter, Arazzo: arazzo}
}

/* ------------------------- LINT ------------------------- */

// POST /v1/lint
func (tc *ToolsController) LintOAS(c *gin.Context, body *models.OasInput) (*models.LintResult, error) {
	content := openapi.GetOASFromBody(body)
	if len(content) == 0 {
		return nil, problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody")
	}
	res, lintErr := tc.Linter.LintBytes(c.Request.Context(), content)
	if lintErr != nil {
		return nil, problem.NewInternalServerError(lintErr.Error())
	}
	return res, nil
}

/* ------------------------- BRUNO ------------------------- */
// POST /v1/bruno/convert
func (tc *ToolsController) GenerateBrunoFromOASPOST(c *gin.Context, body *models.OasInput) error {
	content := openapi.GetOASFromBody(body)
	if len(content) == 0 {
		return problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody")
	}

	zipBytes, name, err := tc.Bruno.ConvertOpenAPIToBruno(content)
	if err != nil {
		if errors.Is(err, services.ErrConverterUnavailable) {
			return problem.NewServiceUnavailable("converter niet beschikbaar")
		}
		return problem.NewInternalServerError(err.Error())
	}

	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", "attachment; filename=\""+name+".zip\"")
	c.Data(http.StatusOK, "application/octet-stream", zipBytes)
	return nil
}

/* ------------------------- POSTMAN ------------------------- */
// POST /v1/postman/convert
func (tc *ToolsController) GeneratePostmanFromOASPOST(c *gin.Context, body *models.OasInput) error {
	content := openapi.GetOASFromBody(body)
	if len(content) == 0 {
		return problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody")
	}

	jsonBytes, name, err := tc.Postman.ConvertOpenAPIToPostman(content)
	if err != nil {
		if errors.Is(err, services.ErrConverterUnavailable) {
			return problem.NewServiceUnavailable("converter niet beschikbaar")
		}
		return problem.NewInternalServerError(err.Error())
	}
	if name == "" {
		name = "postman-collection"
	}

	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=\""+name+".json\"")
	c.Data(http.StatusOK, "application/json", jsonBytes)
	return nil
}

/* ------------------------- VERSION CONVERTER ------------------------- */
// POST /v1/oas/convert
func (tc *ToolsController) ConvertOASVersion(c *gin.Context, body *models.OasInput) error {
	content := openapi.GetOASFromBody(body)
	if len(content) == 0 {
		return problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody")
	}

	converted, filename, err := tc.Converter.ConvertVersion(content)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrEmptyOAS):
			return problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody")
		case errors.Is(err, services.ErrVersionFieldMissing):
			return problem.NewBadRequest("", "OpenAPI document bevat geen geldig openapi versieveld")
		case errors.Is(err, services.ErrUnsupportedOASVersion):
			return problem.NewBadRequest("", "Alleen OpenAPI 3.0 en 3.1 worden ondersteund")
		default:
			return problem.NewInternalServerError(err.Error())
		}
	}

	contentType := "application/json"
	if strings.HasSuffix(strings.ToLower(filename), ".yaml") || strings.HasSuffix(strings.ToLower(filename), ".yml") {
		contentType = "application/yaml"
	}

	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.Data(http.StatusOK, contentType, converted)
	return nil
}

/* ------------------------- ARAZZO VISUALIZER ------------------------- */

// POST /v1/arazzo
func (tc *ToolsController) VisualizeArazzo(c *gin.Context, body *models.ArazzoInput) (*models.ArazzoVisualization, error) {
	if body == nil {
		return nil, problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik arazzoUrl of arazzoBody")
	}

	var content []byte
	if u := strings.TrimSpace(body.ArazzoUrl); u != "" {
		data, err := openapi.FetchURL(u)
		if err != nil {
			return nil, problem.NewBadRequest("", "Kon Arazzo specificatie niet ophalen via URL")
		}
		content = data
	} else if s := strings.TrimSpace(body.ArazzoBody); s != "" {
		content = []byte(s)
	}

	if len(content) == 0 {
		return nil, problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik arazzoUrl of arazzoBody")
	}

	modeStr := strings.ToLower(strings.TrimSpace(body.Output))
	mode := services.ArazzoOutputMode(modeStr)
	markdown, mermaid, err := tc.Arazzo.Visualize(content, mode)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrEmptyArazzo):
			return nil, problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik arazzoUrl of arazzoBody")
		case errors.Is(err, services.ErrInvalidArazzoSpec):
			return nil, problem.NewBadRequest("", "Arazzo specificatie ongeldig of mist workflows")
		default:
			return nil, problem.NewInternalServerError(err.Error())
		}
	}

	resp := &models.ArazzoVisualization{}
	switch mode {
	case services.ArazzoOutputMarkdown:
		resp.Markdown = markdown
	case services.ArazzoOutputMermaid:
		resp.Mermaid = mermaid
	default:
		resp.Markdown = markdown
		resp.Mermaid = mermaid
	}

	return resp, nil
}
