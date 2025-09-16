package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/openapi"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/problem"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/services"
	"github.com/gin-gonic/gin"
)

type ToolsController struct {
	Bruno   *services.BrunoService
	Postman *services.PostmanService
	Linter  *services.LinterService
}

func NewToolsController(bruno *services.BrunoService, postman *services.PostmanService, linter *services.LinterService) *ToolsController {
	return &ToolsController{Bruno: bruno, Postman: postman, Linter: linter}
}

/* ------------------------- LINT ------------------------- */

// POST /v1/lint  (body = pure OAS JSON)
func (tc *ToolsController) LintOAS(c *gin.Context, body *models.OASBody) (*models.LintResult, error) {
	content := openapi.GetOASFromBody(body)

	buf, err := json.Marshal(content)
	if err != nil {
		return nil, problem.NewBadRequest("", "Kon body niet serialiseren")
	}
	res, lintErr := tc.Linter.LintBytes(c.Request.Context(), buf)
	if lintErr != nil {
		return nil, problem.NewInternalServerError(lintErr.Error())
	}
	return res, nil
}

// GET /v1/lint?oasUrl=...
func (tc *ToolsController) LintOpenAPIGET(c *gin.Context, p *models.ToolsParams) (*models.LintResult, error) {
	if p == nil || p.OASUrl == "" {
		return nil, problem.NewBadRequest("", "Query parameter 'oasUrl' is verplicht")
	}
	res, err := tc.Linter.LintURL(c.Request.Context(), p.OASUrl)
	if err != nil {
		return nil, problem.NewInternalServerError(err.Error())
	}
	return res, nil
}

/* ------------------------- BRUNO ------------------------- */
// GET /v1/bruno/convert?oasUrl=...
func (tc *ToolsController) GenerateBrunoFromOASGET(c *gin.Context, p *models.ToolsParams) error {
	if p == nil || p.OASUrl == "" {
		return problem.NewBadRequest("", "Query parameter 'oasUrl' is verplicht")
	}
	content, err := services.FetchURL(p.OASUrl)
	if err != nil || len(content) == 0 {
		return problem.NewBadRequest(p.OASUrl, "Kon OpenAPI laden vanaf URL")
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

// POST /v1/bruno/convert  (typed params)
func (tc *ToolsController) GenerateBrunoFromOASPOST(c *gin.Context, body *models.OASBody) error {
	content := openapi.GetOASFromBody(body)

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
// POST /v1/postman/convert (typed params)
func (tc *ToolsController) GeneratePostmanFromOASPOST(c *gin.Context, body *models.OASBody) error {
	content := openapi.GetOASFromBody(body)

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

// GET /v1/postman/convert?oasUrl=...
func (tc *ToolsController) GeneratePostmanFromOASGET(c *gin.Context, p *models.ToolsParams) error {
	if p == nil || p.OASUrl == "" {
		return problem.NewBadRequest("", "Query parameter 'oasUrl' is verplicht")
	}
	content, err := services.FetchURL(p.OASUrl)
	if err != nil || len(content) == 0 {
		return problem.NewBadRequest(p.OASUrl, "Kon OpenAPI laden vanaf URL")
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
