// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomBytes, timingSafeEqual } from "node:crypto";
import {
    createServer,
    type IncomingHttpHeaders,
    type Server,
    type ServerResponse,
} from "node:http";
import {
    WebStandardStreamableHTTPServerTransport,
    type WebStandardStreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
    MemoryService,
    PersonalHowToService,
} from "@typeagent/memory-service";
import { MemoryMcpServer } from "./memoryMcpServer.js";

export interface MemoryServiceHostOptions {
    host?: string;
    port?: number;
    bearerToken?: string;
    maxRequestBytes?: number;
    onError?: (error: Error) => void;
}

export class MemoryServiceHost {
    private closePromise: Promise<void> | undefined;

    private constructor(
        private readonly httpServer: Server,
        private readonly activeServers: Set<MemoryMcpServer>,
        private readonly service: MemoryService & PersonalHowToService,
        private readonly beginClosing: () => void,
        public readonly host: string,
        public readonly port: number,
        public readonly bearerToken: string,
    ) {}

    public get endpoint(): string {
        return `http://${this.host}:${this.port}/mcp`;
    }

    public get healthEndpoint(): string {
        return `http://${this.host}:${this.port}/health`;
    }

    public static async start(
        service: MemoryService & PersonalHowToService,
        options: MemoryServiceHostOptions = {},
    ): Promise<MemoryServiceHost> {
        const host = options.host ?? "127.0.0.1";
        if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
            throw new Error("The local memory service must bind to loopback");
        }
        await service.initialize?.();
        const bearerToken =
            options.bearerToken ?? randomBytes(32).toString("base64url");
        const activeServers = new Set<MemoryMcpServer>();
        let closing = false;
        const httpServer = createServer(async (request, response) => {
            try {
                const requestUrl = new URL(
                    request.url ?? "/",
                    `http://${request.headers.host ?? host}`,
                );
                if (requestUrl.pathname === "/health") {
                    response.writeHead(200, {
                        "content-type": "application/json",
                    });
                    response.end(JSON.stringify({ status: "ready" }));
                    return;
                }
                if (requestUrl.pathname !== "/mcp") {
                    response.writeHead(404).end();
                    return;
                }
                if (
                    !hasBearerToken(request.headers.authorization, bearerToken)
                ) {
                    response.writeHead(401, {
                        "content-type": "application/json",
                        "www-authenticate": "Bearer",
                    });
                    response.end(JSON.stringify({ error: "Unauthorized" }));
                    return;
                }
                const parsedBody =
                    request.method === "POST"
                        ? await readJsonBody(
                              request,
                              options.maxRequestBytes ?? 25 * 1024 * 1024,
                          )
                        : undefined;
                if (closing) {
                    response.writeHead(503, {
                        "content-type": "application/json",
                    });
                    response.end(JSON.stringify({ error: "Shutting down" }));
                    return;
                }
                const transport = new WebStandardStreamableHTTPServerTransport({
                    sessionIdGenerator: undefined,
                    enableJsonResponse: false,
                } as unknown as WebStandardStreamableHTTPServerTransportOptions);
                const mcpServer = new MemoryMcpServer(service);
                activeServers.add(mcpServer);
                mcpServer.server.server.onerror = (error) =>
                    options.onError?.(error);
                try {
                    await mcpServer.start(transport as unknown as Transport);
                    const webResponse = await transport.handleRequest(
                        new Request(requestUrl, {
                            method: request.method ?? "GET",
                            headers: toWebHeaders(request.headers),
                        }),
                        { parsedBody },
                    );
                    await writeWebResponse(response, webResponse);
                } finally {
                    activeServers.delete(mcpServer);
                    await mcpServer.close();
                }
            } catch (error) {
                options.onError?.(
                    error instanceof Error ? error : new Error(String(error)),
                );
                if (!response.headersSent) {
                    response.writeHead(500, {
                        "content-type": "application/json",
                    });
                }
                response.end(
                    JSON.stringify({
                        error:
                            error instanceof Error
                                ? error.message
                                : "Internal server error",
                    }),
                );
            }
        });
        try {
            await listen(httpServer, options.port ?? 0, host);
        } catch (error) {
            await closeHttpServer(httpServer);
            await service.close?.();
            throw error;
        }
        const address = httpServer.address();
        if (address === null || typeof address === "string") {
            await closeHttpServer(httpServer);
            await service.close?.();
            throw new Error("Memory service did not bind a TCP address");
        }
        return new MemoryServiceHost(
            httpServer,
            activeServers,
            service,
            () => {
                closing = true;
            },
            host,
            address.port,
            bearerToken,
        );
    }

    public close(): Promise<void> {
        this.closePromise ??= (async () => {
            this.beginClosing();
            const results = await Promise.allSettled([
                closeHttpServer(this.httpServer),
                ...[...this.activeServers].map((server) => server.close()),
            ]);
            const serviceResult = await Promise.allSettled([
                this.service.close?.() ?? Promise.resolve(),
            ]);
            results.push(...serviceResult);
            const failure = results.find(
                (result): result is PromiseRejectedResult =>
                    result.status === "rejected",
            );
            if (failure !== undefined) {
                throw failure.reason;
            }
        })();
        return this.closePromise;
    }
}

function toWebHeaders(headers: IncomingHttpHeaders): Headers {
    const result = new Headers();
    for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                result.append(name, item);
            }
        } else if (value !== undefined) {
            result.set(name, value);
        }
    }
    return result;
}

async function writeWebResponse(
    response: ServerResponse,
    webResponse: Response,
): Promise<void> {
    response.writeHead(
        webResponse.status,
        Object.fromEntries(webResponse.headers.entries()),
    );
    if (webResponse.body === null) {
        response.end();
        return;
    }
    const reader = webResponse.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                response.end();
                return;
            }
            if (!response.write(Buffer.from(value))) {
                await new Promise<void>((resolve) =>
                    response.once("drain", resolve),
                );
            }
        }
    } finally {
        reader.releaseLock();
    }
}

async function readJsonBody(
    request: NodeJS.ReadableStream,
    maxBytes: number,
): Promise<unknown> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
            throw new Error(`MCP request exceeds ${maxBytes} bytes`);
        }
        chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function hasBearerToken(
    authorization: string | undefined,
    expectedToken: string,
): boolean {
    const prefix = "Bearer ";
    if (!authorization?.startsWith(prefix)) {
        return false;
    }
    const supplied = Buffer.from(authorization.slice(prefix.length));
    const expected = Buffer.from(expectedToken);
    return (
        supplied.length === expected.length &&
        timingSafeEqual(supplied, expected)
    );
}

async function listen(
    server: Server,
    port: number,
    host: string,
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
}

async function closeHttpServer(server: Server): Promise<void> {
    if (!server.listening) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        server.close((error) =>
            error === undefined ? resolve() : reject(error),
        );
    });
}
