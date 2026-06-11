import { Body, Controller, DefaultValuePipe, Post, Inject, Param, ParseIntPipe, ParseFloatPipe, Query, Req, Res, HttpCode } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { Cookies, Headers } from '../decorators';
import { ToolsApi } from '../api';
import { ModelsKeycloakClientResult, ModelsLintResult, OasInput, UntrustClientInput,  } from '../models';

@Controller()
export class ToolsApiController {
  constructor(@Inject(ToolsApi) private readonly toolsApi: ToolsApi) {}

  @Post('/v1/arazzo/markdown')
  @HttpCode(200)
  arazzoMarkdown(@Body() oasInput: OasInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): string | Promise<string> | Observable<string> {
    return this.toolsApi.arazzoMarkdown(oasInput, request, reply);
  }

  @Post('/v1/arazzo/mermaid')
  @HttpCode(200)
  arazzoMermaid(@Body() oasInput: OasInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): string | Promise<string> | Observable<string> {
    return this.toolsApi.arazzoMermaid(oasInput, request, reply);
  }

  @Post('/v1/oas/bundle')
  @HttpCode(200)
  bundleOAS(@Body() oasInput: OasInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): void | Promise<void> | Observable<void> {
    return this.toolsApi.bundleOAS(oasInput, request, reply);
  }

  @Post('/v1/oas/convert')
  @HttpCode(200)
  convertOAS(@Body() oasInput: OasInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): void | Promise<void> | Observable<void> {
    return this.toolsApi.convertOAS(oasInput, request, reply);
  }

  @Post('/v1/oas/postman')
  @HttpCode(200)
  createPostmanCollection(@Body() oasInput: OasInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): void | Promise<void> | Observable<void> {
    return this.toolsApi.createPostmanCollection(oasInput, request, reply);
  }

  @Post('/v1/oas/generate')
  @HttpCode(200)
  generateOAS(@Body() oasInput: OasInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): object | Promise<object> | Observable<object> {
    return this.toolsApi.generateOAS(oasInput, request, reply);
  }

  @Post('/v1/auth/clients')
  @HttpCode(200)
  untrustClient(@Body() untrustClientInput: UntrustClientInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): ModelsKeycloakClientResult | Promise<ModelsKeycloakClientResult> | Observable<ModelsKeycloakClientResult> {
    return this.toolsApi.untrustClient(untrustClientInput, request, reply);
  }

  @Post('/v1/oas/validate')
  @HttpCode(200)
  validatorOpenAPIPost(@Body() oasInput: OasInput | undefined, @Req() request: Request, @Res({ passthrough: true }) reply: FastifyReply): ModelsLintResult | Promise<ModelsLintResult> | Observable<ModelsLintResult> {
    return this.toolsApi.validatorOpenAPIPost(oasInput, request, reply);
  }

}
