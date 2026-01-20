// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DebugLogger } from "./debugLogger.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Result of a cache check
 */
export interface CacheCheckResult {
    hit: boolean;
    result?: string;
    error?: string;
}

/**
 * Client for checking the TypeAgent cache via MCP server
 */
export class CacheClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private logger: DebugLogger | null = null;

    constructor(_mcpServerPath?: string, logger?: DebugLogger) {
        this.logger = logger || null;
        if (this.logger) {
            this.logger.log("CacheClient initialized");
        }
    }

    /**
     * Connect to the MCP server
     */
    async connect(): Promise<void> {
        if (this.client) {
            if (this.logger) {
                this.logger.log("Already connected to MCP server");
            }
            return; // Already connected
        }

        try {
            // Resolve MCP server path relative to coderWrapper package
            // __dirname points to packages/coderWrapper/dist
            // We need to go up to ts root: ../../commandExecutor/dist/server.js
            const mcpServerPath = path.resolve(
                __dirname,
                "..",
                "..",
                "commandExecutor",
                "dist",
                "server.js",
            );

            if (this.logger) {
                this.logger.log(
                    `Attempting to connect to MCP server at ${mcpServerPath}`,
                );
            }

            // Create transport and client
            this.transport = new StdioClientTransport({
                command: "node",
                args: [mcpServerPath],
            });

            if (this.logger) {
                this.logger.log("StdioClientTransport created");
            }

            this.client = new Client(
                {
                    name: "coder-wrapper-cache-client",
                    version: "0.0.1",
                },
                {
                    capabilities: {},
                },
            );

            if (this.logger) {
                this.logger.log("MCP Client created, connecting...");
            }

            await this.client.connect(this.transport);

            if (this.logger) {
                this.logger.log("Successfully connected to MCP server");
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error("Failed to connect to MCP server", error);
            }
            throw error;
        }
    }

    /**
     * Check if a request is in the cache and execute it if found
     */
    async checkCache(request: string): Promise<CacheCheckResult> {
        if (this.logger) {
            this.logger.log(`checkCache called for request: "${request}"`);
        }

        if (!this.client) {
            if (this.logger) {
                this.logger.log(
                    "Client not connected, attempting to connect...",
                );
            }
            try {
                await this.connect();
            } catch (error) {
                if (this.logger) {
                    this.logger.error(
                        "Connection failed during checkCache",
                        error,
                    );
                }
                return {
                    hit: false,
                    error: `Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }

        if (!this.client) {
            if (this.logger) {
                this.logger.error("Client is still null after connect attempt");
            }
            return {
                hit: false,
                error: "Failed to connect to MCP server",
            };
        }

        try {
            if (this.logger) {
                this.logger.log(
                    "Calling MCP execute_command tool with cacheCheck=true",
                );
            }

            const result = await this.client.callTool({
                name: "execute_command",
                arguments: {
                    request,
                    cacheCheck: true,
                },
            });

            if (this.logger) {
                this.logger.log(
                    `MCP tool call completed, result: ${JSON.stringify(result, null, 2)}`,
                );
            }

            // Parse the result
            if (
                result.content &&
                Array.isArray(result.content) &&
                result.content.length > 0
            ) {
                const content = result.content[0];
                if (content.type === "text") {
                    const text = content.text;

                    if (text.startsWith("CACHE_HIT:")) {
                        if (this.logger) {
                            this.logger.log("Cache HIT detected");
                        }
                        return {
                            hit: true,
                            result: text.substring("CACHE_HIT:".length).trim(),
                        };
                    } else if (text.startsWith("CACHE_MISS:")) {
                        const missReason = text
                            .substring("CACHE_MISS:".length)
                            .trim();
                        if (this.logger) {
                            this.logger.log(`Cache MISS: ${missReason}`);
                        }
                        return {
                            hit: false,
                            error: missReason,
                        };
                    }
                }
            }

            if (this.logger) {
                this.logger.error("Unexpected response format from MCP server");
            }
            return {
                hit: false,
                error: "Unexpected response format",
            };
        } catch (error) {
            if (this.logger) {
                this.logger.error("Cache check error", error);
            }
            return {
                hit: false,
                error: `Cache check error: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }

    /**
     * Close the connection to the MCP server
     */
    async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
        if (this.transport) {
            await this.transport.close();
            this.transport = null;
        }
    }
}
