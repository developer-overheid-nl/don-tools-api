import { HttpException, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ToolsApi } from "../api";
import type { ApiImplementations } from "../app/api-implementations";
import type { ModelsKeycloakClientResult, ModelsLintResult, OasInput, UntrustClientInput } from "../models";

const loadTools = () => import("@developer-overheid-nl/don-tools");

const setHeaders = (reply: FastifyReply, headers: Record<string, string>): void => {
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
};

const invoke = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    const { HttpError } = await loadTools();
    if (error instanceof HttpError) throw new HttpException(error.detail, error.status, { cause: error });
    throw error;
  }
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
    const { validatorOpenAPIPost } = await loadTools();
    return invoke(() => validatorOpenAPIPost(input as never));
  }
}

export const apiImplementations: Partial<ApiImplementations> = {
  toolsApi: ToolsService,
};
