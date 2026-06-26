import { HttpException, Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { OasInput, UntrustedClientInput, ValidateInput } from "@developer-overheid-nl/don-tools";
import { ToolsApi } from "../api";
import type { ModelsKeycloakClientResult, ModelsLintResult } from "../models";

const setHeaders = (reply: FastifyReply, headers: Record<string, string>) => {
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
};

const importEsm = new Function("specifier", "return import(specifier)") as <T>(specifier: string) => Promise<T>;
const loadLogic = () =>
  import("@developer-overheid-nl/don-tools").catch(() =>
    importEsm<typeof import("@developer-overheid-nl/don-tools")>("@developer-overheid-nl/don-tools"),
  );

const getLogicErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status: unknown }).status;
  return typeof status === "number" ? status : undefined;
};

const getLogicErrorMessage = (error: unknown): string => {
  if (typeof error !== "object" || error === null) {
    return "Request validation failed";
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  const detail = "detail" in error ? (error as { detail: unknown }).detail : undefined;
  if (typeof detail === "string" && detail.length > 0) return detail;
  return "Request validation failed";
};

const asHttpException = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw new HttpException(getLogicErrorMessage(error), getLogicErrorStatus(error) ?? 400);
  }
};

@Injectable()
export class ToolsApiService extends ToolsApi {
  async arazzoMarkdown(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<string> {
    const { arazzoMarkdown } = await loadLogic();
    reply.type("text/markdown; charset=utf-8");
    return asHttpException(() => arazzoMarkdown(oasInput as OasInput));
  }

  async arazzoMermaid(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<string> {
    const { arazzoMermaid } = await loadLogic();
    reply.type("text/plain; charset=utf-8");
    return asHttpException(() => arazzoMermaid(oasInput as OasInput));
  }

  async bundleOAS(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<void> {
    const { bundleOAS } = await loadLogic();
    const result = await asHttpException(() => bundleOAS(oasInput as OasInput));
    setHeaders(reply, result.headers);
    return result.rawBody as never;
  }

  async convertOAS(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<void> {
    const { convertOAS } = await loadLogic();
    const result = await asHttpException(() => convertOAS(oasInput as OasInput));
    setHeaders(reply, result.headers);
    return result.rawBody as never;
  }

  async createPostmanCollection(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<void> {
    const { createPostmanCollection } = await loadLogic();
    const result = await asHttpException(() => createPostmanCollection(oasInput as OasInput));
    setHeaders(reply, result.headers);
    return result.rawBody as never;
  }

  async generateOAS(oasInput: OasInput | undefined, _request: Request, reply: FastifyReply): Promise<object> {
    const { generateOAS } = await loadLogic();
    const result = await asHttpException(() => generateOAS(oasInput as OasInput));
    setHeaders(reply, result.headers);
    return JSON.parse(Buffer.from(result.rawBody).toString("utf8")) as object;
  }

  async untrustClient(untrustClientInput: UntrustedClientInput | undefined): Promise<ModelsKeycloakClientResult> {
    const { untrustedClient } = await loadLogic();
    return asHttpException(() =>
      untrustedClient(untrustClientInput as UntrustedClientInput),
    ) as Promise<ModelsKeycloakClientResult>;
  }

  async validatorOpenAPIPost(oasInput: OasInput | undefined): Promise<ModelsLintResult> {
    const { validatorOpenAPIPost } = await loadLogic();
    return asHttpException(() => validatorOpenAPIPost(oasInput as ValidateInput)) as Promise<ModelsLintResult>;
  }
}
