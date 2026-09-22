// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    McpServer,
    ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
    AgentServerConnection,
    CatalogEntry,
    ProcedureArtifactRequest,
    GetSkillRequest,
    ListSkillsRequest,
    SearchSkillsRequest,
    SkillAcquisitionRequest,
} from "@typeagent/agent-server-client";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { connectToAgentServer } from "../shared/typeagent-client.js";
import {
    parseSkillResourceUri,
    skillResourceUri,
} from "../shared/skill-resource.js";

export { parseSkillResourceUri, skillResourceUri };

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

    public previewProcedureArtifact(
        request: ProcedureArtifactRequest,
    ): Promise<CallToolResult> {
        return this.managementToolCall("previewProcedureArtifact", request);
    }

    public promoteProcedureArtifact(
        request: ProcedureArtifactRequest,
    ): Promise<CallToolResult> {
        return this.managementToolCall("promoteProcedureArtifact", request);
    }

    public previewSkillAcquisition(
        request: SkillAcquisitionRequest,
    ): Promise<CallToolResult> {
        return this.managementToolCall("previewSkillAcquisition", request);
    }

    public checkSkillUpdate(
        request: SkillAcquisitionRequest,
    ): Promise<CallToolResult> {
        return this.managementToolCall("checkSkillUpdate", request);
    }

    public acquireAndPublishSkill(
        request: SkillAcquisitionRequest,
    ): Promise<CallToolResult> {
        return this.managementToolCall("acquireAndPublishSkill", request);
    }

    public updateSkill(
        request: SkillAcquisitionRequest,
    ): Promise<CallToolResult> {
        return this.managementToolCall("updateSkill", request);
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

    private managementToolCall<
        TName extends
            | "previewProcedureArtifact"
            | "promoteProcedureArtifact"
            | "previewSkillAcquisition"
            | "checkSkillUpdate"
            | "acquireAndPublishSkill"
            | "updateSkill",
    >(
        name: TName,
        request: Parameters<NonNullable<AgentServerConnection[TName]>>[0],
    ): Promise<CallToolResult> {
        return this.toolCall(async (connection) => {
            const operation = connection[name];
            if (operation === undefined) {
                throw new Error(
                    `The connected TypeAgent server does not support ${name}. Upgrade or restart the agent server and retry.`,
                );
            }
            try {
                return await (
                    operation as (value: typeof request) => Promise<unknown>
                )(request);
            } catch (error) {
                const detail =
                    error instanceof Error ? error.message : String(error);
                throw new Error(
                    `${name} failed: ${detail}. Check the request and agent-server logs, then retry.`,
                );
            }
        });
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

const skillIdentitySchema = z.object(identitySchema);
const skillAcquisitionSourceSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("directory"),
        path: z.string(),
    }),
    z.object({
        type: z.literal("git"),
        repository: z.string(),
        ref: z.string(),
        subdirectory: z.string().optional(),
    }),
    z.object({
        type: z.literal("archive"),
        path: z.string(),
        format: z.enum(["zip", "tar", "tar.gz"]).optional(),
    }),
]);
const skillAcquisitionRequestSchema = z.object({
    identity: skillIdentitySchema,
    schemaFingerprint: z.string(),
    source: skillAcquisitionSourceSchema,
    displayName: z.string().optional(),
    description: z.string().optional(),
});
const procedureSkillArtifactSchema = z.object({
    path: z.string().optional(),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional(),
});
const procedureArtifactRequestSchema = z.discriminatedUnion("kind", [
    z.object({
        corpusId: z.string(),
        procedureId: z.string(),
        version: z.number(),
        kind: z.literal("skill"),
        skill: z.object({
            identity: skillIdentitySchema,
            description: z.string().optional(),
            schema: procedureSkillArtifactSchema.optional(),
            grammar: procedureSkillArtifactSchema.optional(),
        }),
    }),
    z.object({
        corpusId: z.string(),
        procedureId: z.string(),
        version: z.number(),
        kind: z.literal("macro"),
    }),
]);

type SkillAcquisitionToolRequest = z.infer<
    typeof skillAcquisitionRequestSchema
>;
type ProcedureArtifactToolRequest = z.infer<
    typeof procedureArtifactRequestSchema
>;

function toSkillAcquisitionRequest(
    request: SkillAcquisitionToolRequest,
): SkillAcquisitionRequest {
    const source =
        request.source.type === "git"
            ? {
                  type: request.source.type,
                  repository: request.source.repository,
                  ref: request.source.ref,
                  ...(request.source.subdirectory === undefined
                      ? {}
                      : { subdirectory: request.source.subdirectory }),
              }
            : request.source.type === "archive"
              ? {
                    type: request.source.type,
                    path: request.source.path,
                    ...(request.source.format === undefined
                        ? {}
                        : { format: request.source.format }),
                }
              : request.source;
    return {
        identity: request.identity,
        schemaFingerprint: request.schemaFingerprint,
        source,
        ...(request.displayName === undefined
            ? {}
            : { displayName: request.displayName }),
        ...(request.description === undefined
            ? {}
            : { description: request.description }),
    };
}

function toProcedureArtifactRequest(
    request: ProcedureArtifactToolRequest,
): ProcedureArtifactRequest {
    if (request.kind === "macro") {
        return request;
    }
    const optionalArtifact = (
        artifact: z.infer<typeof procedureSkillArtifactSchema> | undefined,
    ) =>
        artifact === undefined
            ? undefined
            : {
                  content: artifact.content,
                  ...(artifact.path === undefined
                      ? {}
                      : { path: artifact.path }),
                  ...(artifact.encoding === undefined
                      ? {}
                      : { encoding: artifact.encoding }),
              };
    const schema = optionalArtifact(request.skill.schema);
    const grammar = optionalArtifact(request.skill.grammar);
    return {
        corpusId: request.corpusId,
        procedureId: request.procedureId,
        version: request.version,
        kind: request.kind,
        skill: {
            identity: request.skill.identity,
            ...(request.skill.description === undefined
                ? {}
                : { description: request.skill.description }),
            ...(schema === undefined ? {} : { schema }),
            ...(grammar === undefined ? {} : { grammar }),
        },
    };
}

const readOnlyToolAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
} as const;

const mutatingToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
} as const;

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
        this.server.registerTool(
            "typeagent-previewProcedureArtifact",
            {
                title: "Preview procedure artifact (read-only)",
                description:
                    "READ-ONLY: Preview the skill package or macro that would be generated from a saved procedure. Does not publish or modify anything.",
                inputSchema: procedureArtifactRequestSchema,
                annotations: readOnlyToolAnnotations,
            },
            (request) =>
                adapter.previewProcedureArtifact(
                    toProcedureArtifactRequest(request),
                ),
        );
        this.server.registerTool(
            "typeagent-promoteProcedureArtifact",
            {
                title: "Promote procedure artifact (mutating)",
                description:
                    "MUTATING: Generate and publish a skill draft or macro from a saved procedure.",
                inputSchema: procedureArtifactRequestSchema,
                annotations: mutatingToolAnnotations,
            },
            (request) =>
                adapter.promoteProcedureArtifact(
                    toProcedureArtifactRequest(request),
                ),
        );
        this.server.registerTool(
            "typeagent-previewSkillAcquisition",
            {
                title: "Preview skill acquisition (read-only)",
                description:
                    "READ-ONLY: Inspect and validate a directory, Git, or archive skill source without publishing it.",
                inputSchema: skillAcquisitionRequestSchema,
                annotations: readOnlyToolAnnotations,
            },
            (request) =>
                adapter.previewSkillAcquisition(
                    toSkillAcquisitionRequest(request),
                ),
        );
        this.server.registerTool(
            "typeagent-checkSkillUpdate",
            {
                title: "Check skill update (read-only)",
                description:
                    "READ-ONLY: Compare a skill source with the catalog revision without publishing an update.",
                inputSchema: skillAcquisitionRequestSchema,
                annotations: readOnlyToolAnnotations,
            },
            (request) =>
                adapter.checkSkillUpdate(toSkillAcquisitionRequest(request)),
        );
        this.server.registerTool(
            "typeagent-acquireAndPublishSkill",
            {
                title: "Acquire and publish skill draft (mutating)",
                description:
                    "MUTATING: Acquire a directory, Git, or archive source and publish the validated package as a new catalog draft.",
                inputSchema: skillAcquisitionRequestSchema,
                annotations: mutatingToolAnnotations,
            },
            (request) =>
                adapter.acquireAndPublishSkill(
                    toSkillAcquisitionRequest(request),
                ),
        );
        this.server.registerTool(
            "typeagent-updateSkill",
            {
                title: "Update skill from source (mutating)",
                description:
                    "MUTATING: Reacquire a skill source and publish a new draft revision when its content or metadata changed.",
                inputSchema: skillAcquisitionRequestSchema,
                annotations: mutatingToolAnnotations,
            },
            (request) =>
                adapter.updateSkill(toSkillAcquisitionRequest(request)),
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
        await this.connect(new StdioServerTransport());
    }

    public async connect(transport: Transport): Promise<void> {
        await this.server.connect(transport);
    }

    public async close(): Promise<void> {
        await this.server.close();
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
