package main

import (
	"context"
	"log"
	"net/http"
	"os"

	api "github.com/developer-overheid-nl/don-tools-api/pkg/api_client"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/handler"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/helper/problem"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/jobs"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/services"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/loopfz/gadgeto/tonic"
)

func init() {
	tonic.SetErrorHook(func(c *gin.Context, err error) (int, interface{}) {
		if apiErr, ok := err.(problem.APIError); ok {
			c.Header("Content-Type", "application/problem+json")
			return apiErr.Status, apiErr
		}

		// 3) Alles anders → 500
		internal := problem.NewInternalServerError(err.Error())
		c.Header("Content-Type", "application/problem+json")
		return internal.Status, internal
	})
}

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Println("Geen .env bestand gevonden, ga ervan uit dat alle config via omgevingsvariabelen wordt geleverd", err)
	}

	version := os.Getenv("API_VERSION")
	if version == "" {
		version = "1.0.0"
	}

	// Wire services and controller
	brunoSvc := services.NewBrunoService()
	postmanSvc := services.NewPostmanService()
	linterSvc := services.NewLinterService()
	converterSvc := services.NewOASVersionService()
	arazzoSvc := services.NewArazzoVizService()
	dereferencerSvc := services.NewDereferenceService()
	harvesterSvc := services.NewHarvesterServiceFromEnv()
	keycloakSvc := services.NewKeycloakServiceFromEnv()
	controller := handler.NewToolsController(brunoSvc, postmanSvc, linterSvc, converterSvc, arazzoSvc, keycloakSvc, dereferencerSvc)
	router := api.NewRouter(version, controller)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	jobs.SchedulePDOKHarvest(ctx, harvesterSvc)

	// Start server
	log.Println("Server luistert op :1338")
	log.Fatal(http.ListenAndServe(":1338", router))
}
