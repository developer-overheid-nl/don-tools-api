import type { FastifyReply, FastifyRequest } from "fastify";
import {
  arazzoMarkdown,
  arazzoMermaid,
  bundleOAS,
  convertOAS,
  createPostmanCollection,
  generateOAS,
  untrustedClient,
  validatorOpenAPIPost,
  type OasInput,
  type UntrustedClientInput,
  type ValidateInput,
} from "@developer-overheid-nl/don-tools-logic";

type OasRequest = FastifyRequest<{ Body: OasInput }>;
type ValidateRequest = FastifyRequest<{ Body: ValidateInput }>;
type UntrustedClientRequest = FastifyRequest<{ Body: UntrustedClientInput }>;

const sendBuffer = (reply: FastifyReply, headers: Record<string, string>, buffer: Buffer) => {
  for (const [name, value] of Object.entries(headers)) reply.header(name, value);
  return reply.send(buffer);
};

export class Routes {
  arazzoMarkdown = async (request: OasRequest, reply: FastifyReply) => {
    const markdown = await arazzoMarkdown(request.body);
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return reply.send(markdown);
  };

  arazzoMermaid = async (request: OasRequest, reply: FastifyReply) => {
    const mermaid = await arazzoMermaid(request.body);
    reply.header("Content-Type", "text/plain; charset=utf-8");
    return reply.send(mermaid);
  };

  bundleOAS = async (request: OasRequest, reply: FastifyReply) => {
    const result = await bundleOAS(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  convertOAS = async (request: OasRequest, reply: FastifyReply) => {
    const result = await convertOAS(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  createPostmanCollection = async (request: OasRequest, reply: FastifyReply) => {
    const result = await createPostmanCollection(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  generateOAS = async (request: OasRequest, reply: FastifyReply) => {
    const result = await generateOAS(request.body);
    return sendBuffer(reply, result.headers, result.rawBody);
  };

  untrustClient = async (request: UntrustedClientRequest, reply: FastifyReply) =>
    reply.send(await untrustedClient(request.body));

  validatorOpenAPIPost = async (request: ValidateRequest, reply: FastifyReply) =>
    reply.send(await validatorOpenAPIPost(request.body));
}
