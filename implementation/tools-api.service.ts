import { BadRequestException, Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { OasInput, UntrustedClientInput, ValidateInput } from "@developer-overheid-nl/don-tools-logic";
import { ToolsApi } from "../api";
import type { ModelsKeycloakClientResult, ModelsLintResult } from "../models";

const setHeaders = (reply: FastifyReply, headers: Record<string, string>) => {
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
};

const importEsm = new Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>;
const loadLogic = () =>
  import("@developer-overheid-nl/don-tools-logic").catch(() =>
    importEsm<typeof import("@developer-overheid-nl/don-tools-logic")>("@developer-overheid-nl/don-tools-logic"),
  );

const asBadRequest = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "Request validation failed");
  }
};

@Injectable()
export class ToolsApiService extends ToolsApi {
  async arazzoMarkdown(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<string> {
    const { arazzoMarkdown } = await loadLogic();
    reply.type("text/markdown; charset=utf-8");
    return asBadRequest(() => arazzoMarkdown(oasInput as OasInput));
  }

  async arazzoMermaid(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<string> {
    const { arazzoMermaid } = await loadLogic();
    reply.type("text/plain; charset=utf-8");
    return asBadRequest(() => arazzoMermaid(oasInput as OasInput));
  }

  async bundleOAS(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<void> {
    const { bundleOAS } = await loadLogic();
    const result = await asBadRequest(() => bundleOAS(oasInput as OasInput));
    setHeaders(reply, result.headers);
    return result.rawBody as unknown as void;
  }

  async convertOAS(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<void> {
    const { convertOAS } = await loadLogic();
    const result = await asBadRequest(() => convertOAS(oasInput as OasInput));
    setHeaders(reply, result.headers);
    return result.rawBody as unknown as void;
  }

  async createPostmanCollection(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<void> {
    const { createPostmanCollection } = await loadLogic();
    const result = await asBadRequest(() => createPostmanCollection(oasInput as OasInput));
    setHeaders(reply, result.headers);
    return result.rawBody as unknown as void;
  }

  async generateOAS(oasInput: OasInput | undefined): Promise<object> {
    const { generateOAS } = await loadLogic();
    return asBadRequest(() => generateOAS(oasInput as OasInput));
  }

  async untrustClient(untrustClientInput: UntrustedClientInput | undefined): Promise<ModelsKeycloakClientResult> {
    const { untrustedClient } = await loadLogic();
    return asBadRequest(() => untrustedClient(untrustClientInput as UntrustedClientInput)) as Promise<ModelsKeycloakClientResult>;
  }

  async validatorOpenAPIPost(oasInput: OasInput | undefined): Promise<ModelsLintResult> {
    const { validatorOpenAPIPost } = await loadLogic();
    return asBadRequest(() => validatorOpenAPIPost(oasInput as ValidateInput)) as Promise<ModelsLintResult>;
  }
}
