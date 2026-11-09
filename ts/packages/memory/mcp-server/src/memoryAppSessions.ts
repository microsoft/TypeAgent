// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { MemoryService } from "@typeagent/memory-service";
import { MemoryMcpServer } from "./memoryMcpServer.js";

interface Session {
    server: MemoryMcpServer;
    transport: WebStandardStreamableHTTPServerTransport;
}

/** Apps need connection-scoped initialize capabilities, unlike the default stateless host. */
export class MemoryAppSessions {
    private readonly sessions = new Map<string, Session>();
    private pending = 0;

    constructor(
        private readonly service: MemoryService,
        private readonly active: Set<MemoryMcpServer>,
        private readonly onError: (error: Error) => void,
    ) {}

    async handle(request: Request, parsedBody: unknown): Promise<Response> {
        const id = request.headers.get("mcp-session-id");
        if (id) {
            const session = this.sessions.get(id);
            if (!session)
                return this.error(
                    404,
                    "Memory Apps session expired; reconnect",
                );
            return session.transport.handleRequest(request, { parsedBody });
        }
        if (this.sessions.size + this.pending >= 64)
            return this.error(
                503,
                "Memory Apps session limit reached; retry later",
            );
        this.pending++;
        try {
            return await this.initialize(request, parsedBody);
        } finally {
            this.pending--;
        }
    }

    private async initialize(
        request: Request,
        parsedBody: unknown,
    ): Promise<Response> {
        const server = new MemoryMcpServer(this.service, { previews: true });
        let sessionId: string | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            onsessioninitialized: (id) => {
                sessionId = id;
                this.sessions.set(id, { server, transport });
                timer = setTimeout(() => {
                    void server
                        .close()
                        .catch((error: unknown) =>
                            this.onError(
                                error instanceof Error
                                    ? error
                                    : new Error(String(error)),
                            ),
                        );
                }, 15 * 60_000);
                timer.unref();
            },
        });
        this.active.add(server);
        server.server.server.onerror = this.onError;
        server.server.server.onclose = () => {
            if (timer) clearTimeout(timer);
            if (sessionId) this.sessions.delete(sessionId);
            this.active.delete(server);
        };
        try {
            await server.start(transport);
            const response = await transport.handleRequest(request, {
                parsedBody,
            });
            if (!sessionId) await server.close();
            return response;
        } catch (error) {
            await server.close();
            throw error;
        }
    }

    private error(status: number, message: string): Response {
        return Response.json(
            {
                jsonrpc: "2.0",
                id: null,
                error: { code: -32000, message },
            },
            { status },
        );
    }
}
