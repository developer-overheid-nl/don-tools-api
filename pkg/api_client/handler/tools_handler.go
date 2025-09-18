package handler

import (
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

// POST /v1/lint  (body = OasInput: oasUrl of oasBody)
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
// POST /v1/bruno/convert  (typed params)
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
// POST /v1/postman/convert (typed params)
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
