// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    McpServer,
    ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
    AgentServerConnection,
    CatalogEntry,
    GetSkillRequest,
    ListSkillsRequest,
    ReadSkillFileRequest,
    SearchSkillsRequest,
    SkillIdentity,
} from "@typeagent/agent-server-client";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { connectToAgentServer } from "../shared/typeagent-client.js";

export interface SkillsServerDependencies {
    connect: () => Promise<AgentServerConnection>;
}

export interface McpSkillResource {
    uri: string;
    digest: string;
    size: number;
}

export interface McpSkill {
    uri: string;
    frontmatter: Record<string, unknown> & {
        name: string;
        description: string;
    };
    resources: McpSkillResource[];
}

const defaultDependencies: SkillsServerDependencies = {
    connect: connectToAgentServer,
};

function toolResult(value: unknown): CallToolResult {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, undefined, 2),
            },
        ],
    };
}

function toolError(error: unknown): CallToolResult {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
            },
        ],
    };
}

export function skillResourceUri(
    identity: SkillIdentity,
    revision: string,
    filePath: string,
): string {
    validateResourcePath(filePath);
    return `skill://typeagent/${encodeSegment(
        JSON.stringify(identity),
    )}/${encodeURIComponent(revision)}/${encodeURIComponent(
        identity.name,
    )}/${filePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;
}

export function parseSkillResourceUri(uri: URL): ReadSkillFileRequest {
    if (uri.protocol !== "skill:" || uri.hostname !== "typeagent") {
        throw new Error(`Unsupported skill resource URI: ${uri.href}`);
    }
    const parts = uri.pathname.split("/").filter(Boolean);
    if (parts.length < 4) {
        throw new Error(`Invalid skill resource URI: ${uri.href}`);
    }
    let identity: SkillIdentity;
    try {
        identity = JSON.parse(decodeSegment(parts[0])) as SkillIdentity;
    } catch {
        throw new Error(`Invalid skill identity in resource URI: ${uri.href}`);
    }
    if (decodeURIComponent(parts[2]) !== identity.name) {
        throw new Error(`Skill name does not match resource URI: ${uri.href}`);
    }
    const filePath = parts
        .slice(3)
        .map((part) => decodeURIComponent(part))
        .join("/");
    validateResourcePath(filePath, uri.href);
    return {
        identity,
        revision: decodeURIComponent(parts[1]),
        path: filePath,
    };
}

export class SkillsCatalogAdapter {
    public constructor(
        private readonly dependencies: SkillsServerDependencies = defaultDependencies,
    ) {}

    public listSkills(request: ListSkillsRequest): Promise<CallToolResult> {
        return this.toolCall((connection) => {
            if (connection.listSkills === undefined) {
                throw unsupportedSkillsApi();
            }
            return connection.listSkills(request);
        });
    }

    public searchSkills(request: SearchSkillsRequest): Promise<CallToolResult> {
        return this.toolCall((connection) => {
            if (connection.searchSkills === undefined) {
                throw unsupportedSkillsApi();
            }
            return connection.searchSkills(request);
        });
    }

    public getSkill(request: GetSkillRequest): Promise<CallToolResult> {
        return this.toolCall((connection) => {
            if (connection.getSkill === undefined) {
                throw unsupportedSkillsApi();
            }
            return connection.getSkill(request);
        });
    }

    public async listProtocolSkills(cursor?: string): Promise<{
        resultType: "complete";
        skills: McpSkill[];
        ttlMs: number;
        cacheScope: "private";
        nextCursor?: string;
    }> {
        const offset = decodeCursor(cursor);
        const pageSize = 50;
        const { skills, hasMore } = await this.withConnection(
            async (connection) => {
                if (
                    connection.listSkills === undefined ||
                    connection.readSkillFile === undefined
                ) {
                    throw unsupportedSkillsApi();
                }
                const active = await connection.listSkills({
                    activeOnly: true,
                });
                const page = active.slice(offset, offset + pageSize);
                return {
                    skills: await Promise.all(
                        page.map((entry) =>
                            this.toProtocolSkill(connection, entry),
                        ),
                    ),
                    hasMore: offset + pageSize < active.length,
                };
            },
        );
        return {
            resultType: "complete",
            skills,
            ttlMs: 300_000,
            cacheScope: "private",
            ...(hasMore ? { nextCursor: encodeCursor(offset + pageSize) } : {}),
        };
    }

    public async getProtocolSkill(uri: string): Promise<{
        resultType: "complete";
        skill: McpSkill;
        ttlMs: number;
        cacheScope: "private";
    }> {
        const request = parseSkillResourceUri(new URL(uri));
        if (request.path !== "SKILL.md") {
            throw new Error(
                "A skill URI must identify its root SKILL.md file.",
            );
        }
        const skill = await this.withConnection(async (connection) => {
            if (
                connection.getSkill === undefined ||
                connection.readSkillFile === undefined
            ) {
                throw unsupportedSkillsApi();
            }
            const entry = await connection.getSkill({
                identity: request.identity,
                revision: request.revision,
            });
            if (entry === undefined || !entry.active) {
                throw new Error(`Unknown active skill URI: ${uri}`);
            }
            return this.toProtocolSkill(connection, entry);
        });
        return {
            resultType: "complete",
            skill,
            ttlMs: 300_000,
            cacheScope: "private",
        };
    }

    public async listResources() {
        const entries = await this.withConnection((connection) => {
            if (connection.listSkills === undefined) {
                throw unsupportedSkillsApi();
            }
            return connection.listSkills({ activeOnly: true });
        });
        return {
            resources: entries.flatMap((entry) =>
                entry.revision.manifest.map((file) => ({
                    uri: skillResourceUri(
                        entry.revision.identity,
                        entry.revision.revision,
                        file.path,
                    ),
                    name: `${entry.revision.qualifiedName}/${file.path}`,
                    description: `${entry.state} skill revision ${entry.revision.revision}`,
                    mimeType: mimeType(file.path),
                })),
            ),
        };
    }

    public async readResource(uri: URL) {
        const response = await this.withConnection((connection) => {
            if (connection.readSkillFile === undefined) {
                throw unsupportedSkillsApi();
            }
            return connection.readSkillFile(parseSkillResourceUri(uri));
        });
        return {
            contents: [
                {
                    uri: uri.href,
                    mimeType: response.mimeType,
                    blob: response.content,
                },
            ],
        };
    }

    private async toolCall(
        operation: (connection: AgentServerConnection) => Promise<unknown>,
    ): Promise<CallToolResult> {
        try {
            return toolResult(await this.withConnection(operation));
        } catch (error) {
            return toolError(error);
        }
    }

    private async withConnection<T>(
        operation: (connection: AgentServerConnection) => Promise<T>,
    ): Promise<T> {
        const connection = await this.dependencies.connect();
        try {
            return await operation(connection);
        } finally {
            await connection.close();
        }
    }

    private async toProtocolSkill(
        connection: AgentServerConnection,
        entry: CatalogEntry,
    ): Promise<McpSkill> {
        const skillFile = entry.revision.manifest.find(
            (file) => file.path === "SKILL.md",
        );
        if (skillFile === undefined || connection.readSkillFile === undefined) {
            throw new Error(
                `${entry.revision.qualifiedName} does not contain a root SKILL.md.`,
            );
        }
        const content = await connection.readSkillFile({
            identity: entry.revision.identity,
            revision: entry.revision.revision,
            path: "SKILL.md",
        });
        const frontmatter = parseFrontmatter(
            Buffer.from(content.content, "base64").toString("utf8"),
        );
        if (frontmatter.name !== entry.revision.identity.name) {
            throw new Error(
                `SKILL.md name '${frontmatter.name}' does not match catalog name '${entry.revision.identity.name}'.`,
            );
        }
        return {
            uri: skillResourceUri(
                entry.revision.identity,
                entry.revision.revision,
                "SKILL.md",
            ),
            frontmatter,
            resources: entry.revision.manifest.map((file) => ({
                uri: skillResourceUri(
                    entry.revision.identity,
                    entry.revision.revision,
                    file.path,
                ),
                digest: `sha256:${file.sha256}`,
                size: file.size,
            })),
        };
    }
}

function unsupportedSkillsApi(): Error {
    return new Error(
        "The connected TypeAgent server does not support the skills catalog API.",
    );
}

const identitySchema = {
    scope: z.enum(["builtin", "user", "project", "package"]),
    origin: z.string().min(1),
    name: z.string().min(1),
};

export class TypeAgentSkillsMcpServer {
    private readonly server = new McpServer({
        name: "typeagent-skills",
        version: "0.1.0",
    });

    public constructor(adapter = new SkillsCatalogAdapter()) {
        this.server.server.registerCapabilities({
            experimental: {
                "io.modelcontextprotocol/skills": {
                    directoryRead: false,
                },
            },
        });
        this.server.server.setRequestHandler(
            z.object({
                method: z.literal("server/discover"),
                params: z.object({}).passthrough().optional(),
            }),
            () => ({
                capabilities: {
                    resources: {},
                    extensions: {
                        "io.modelcontextprotocol/skills": {
                            directoryRead: false,
                        },
                    },
                },
            }),
        );
        this.server.server.setRequestHandler(
            z.object({
                method: z.literal("skills/list"),
                params: z
                    .object({ cursor: z.string().optional() })
                    .passthrough()
                    .optional(),
            }),
            (request) => adapter.listProtocolSkills(request.params?.cursor),
        );
        this.server.server.setRequestHandler(
            z.object({
                method: z.literal("skills/get"),
                params: z.object({ uri: z.string().url() }).passthrough(),
            }),
            (request) => adapter.getProtocolSkill(request.params.uri),
        );
        this.server.tool(
            "typeagent-listSkills",
            "List local TypeAgent skill package revisions. This never executes a skill.",
            {
                states: z
                    .array(
                        z.enum([
                            "draft",
                            "validated",
                            "approved",
                            "active",
                            "disabled",
                            "archived",
                        ]),
                    )
                    .optional(),
                scopes: z
                    .array(z.enum(["builtin", "user", "project", "package"]))
                    .optional(),
                activeOnly: z.boolean().optional(),
            },
            (request) =>
                adapter.listSkills({
                    ...(request.states === undefined
                        ? {}
                        : { states: request.states }),
                    ...(request.scopes === undefined
                        ? {}
                        : { scopes: request.scopes }),
                    ...(request.activeOnly === undefined
                        ? {}
                        : { activeOnly: request.activeOnly }),
                }),
        );
        this.server.tool(
            "typeagent-searchSkills",
            "Search the local TypeAgent skill catalog by exact name or origin-qualified identity.",
            {
                query: z.string().min(1),
                scopes: z
                    .array(z.enum(["builtin", "user", "project", "package"]))
                    .optional(),
                limit: z.number().int().positive().max(100).optional(),
            },
            (request) =>
                adapter.searchSkills({
                    query: request.query,
                    ...(request.scopes === undefined
                        ? {}
                        : { scopes: request.scopes }),
                    ...(request.limit === undefined
                        ? {}
                        : { limit: request.limit }),
                }),
        );
        this.server.tool(
            "typeagent-getSkill",
            "Get metadata and the full file manifest for one skill revision.",
            {
                identity: z.object(identitySchema),
                revision: z.string().min(1).optional(),
            },
            (request) =>
                adapter.getSkill({
                    identity: request.identity,
                    ...(request.revision === undefined
                        ? {}
                        : { revision: request.revision }),
                }),
        );
        this.server.registerResource(
            "typeagent-skill-file",
            new ResourceTemplate(
                "typeagent-skills://catalog/{identity}/{revision}/files/{file}",
                { list: () => adapter.listResources() },
            ),
            { mimeType: "application/octet-stream" },
            (uri) => adapter.readResource(uri),
        );
    }

    public async start(): Promise<void> {
        await this.server.connect(new StdioServerTransport());
    }
}

function encodeSegment(value: string): string {
    return Buffer.from(value).toString("base64url");
}

function decodeSegment(value: string): string {
    return Buffer.from(value, "base64url").toString("utf8");
}

function validateResourcePath(filePath: string, uri?: string): void {
    if (
        filePath.length === 0 ||
        filePath.startsWith("/") ||
        filePath.includes("\\") ||
        filePath.split("/").some((part) => part === "." || part === "..")
    ) {
        throw new Error(
            uri === undefined
                ? `Unsafe skill file path: ${filePath}`
                : `Unsafe skill file path in resource URI: ${uri}`,
        );
    }
}

function encodeCursor(offset: number): string {
    return Buffer.from(String(offset)).toString("base64url");
}

function decodeCursor(cursor?: string): number {
    if (cursor === undefined) return 0;
    const value = Number.parseInt(
        Buffer.from(cursor, "base64url").toString("utf8"),
        10,
    );
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("Invalid skills/list cursor.");
    }
    return value;
}

function parseFrontmatter(
    markdown: string,
): Record<string, unknown> & { name: string; description: string } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (match === null) {
        throw new Error("SKILL.md must begin with YAML frontmatter.");
    }
    const parsed: unknown = parseYaml(match[1]);
    if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
    ) {
        throw new Error("SKILL.md frontmatter must be a YAML object.");
    }
    const frontmatter = parsed as Record<string, unknown>;
    if (
        typeof frontmatter.name !== "string" ||
        frontmatter.name.length === 0 ||
        typeof frontmatter.description !== "string" ||
        frontmatter.description.length === 0
    ) {
        throw new Error(
            "SKILL.md frontmatter requires non-empty name and description fields.",
        );
    }
    return frontmatter as Record<string, unknown> & {
        name: string;
        description: string;
    };
}

function mimeType(filePath: string): string {
    if (filePath.endsWith(".json")) return "application/json";
    if (filePath.endsWith(".md")) return "text/markdown";
    if (filePath.endsWith(".agr") || filePath.endsWith(".txt")) {
        return "text/plain";
    }
    return "application/octet-stream";
}
