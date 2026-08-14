// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionResult,
    AppAgent,
    AppAgentManifest,
    SessionContext,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import type { AppAgentProvider } from "agent-dispatcher";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import {
    McpConnection,
    type McpConnectionOptions,
    type McpTransportConfig,
} from "./mcpConnection.js";
import { convertToolResult } from "./mcpResult.js";
import {
    NormalizedMcpServerConfig,
    resolveTransportConfig,
} from "./mcpServerConfig.js";
import registerDebug from "debug";
import type { McpCredentialStore } from "./mcpCredentialStore.js";
import type { McpAuditSink } from "./mcpAudit.js";
import { sanitizeMcpAuditEvent } from "./mcpAudit.js";
import type { McpOAuthInteraction } from "./mcpOAuth.js";
import { McpOAuthProvider } from "./mcpOAuth.js";
import type { McpPolicy } from "./mcpPolicy.js";
import { enforceMcpPolicy } from "./mcpPolicy.js";
import {
    buildMcpToolCatalog,
    getMcpToolIdentity,
    type McpToolCatalog,
    type McpToolCatalogEntry,
} from "./mcpToolCatalog.js";

const debug = registerDebug("typeagent:mcp:server");
const debugError = registerDebug("typeagent:mcp:server:error");
const entryTypeName = "AgentActions";

export type McpClientInfo = { name: string; version: string };

export interface McpConnectionLike {
    readonly protocolEra: string | undefined;
    readonly protocolVersion: string | undefined;
    readonly supportsToolListChanged: boolean;
    listTools(): Promise<Tool[]>;
    callTool(
        name: string,
        args: Record<string, unknown> | undefined,
    ): Promise<CallToolResult>;
    close(): Promise<void>;
}

export interface McpRefreshScheduler {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
}

const defaultScheduler: McpRefreshScheduler = {
    setTimeout(callback, delayMs) {
        return globalThis.setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
};

export interface McpHostServices {
    credentialStore: McpCredentialStore;
    policy: McpPolicy;
    audit: McpAuditSink;
    oauthInteraction?: McpOAuthInteraction;
    connectionFactory?: (
        clientInfo: McpClientInfo,
        transport: McpTransportConfig,
        options: McpConnectionOptions,
    ) => Promise<McpConnectionLike>;
    refreshScheduler?: McpRefreshScheduler;
    refreshDebounceMs?: number;
}

type CatalogSnapshot = {
    readonly catalog: McpToolCatalog;
    readonly manifest: AppAgentManifest;
};

type McpServerAgent = {
    readonly agent: AppAgent;
    readonly connection: McpConnectionLike | undefined;
    getManifest(): AppAgentManifest;
    dispose(): Promise<void>;
};

type McpExecuteAction = NonNullable<AppAgent["executeAction"]>;
type McpAction = Parameters<McpExecuteAction>[0];
type McpActionContext = Parameters<McpExecuteAction>[1];
type McpToolDecision = "allow" | "allow-once" | "session-allow" | "deny";

function filterConfiguredTools(
    tools: Tool[],
    config: NormalizedMcpServerConfig,
): Tool[] {
    let filtered = tools;
    if (config.enabledTools !== undefined) {
        const allow = new Set(config.enabledTools);
        filtered = filtered.filter((tool) => allow.has(tool.name));
    }
    if (config.deniedTools !== undefined) {
        const denied = new Set(config.deniedTools);
        filtered = filtered.filter((tool) => !denied.has(tool.name));
    }
    return filtered;
}

function createSnapshot(
    name: string,
    config: NormalizedMcpServerConfig,
    tools: Tool[],
): CatalogSnapshot {
    const catalog = buildMcpToolCatalog(
        config.id,
        filterConfiguredTools(tools, config),
        entryTypeName,
    );
    if (catalog.entries.size === 0) {
        throw new Error(`No usable tools found for MCP server '${name}'`);
    }
    const schemaFile = Object.freeze({
        format: "pas" as const,
        content: catalog.schemaContent,
    });
    const manifest = Object.freeze({
        emojiChar: config.emojiChar ?? "🔌",
        description: config.description ?? name,
        schema: Object.freeze({
            description: config.description ?? name,
            schemaType: entryTypeName,
            schemaFile,
        }),
    });
    return Object.freeze({ catalog, manifest });
}

function logSkippedTools(name: string, catalog: McpToolCatalog): void {
    if (catalog.skipped.length === 0) {
        return;
    }
    debugError(
        `[${name}] ${catalog.skipped.length} tool(s) skipped: ${catalog.skipped
            .map((item) => `${item.id} (${item.reason})`)
            .join("; ")}`,
    );
}

function getTransportSensitiveValues(
    transport: Awaited<ReturnType<typeof resolveTransportConfig>>,
): string[] {
    return transport.kind === "http"
        ? Object.values(transport.headers ?? {})
        : Object.values(transport.env ?? {});
}

function getConfiguredToolDecision(
    config: NormalizedMcpServerConfig,
    toolName: string,
): "allow" | "deny" | undefined {
    return (
        config.toolApproval?.persisted?.[toolName] ??
        (config.toolApproval?.deny?.includes(toolName)
            ? "deny"
            : config.toolApproval?.allow?.includes(toolName)
              ? "allow"
              : undefined)
    );
}

function shouldPromptForTool(
    config: NormalizedMcpServerConfig,
    tool: McpToolCatalogEntry,
): boolean {
    return (
        config.toolApproval?.prompt?.includes(tool.name) === true ||
        tool.annotations?.destructiveHint === true ||
        tool.annotations?.readOnlyHint !== true
    );
}

async function requestToolDecision(
    context: McpActionContext,
    config: NormalizedMcpServerConfig,
    tool: McpToolCatalogEntry,
    toolId: string,
    configured: "allow" | undefined,
    sessionApprovals: Map<string, Set<string>>,
    parameters: Record<string, unknown> | undefined,
    sensitiveValues: string[],
): Promise<McpToolDecision> {
    const sessionId = context.sessionContext.sessionContextId;
    if (
        configured === "allow" ||
        !shouldPromptForTool(config, tool) ||
        sessionApprovals.get(sessionId)?.has(toolId)
    ) {
        return configured ?? "allow";
    }
    const choice = await context.sessionContext.popupQuestion(
        `Allow MCP server '${config.name}' to run potentially mutating tool '${tool.name}'? Tool annotations are untrusted hints. Arguments: ${JSON.stringify(
            sanitizeMcpAuditEvent({
                timestamp: "",
                operation: "tool-invocation",
                configId: config.id,
                configName: config.name,
                arguments: parameters,
                sensitiveValues,
            }).arguments,
        )}`,
        ["Allow once", "Allow for session", "Deny"],
        2,
    );
    if (choice !== 1) {
        return choice === 2 ? "deny" : "allow-once";
    }
    const session = sessionApprovals.get(sessionId) ?? new Set<string>();
    session.add(toolId);
    sessionApprovals.set(sessionId, session);
    return "session-allow";
}

async function writeToolResultAudit(
    services: McpHostServices,
    config: NormalizedMcpServerConfig,
    tool: McpToolCatalogEntry,
    toolId: string,
    sessionId: string,
    started: number,
    status: "success" | "failure",
    error?: string,
): Promise<void> {
    await services.audit.write({
        timestamp: new Date().toISOString(),
        operation: "tool-result",
        configId: config.id,
        configName: config.name,
        tool: tool.name,
        toolId,
        sessionId,
        status,
        durationMs: Date.now() - started,
        ...(error === undefined ? {} : { error }),
    });
}

async function callMcpTool(
    connection: McpConnectionLike,
    services: McpHostServices,
    config: NormalizedMcpServerConfig,
    tool: McpToolCatalogEntry,
    toolId: string,
    sessionId: string,
    parameters: Record<string, unknown>,
): Promise<ActionResult | undefined> {
    const started = Date.now();
    try {
        const result = await connection.callTool(tool.name, parameters);
        if (!result.isError && tool.validateOutput !== undefined) {
            const outputValidation = tool.validateOutput(
                result.structuredContent,
            );
            if (!outputValidation.valid) {
                const message = `MCP tool '${tool.name}' on server '${config.name}' (${config.id}) returned output that does not match outputSchema: ${outputValidation.errorMessage}`;
                await writeToolResultAudit(
                    services,
                    config,
                    tool,
                    toolId,
                    sessionId,
                    started,
                    "failure",
                    message,
                );
                return createActionResultFromError(message);
            }
        }
        await writeToolResultAudit(
            services,
            config,
            tool,
            toolId,
            sessionId,
            started,
            "success",
        );
        return convertToolResult(tool.name, result);
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        await writeToolResultAudit(
            services,
            config,
            tool,
            toolId,
            sessionId,
            started,
            "failure",
            errorMessage,
        );
        if (
            /output schema|outputSchema|structured content/i.test(errorMessage)
        ) {
            return createActionResultFromError(
                `MCP tool '${tool.name}' on server '${config.name}' (${config.id}) returned invalid output: ${errorMessage}`,
            );
        }
        throw error;
    }
}

function createMcpExecuteAction(
    config: NormalizedMcpServerConfig,
    services: McpHostServices,
    connection: McpConnectionLike,
    getSnapshot: () => CatalogSnapshot | undefined,
    sessionContexts: Set<SessionContext>,
    sessionApprovals: Map<string, Set<string>>,
    sensitiveValues: string[],
): McpExecuteAction {
    return async (action: McpAction, context: McpActionContext) => {
        sessionContexts.add(context.sessionContext);
        enforceMcpPolicy(services.policy, "invoke", config);
        const toolId = getMcpToolIdentity(config.id, action.actionName);
        const tool = getSnapshot()?.catalog.entries.get(toolId);
        if (tool === undefined) {
            return createActionResultFromError(
                `MCP tool '${action.actionName}' is not enabled for server '${config.name}' (${config.id}).`,
            );
        }
        const argumentValidation = tool.validateArguments(
            action.parameters ?? {},
        );
        if (!argumentValidation.valid) {
            return createActionResultFromError(
                `MCP tool '${tool.name}' on server '${config.name}' (${config.id}) rejected its arguments: ${argumentValidation.errorMessage}`,
            );
        }
        const configured = getConfiguredToolDecision(config, tool.name);
        if (configured === "deny") {
            return createActionResultFromError(
                `MCP tool '${tool.name}' is denied by server '${config.name}' policy.`,
            );
        }
        const sessionId = context.sessionContext.sessionContextId;
        const decision = await requestToolDecision(
            context,
            config,
            tool,
            toolId,
            configured,
            sessionApprovals,
            action.parameters,
            sensitiveValues,
        );
        if (decision === "deny") {
            return createActionResultFromError(
                `MCP tool '${tool.name}' on server '${config.name}' was denied by the user.`,
            );
        }
        await services.audit.write({
            timestamp: new Date().toISOString(),
            operation: "tool-invocation",
            configId: config.id,
            configName: config.name,
            tool: tool.name,
            toolId,
            sessionId,
            transport: config.transport.kind,
            source: config.provenance.source,
            decision,
            arguments: action.parameters,
            sensitiveValues,
        });
        return callMcpTool(
            connection,
            services,
            config,
            tool,
            toolId,
            sessionId,
            argumentValidation.data,
        );
    };
}

async function connectServerAgent(
    name: string,
    config: NormalizedMcpServerConfig,
    clientInfo: McpClientInfo,
    services: McpHostServices,
): Promise<McpServerAgent> {
    let connection: McpConnectionLike | undefined;
    let disposed = false;
    let snapshot: CatalogSnapshot | undefined;
    let refreshTimer: unknown;
    let refreshRunning = false;
    let refreshPending = false;
    let pendingError: Error | null = null;
    let pendingTools: Tool[] | null = null;
    const scheduler = services.refreshScheduler ?? defaultScheduler;
    const sessionContexts = new Set<SessionContext>();
    const sessionApprovals = new Map<string, Set<string>>();

    const auditRefresh = async (
        status: "success" | "failure",
        decision: "updated" | "no-op" | "rollback",
        error?: string,
        toolCount?: number,
        skippedCount?: number,
    ): Promise<void> => {
        await services.audit.write({
            timestamp: new Date().toISOString(),
            operation: "catalog-refresh",
            configId: config.id,
            configName: config.name,
            transport: config.transport.kind,
            source: config.provenance.source,
            status,
            decision,
            previousCount: snapshot?.catalog.entries.size ?? 0,
            ...(toolCount === undefined ? {} : { toolCount }),
            ...(skippedCount === undefined ? {} : { skippedCount }),
            ...(error === undefined ? {} : { error }),
        });
    };

    const reloadSessions = async (): Promise<void> => {
        for (const context of [...sessionContexts]) {
            try {
                await context.reloadAgentSchema();
            } catch (error) {
                debugError(
                    `[${name}] schema reload failed for session '${context.sessionContextId}': ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
    };

    const refreshCatalog = async (
        error: Error | null,
        tools: Tool[] | null,
    ): Promise<void> => {
        if (disposed) {
            return;
        }
        if (error !== null) {
            await auditRefresh("failure", "rollback", error.message);
            debugError(
                `[${name}] tool catalog refresh failed: ${error.message}`,
            );
            return;
        }
        try {
            const listedTools = tools ?? (await connection!.listTools());
            const next = createSnapshot(name, config, listedTools);
            logSkippedTools(name, next.catalog);
            if (disposed) {
                return;
            }
            if (next.catalog.fingerprint === snapshot?.catalog.fingerprint) {
                await auditRefresh(
                    "success",
                    "no-op",
                    undefined,
                    next.catalog.entries.size,
                    next.catalog.skipped.length,
                );
                return;
            }
            const previousCount = snapshot?.catalog.entries.size ?? 0;
            snapshot = next;
            await services.audit.write({
                timestamp: new Date().toISOString(),
                operation: "catalog-refresh",
                configId: config.id,
                configName: config.name,
                transport: config.transport.kind,
                source: config.provenance.source,
                status: "success",
                decision: "updated",
                previousCount,
                toolCount: next.catalog.entries.size,
                skippedCount: next.catalog.skipped.length,
            });
            await reloadSessions();
        } catch (refreshError) {
            const message =
                refreshError instanceof Error
                    ? refreshError.message
                    : String(refreshError);
            await auditRefresh("failure", "rollback", message, 0);
            debugError(
                `[${name}] tool catalog refresh rolled back: ${message}`,
            );
        }
    };

    const runPendingRefresh = async (): Promise<void> => {
        if (disposed || refreshRunning || !refreshPending) {
            return;
        }
        refreshRunning = true;
        refreshPending = false;
        const error = pendingError;
        const tools = pendingTools;
        pendingError = null;
        pendingTools = null;
        try {
            await refreshCatalog(error, tools);
        } finally {
            refreshRunning = false;
            if (refreshPending && !disposed) {
                refreshTimer = scheduler.setTimeout(
                    () => void runPendingRefresh(),
                    services.refreshDebounceMs ?? 100,
                );
            }
        }
    };

    const queueRefresh = (error: Error | null, tools: Tool[] | null): void => {
        if (disposed) {
            return;
        }
        pendingError = error;
        pendingTools = tools;
        refreshPending = true;
        if (refreshRunning) {
            return;
        }
        if (refreshTimer !== undefined) {
            scheduler.clearTimeout(refreshTimer);
        }
        refreshTimer = scheduler.setTimeout(() => {
            refreshTimer = undefined;
            void runPendingRefresh();
        }, services.refreshDebounceMs ?? 100);
    };

    const connectStarted = Date.now();
    try {
        enforceMcpPolicy(services.policy, "connect", config);
        const transport = await resolveTransportConfig(
            config,
            services.credentialStore,
        );
        const sensitiveValues = getTransportSensitiveValues(transport);
        if (transport.kind === "http" && config.oauth?.enabled === true) {
            transport.authProvider = new McpOAuthProvider(
                config,
                services.credentialStore,
                services.oauthInteraction,
            );
        }
        const connectionFactory =
            services.connectionFactory ??
            ((info, resolvedTransport, options) =>
                McpConnection.create(info, resolvedTransport, options));
        const connected = await connectionFactory(clientInfo, transport, {
            toolsChanged: queueRefresh,
            listChangedDebounceMs: 0,
        });
        connection = connected;
        await services.audit.write({
            timestamp: new Date().toISOString(),
            operation: "connect",
            configId: config.id,
            configName: config.name,
            transport: config.transport.kind,
            source: config.provenance.source,
            status: "success",
            durationMs: Date.now() - connectStarted,
        });
        debug(
            `[${name}] connected (era=${connected.protocolEra}, version=${connected.protocolVersion}, listChanged=${connected.supportsToolListChanged})`,
        );
        snapshot = createSnapshot(name, config, await connected.listTools());
        logSkippedTools(name, snapshot.catalog);

        const activeConnection = connected;
        const agent: AppAgent = {
            startBackgroundTasks: async (context) => {
                sessionContexts.add(context);
            },
            stopBackgroundTasks: async (context) => {
                sessionContexts.delete(context);
            },
            updateAgentContext: async (_enable, context) => {
                sessionContexts.add(context);
            },
            closeAgentContext: async (context) => {
                sessionContexts.delete(context);
                sessionApprovals.delete(context.sessionContextId);
            },
            executeAction: createMcpExecuteAction(
                config,
                services,
                activeConnection,
                () => snapshot,
                sessionContexts,
                sessionApprovals,
                sensitiveValues,
            ),
        };
        return {
            agent,
            connection: connected,
            getManifest: () => snapshot!.manifest,
            async dispose() {
                if (disposed) {
                    return;
                }
                disposed = true;
                sessionContexts.clear();
                sessionApprovals.clear();
                if (refreshTimer !== undefined) {
                    scheduler.clearTimeout(refreshTimer);
                    refreshTimer = undefined;
                }
                await activeConnection.close();
            },
        };
    } catch (error) {
        await services.audit.write({
            timestamp: new Date().toISOString(),
            operation: "connect",
            configId: config.id,
            configName: config.name,
            transport: config.transport.kind,
            source: config.provenance.source,
            status: "failure",
            durationMs: Date.now() - connectStarted,
            error: error instanceof Error ? error.message : String(error),
        });
        debugError(
            `[${name}] failed to connect: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        disposed = true;
        if (refreshTimer !== undefined) {
            scheduler.clearTimeout(refreshTimer);
        }
        if (connection !== undefined) {
            await connection.close().catch(() => {});
        }
        const fallbackManifest: AppAgentManifest = {
            emojiChar: config.emojiChar ?? "🔌",
            description: config.description ?? name,
            schema: {
                description: config.description ?? name,
                schemaType: entryTypeName,
                schemaFile: { format: "pas", content: "" },
            },
        };
        return {
            agent: {
                updateAgentContext() {
                    throw error;
                },
            },
            connection: undefined,
            getManifest: () => fallbackManifest,
            async dispose() {},
        };
    }
}

export function createMcpServerAppAgentProvider(
    name: string,
    config: NormalizedMcpServerConfig,
    clientInfo: McpClientInfo,
    services: McpHostServices,
): AppAgentProvider {
    let agentP: Promise<McpServerAgent> | undefined;
    let count = 0;

    function ensureAgent(): Promise<McpServerAgent> {
        if (agentP === undefined) {
            agentP = connectServerAgent(name, config, clientInfo, services);
        }
        return agentP;
    }

    return {
        getAppAgentNames: () => [name],
        getLoadingAgentNames: () => [],
        isLoaded: (n: string) => n === name && count > 0,
        async getAppAgentManifest(n: string) {
            if (n !== name) {
                throw new Error(`Unknown MCP agent '${n}'`);
            }
            const agentData = await ensureAgent();
            const manifest = agentData.getManifest();
            if (count === 0 && agentP !== undefined) {
                agentP = undefined;
                await agentData.dispose().catch(() => {});
            }
            return manifest;
        },
        async loadAppAgent(n: string) {
            if (n !== name) {
                throw new Error(`Unknown MCP agent '${n}'`);
            }
            count++;
            return (await ensureAgent()).agent;
        },
        async unloadAppAgent(n: string) {
            if (n !== name) {
                throw new Error(`Unknown MCP agent '${n}'`);
            }
            if (count === 0) {
                return;
            }
            if (--count === 0 && agentP !== undefined) {
                const agentData = await agentP;
                agentP = undefined;
                await agentData.dispose().catch(() => {});
            }
        },
    };
}
