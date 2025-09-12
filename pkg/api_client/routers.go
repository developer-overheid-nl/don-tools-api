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

	// GET/POST /v1/bruno/convert
	tools.GET("/bruno/convert",
		[]fizz.OperationOption{
			fizz.ID("convertOpenAPIToBruno"),
			fizz.Summary("Maak Bruno-collectie"),
			fizz.Description("Converteert OpenAPI naar Bruno ZIP. Gebruik query parameter 'oasUrl' of POST body met OAS."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.GenerateBrunoFromOASGET, 200),
	)
	tools.POST("/bruno/convert",
		[]fizz.OperationOption{
			fizz.ID("convertOpenAPIToBrunoPost"),
			fizz.Summary("Maak Bruno-collectie (POST)"),
			fizz.Description("Converteert OpenAPI naar Bruno ZIP. Body bevat het volledige OpenAPI document (JSON of YAML)."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.GenerateBrunoFromOASPOST, 200),
	)

	// GET/POST /v1/postman/convert
	tools.GET("/postman/convert",
		[]fizz.OperationOption{
			fizz.ID("convertOpenAPIToPostman"),
			fizz.Summary("Maak Postman-collectie"),
			fizz.Description("Converteert OpenAPI naar Postman Collection JSON. Gebruik query parameter 'oasUrl' of POST body met OAS."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.GeneratePostmanFromOASGET, 200),
	)
	tools.POST("/postman/convert",
		[]fizz.OperationOption{
			fizz.ID("convertOpenAPIToPostmanPost"),
			fizz.Summary("Maak Postman-collectie (POST)"),
			fizz.Description("Converteert OpenAPI naar Postman Collection JSON. Body bevat het volledige OpenAPI document (JSON of YAML)."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.GeneratePostmanFromOASPOST, 200),
	)

	// GET/POST /v1/lint
	tools.GET("/lint",
		[]fizz.OperationOption{
			fizz.ID("lintOpenAPI"),
			fizz.Summary("Lint OpenAPI"),
			fizz.Description("Lint een OpenAPI specificatie met de DON ADR ruleset. Gebruik query parameter 'oasUrl'."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.LintOpenAPIGET, 200),
	)
	tools.POST("/lint",
		[]fizz.OperationOption{
			fizz.ID("lintOpenAPIPost"),
			fizz.Summary("Lint OpenAPI (POST)"),
			fizz.Description("Lint een OpenAPI specificatie met de DON ADR ruleset. Body bevat het volledige OpenAPI document (JSON of YAML)."),
			fizz.Security(&openapi.SecurityRequirement{
				"apiKey":            {},
				"clientCredentials": {"tools:read"},
			}),
			apiVersionHeader,
			notFoundResponse,
		},
		tonic.Handler(controller.LintOAS, 200),
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
