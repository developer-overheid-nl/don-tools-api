import { HttpException, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ToolsApi } from "../api";
import type { ApiImplementations } from "../app/api-implementations";
import type { ModelsKeycloakClientResult, ModelsLintResult, OasInput, UntrustClientInput } from "../models";
import { invoke, loadTools } from "./don-tools";
import { EventsService } from "./events/service";

// ADR ruleset versions accepted by the validator; without targetVersion it validates against ADR 2.2.
const rulesetVersions = ["2.0", "2.1", "2.2", "draft"];
const defaultRulesetVersion = "2.2";

const setHeaders = (reply: FastifyReply, headers: Record<string, string>): void => {
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
};

@Injectable()
class ToolsService extends ToolsApi {
  async arazzoMarkdown(input: OasInput | undefined, _request: FastifyRequest, reply: FastifyReply): Promise<string> {
    const { arazzoMarkdown } = await loadTools();
    reply.type("text/markdown; charset=utf-8");
    return invoke(() => arazzoMarkdown(input as never));
  }

  async arazzoMermaid(input: OasInput | undefined, _request: FastifyRequest, reply: FastifyReply): Promise<string> {
    const { arazzoMermaid } = await loadTools();
    reply.type("text/plain; charset=utf-8");
    return invoke(() => arazzoMermaid(input as never));
  }

  async bundleOAS(input: OasInput | undefined, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { bundleOAS } = await loadTools();
    const result = await invoke(() => bundleOAS(input as never));
    setHeaders(reply, result.headers);
    return result.rawBody as never;
  }

  async convertOAS(input: OasInput | undefined, _request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { convertOAS } = await loadTools();
    const result = await invoke(() => convertOAS(input as never));
    setHeaders(reply, result.headers);
    return result.rawBody as never;
  }

  async createPostmanCollection(
    input: OasInput | undefined,
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const { createPostmanCollection } = await loadTools();
    const result = await invoke(() => createPostmanCollection(input as never));
    setHeaders(reply, result.headers);
    return result.rawBody as never;
  }

  async generateOAS(input: OasInput | undefined, _request: FastifyRequest, reply: FastifyReply): Promise<object> {
    const { generateOAS } = await loadTools();
    const result = await invoke(() => generateOAS(input as never));
    setHeaders(reply, result.headers);
    return JSON.parse(result.rawBody.toString("utf8")) as object;
  }

  async untrustClient(input: UntrustClientInput | undefined): Promise<ModelsKeycloakClientResult> {
    const { untrustedClient } = await loadTools();
    return invoke(() => untrustedClient(input as never));
  }

  async validatorOpenAPIPost(input: OasInput | undefined): Promise<ModelsLintResult> {
    const targetVersion = input?.targetVersion ?? defaultRulesetVersion;
    if (!rulesetVersions.includes(targetVersion)) {
      throw new HttpException(`targetVersion wordt niet ondersteund. Gebruik ${rulesetVersions.join(", ")}.`, 400);
    }
    const { validatorOpenAPIPost } = await loadTools();
    return invoke(() => validatorOpenAPIPost({ ...input, targetVersion } as never));
  }
}

export const apiImplementations: Partial<ApiImplementations> = {
  eventsApi: EventsService,
  toolsApi: ToolsService,
};
