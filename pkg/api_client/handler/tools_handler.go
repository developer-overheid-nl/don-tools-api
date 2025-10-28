package handler

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/openapi"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/problem"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/services"
	"github.com/gin-gonic/gin"
)

type ToolsController struct {
	Bruno        *services.BrunoService
	Postman      *services.PostmanService
	Linter       *services.LinterService
	Converter    *services.OASVersionService
	Arazzo       *services.ArazzoVizService
	Keycloak     *services.KeycloakService
	Dereferencer *services.DereferenceService
}

func NewToolsController(bruno *services.BrunoService, postman *services.PostmanService, linter *services.LinterService, converter *services.OASVersionService, arazzo *services.ArazzoVizService, keycloak *services.KeycloakService, dereferencer *services.DereferenceService) *ToolsController {
	return &ToolsController{Bruno: bruno, Postman: postman, Linter: linter, Converter: converter, Arazzo: arazzo, Keycloak: keycloak, Dereferencer: dereferencer}
}

/* ------------------------- LINT ------------------------- */

// POST /v1/lint
func (tc *ToolsController) LintOAS(c *gin.Context, body *models.OasInput) (*models.LintResult, error) {
	content := openapi.GetOASFromBody(body)
	if len(content) == 0 {
		return nil, problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody")
	}
	version, err := openapi.DetectOASVersion(content)
	if err != nil {
		return nil, problem.NewBadRequest("", err.Error())
	}
	if !strings.HasPrefix(version, "3.0.") && version != "3.0" {
		return nil, problem.NewBadRequest("", fmt.Sprintf("OpenAPI versie %s wordt niet ondersteund. Gebruik een 3.0.x specificatie.", version))
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

func (tc *ToolsController) GenerateOAS(c *gin.Context, body *models.OasInput) error {
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

/* ------------------------- DEREFERENCE ------------------------- */
// POST /v1/oas/dereference
func (tc *ToolsController) DereferenceOAS(c *gin.Context, body *models.OasInput) error {
	content := openapi.GetOASFromBody(body)
	if len(content) == 0 {
		return problem.NewBadRequest("", "Body ontbreekt of ongeldig: gebruik oasUrl of oasBody")
	}

	base := strings.TrimSpace(body.OasUrl)

	jsonBytes, baseName, err := tc.Dereferencer.Dereference(c.Request.Context(), content, base)
	if err != nil {
		return problem.NewInternalServerError(err.Error())
	}

	preferred := services.GuessExt(content)
	output, filename, err := services.DereferenceToPreferedFormat(jsonBytes, preferred, baseName)
	if err != nil {
		return problem.NewInternalServerError(err.Error())
	}

	contentType := "application/json"
	if strings.HasSuffix(strings.ToLower(filename), ".yaml") || strings.HasSuffix(strings.ToLower(filename), ".yml") {
		contentType = "application/yaml"
	}

	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.Data(http.StatusOK, contentType, output)
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

	markdown, mermaid, err := tc.Arazzo.Visualize(content)
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
	resp.Markdown = markdown
	resp.Mermaid = mermaid

	return resp, nil
}

// POST /v1/keycloak/clients

func (tc *ToolsController) CreateKeycloakClient(c *gin.Context, body *models.KeycloakClientInput) (*models.KeycloakClientResult, error) {
	if body == nil {
		return nil, problem.NewBadRequest("", "body ontbreekt")
	}
	if strings.TrimSpace(body.Email) == "" {
		return nil, problem.NewBadRequest("", "email is verplicht")
	}
	if tc.Keycloak == nil {
		return nil, problem.NewInternalServerError("Keycloak service niet geconfigureerd")
	}
	res, err := tc.Keycloak.CreateClient(c.Request.Context(), *body)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrKeycloakConfig):
			return nil, problem.NewInternalServerError("Keycloak configuratie ontbreekt")
		case errors.Is(err, services.ErrKeycloakConflict):
			return nil, problem.NewConflict("Keycloak client bestaat al")
		case errors.Is(err, services.ErrKeycloakUnauthorized):
			return nil, problem.NewForbidden("", "Geen toegang tot Keycloak admin API")
		case errors.Is(err, services.ErrKeycloakClientIDMissing):
			return nil, problem.NewBadRequest("", "clientId ontbreekt of is ongeldig")
		default:
			return nil, problem.NewInternalServerError(err.Error())
		}
	}
	return res, nil
}
