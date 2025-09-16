package jobs

import (
	"context"
	"fmt"
	"time"

	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/models"
	"github.com/developer-overheid-nl/don-tools-api/pkg/api_client/services"
	"github.com/robfig/cron/v3"
)

// ScheduleHarvest zet een cron job op die de opgegeven bronnen harvest
func ScheduleHarvest(ctx context.Context, svc *services.HarvesterService, sources []models.HarvestSource) *cron.Cron {
	spec := "@every 5m"
	c := cron.New(cron.WithChain(
		cron.Recover(cron.DefaultLogger),
		cron.SkipIfStillRunning(cron.DefaultLogger),
	))

	_, err := c.AddFunc(spec, func() {
		jobCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		for _, src := range sources {
			if err := svc.RunOnce(jobCtx, src); err != nil {
				fmt.Printf("[harvest %s] failed: %v\n", src.Name, err)
			}
		}
	})
	if err != nil {
		fmt.Printf("failed to schedule harvest: %v\n", err)
		return c
	}

	c.Start()
	go func() {
		<-ctx.Done()
		c.Stop()
	}()
	return c
}

// SchedulePDOKHarvest bouwt een standaard PDOK-bron uit env en plant de harvest
func SchedulePDOKHarvest(ctx context.Context, svc *services.HarvesterService) *cron.Cron {
	src := models.HarvestSource{
		Name:            "pdok",
		IndexURL:        "https://api.pdok.nl/index.json",
		OrganisationUri: "https://www.pdok.nl",
		Contact: models.Contact{
			Name:  "PDOK Support",
			URL:   "https://www.pdok.nl/support1",
			Email: "support@pdok.nl",
		},
		UISuffix: "ui/",
		OASPath:  "openapi.json",
	}
	return ScheduleHarvest(ctx, svc, []models.HarvestSource{src})
}
