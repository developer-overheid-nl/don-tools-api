import { type DynamicModule, HttpException, Module, type Provider } from "@nestjs/common";
import { EventsApi, ToolsApi } from "../api";
import { EventsApiController, ToolsApiController } from "../controllers";
import type { ApiImplementations } from "./api-implementations";

const createNotImplementedProvider = (apiName: string) =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== "string") return undefined;
        if (
          property === "then" ||
          property === "onModuleInit" ||
          property === "onApplicationBootstrap" ||
          property === "onModuleDestroy" ||
          property === "beforeApplicationShutdown" ||
          property === "onApplicationShutdown"
        ) {
          return undefined;
        }
        return () => {
          throw new HttpException(`Operation ${property} is not implemented in ${apiName}`, 501);
        };
      },
    },
  );

export type ApiModuleConfiguration = {
  apiImplementations?: Partial<ApiImplementations>;
  providers?: Provider[];
};

@Module({})
export class ApiModule {
  static forRoot(configuration: ApiModuleConfiguration = {}): DynamicModule {
    const providers: Provider[] = [
      configuration.apiImplementations?.eventsApi
        ? {
            provide: EventsApi,
            useClass: configuration.apiImplementations.eventsApi,
          }
        : {
            provide: EventsApi,
            useValue: createNotImplementedProvider("EventsApi"),
          },
      configuration.apiImplementations?.toolsApi
        ? {
            provide: ToolsApi,
            useClass: configuration.apiImplementations.toolsApi,
          }
        : {
            provide: ToolsApi,
            useValue: createNotImplementedProvider("ToolsApi"),
          },
      ...(configuration.providers || []),
    ];

    return {
      module: ApiModule,
      controllers: [EventsApiController, ToolsApiController],
      providers: [...providers],
      exports: [...providers],
    };
  }
}
