package api_client

import (
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/handler"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/loopfz/gadgeto/tonic"
	"github.com/wI2L/fizz"
	"github.com/wI2L/fizz/openapi"
)

var (
	apiVersionHeader = fizz.Header(
		"API-Version",
		"De API-versie van de response",
		"",
	)

	notFoundResponse = fizz.Response(
		"404",
		"Not Found",
		nil,
		nil,
		nil,
	)
)

func NewRouter(apiVersion string, controller *handler.ToolsController) *fizz.Fizz {
	//gin.SetMode(gin.ReleaseMode)
	g := gin.Default()

	// Configure CORS to allow access from everywhere
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Length", "Content-Type", "Authorization", "API-Version"}
	config.ExposeHeaders = []string{"API-Version"}
	g.Use(cors.New(config))

	g.Use(APIVersionMiddleware(apiVersion))
	f := fizz.NewFromEngine(g)

	f.Generator().SetServers([]*openapi.Server{
		{
			URL:         "https://api.developer.overheid.nl/tools/v1",
			Description: "Production",
		},
		{
			URL:         "https://api-register.don.apps.digilab.network/tools/v1",
			Description: "Test",
		},
	})

	gen := f.Generator()

	gen.API().Components.Responses["404"] = &openapi.ResponseOrRef{
		Reference: &openapi.Reference{
			Ref: "https://static.developer.overheid.nl/adr/components.yaml#/responses/404",
		},
	}

	gen.API().Components.Headers["API-Version"] = &openapi.HeaderOrRef{
		Header: &openapi.Header{
			Description: "De API-versie van de response",
			Schema: &openapi.SchemaOrRef{
				Schema: &openapi.Schema{
					Type:    "string",
					Example: "1.0.0",
				},
			},
		},
	}

	if gen.API().Components.SecuritySchemes == nil {
		gen.API().Components.SecuritySchemes = map[string]*openapi.SecuritySchemeOrRef{}
	}
	gen.API().Components.SecuritySchemes["apiKey"] = &openapi.SecuritySchemeOrRef{
		SecurityScheme: &openapi.SecurityScheme{
			Type: "apiKey",
			In:   "header",
			Name: "X-API-Key",
		},
	}
	gen.API().Components.SecuritySchemes["clientCredentials"] = &openapi.SecuritySchemeOrRef{
		SecurityScheme: &openapi.SecurityScheme{
			Type: "oauth2",
			Flows: &openapi.OAuthFlows{
				ClientCredentials: &openapi.OAuthFlow{
					TokenURL: "https://auth.don.apps.digilab.network/realms/don/protocol/openid-connect/token",
					Scopes: map[string]string{
						"tools:read": "Toegang tot de tools endpoints",
					},
				},
			},
		},
	}

	info := &openapi.Info{
		Title:       "Tools API v1",
		Description: "API van het Tools (apis.developer.overheid.nl)",
		Version:     apiVersion,
		Contact: &openapi.Contact{
			Name:  "Team developer.overheid.nl",
			Email: "developer.overheid@geonovum.nl",
			URL:   "https://github.com/developer-overheid-nl/don-tools-api/issues",
		},
	}

	root := f.Group("/v1", "API v1", "Tools API V1 routes")

	// Converters & lint
	tools := root.Group("", "Tools", "Conversies en hulpmiddelen")

	// POST /v1/bruno/convert
	tools.POST("/bruno/convert",
		[]fizz.OperationOption{
			fizz.ID("CreateBrunoCollection"),
			fizz.Summary("Maak Bruno-collectie (POST)"),
			fizz.Description("Converteert OpenAPI naar Bruno ZIP. Body: { oasUrl } of { oasBody } (stringified JSON of YAML)."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.GenerateBrunoFromOASPOST, 200),
	)

	// POST /v1/postman/convert
	tools.POST("/postman/convert",
		[]fizz.OperationOption{
			fizz.ID("CreatePostmanCollection"),
			fizz.Summary("Maak Postman-collectie (POST)"),
			fizz.Description("Converteert OpenAPI naar Postman Collection JSON. Body: { oasUrl } of { oasBody } (stringified JSON of YAML)."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.GeneratePostmanFromOASPOST, 200),
	)

	// POST /v1/oas/convert
	tools.POST("/oas/convert",
		[]fizz.OperationOption{
			fizz.ID("ConvertOAS"),
			fizz.Summary("Converteer OpenAPI 3.0/3.1"),
			fizz.Description("Zet OpenAPI 3.0 om naar 3.1 of andersom. Body: { oasUrl } of { oasBody } (stringified JSON of YAML)."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.ConvertOASVersion, 200),
	)

	// POST /v1/lint
	tools.POST("/lint",
		[]fizz.OperationOption{
			fizz.ID("lintOpenAPIPost"),
			fizz.Summary("Lint OpenAPI (POST)"),
			fizz.Description("Lint een OpenAPI specificatie met de DON ADR ruleset. Body: { oasUrl } of { oasBody } (stringified JSON of YAML)."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.LintOAS, 200),
	)

	// POST /v1/arazzo
	tools.POST("/arazzo",
		[]fizz.OperationOption{
			fizz.ID("arazzo"),
			fizz.Summary("Visualiseer Arazzo (POST)"),
			fizz.Description("Converteert een OpenAPI Arazzo specificatie naar Markdown en Mermaid. Body: { arazzoUrl|arazzoBody, output? } waarbij output optioneel is en 'markdown', 'mermaid' of 'both' kan zijn."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.VisualizeArazzo, 200),
	)

	// 6) OpenAPI documentatie
	f.GET("/v1/openapi.json", []fizz.OperationOption{}, f.OpenAPI(info, "json"))

	return f
}

type apiVersionWriter struct {
	gin.ResponseWriter
	version string
}

func (w *apiVersionWriter) WriteHeader(code int) {
	if code >= 200 && code < 300 {
		w.Header().Set("API-Version", w.version)
	}
	w.ResponseWriter.WriteHeader(code)
}

func APIVersionMiddleware(version string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer = &apiVersionWriter{c.Writer, version}
		c.Next()
	}
}
