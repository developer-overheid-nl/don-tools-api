import { Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Observable } from "rxjs";
import type { ModelsKeycloakClientResult, ModelsLintResult, OasInput, UntrustClientInput } from "../models";

@Injectable()
export abstract class ToolsApi {
  abstract arazzoMarkdown(
    oasInput: OasInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): string | Promise<string> | Observable<string>;
  abstract arazzoMermaid(
    oasInput: OasInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): string | Promise<string> | Observable<string>;
  abstract bundleOAS(
    oasInput: OasInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void | Promise<void> | Observable<void>;
  abstract convertOAS(
    oasInput: OasInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void | Promise<void> | Observable<void>;
  abstract createPostmanCollection(
    oasInput: OasInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void | Promise<void> | Observable<void>;
  abstract generateOAS(
    oasInput: OasInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): object | Promise<object> | Observable<object>;
  abstract untrustClient(
    untrustClientInput: UntrustClientInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): ModelsKeycloakClientResult | Promise<ModelsKeycloakClientResult> | Observable<ModelsKeycloakClientResult>;
  abstract validatorOpenAPIPost(
    oasInput: OasInput | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): ModelsLintResult | Promise<ModelsLintResult> | Observable<ModelsLintResult>;
}
