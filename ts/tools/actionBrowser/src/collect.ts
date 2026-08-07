// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getDefaultAppAgentProviders } from "default-agent-provider";
import {
    getAllActionConfigProvider,
    getAppAgentName,
    type ActionConfig,
} from "agent-dispatcher/internal";
import type { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import type { AppAgentManifest, GrammarContent } from "@typeagent/agent-sdk";
import { extractParams } from "./paramTypes.js";
import { extractPhrasings, extractCompiledPhrasings } from "./phrasings.js";
import { collectCommands } from "./commands.js";
import { categoryForAgent } from "./categories.js";
import { joinComments } from "./util.js";
import type {
    ActionInfo,
    AgentInfo,
    Catalog,
    CommandActionGap,
    CommandActionLinkIssue,
    CommandInfo,
    SchemaInfo,
} from "./types.js";

/**
 * Collect the full capability catalog from the workspace's bundled agents.
 *
 * Agents, action schemas, and grammar-derived phrasings are read statically
 * from disk. Commands are enumerated by booting a headless, read-only
 * dispatcher (no network, no LLM, no API keys) so each host's `@command` table
 * is captured the way it is assembled at runtime. Dynamic, runtime-only
 * capabilities (MCP tools, recorded web flows) are intentionally out of scope
 * so the catalog stays reproducible for the documentation build.
 */
export type CollectCatalogOptions = {
    strict?: boolean;
};

export async function collectCatalog(
    options: CollectCatalogOptions = {},
): Promise<Catalog> {
    // `undefined` builds only the static bundled-agent provider (no instance
    // directory, so no installed/MCP agents are pulled in).
    const providers = getDefaultAppAgentProviders(undefined);

    // Agent-level metadata (emoji + description) comes from the manifests.
    const manifests: Record<string, AppAgentManifest> = {};
    for (const provider of providers) {
        for (const name of provider.getAppAgentNames()) {
            try {
                manifests[name] = await provider.getAppAgentManifest(name);
            } catch (error) {
                if (options.strict) {
                    throw new Error(
                        `Failed to load manifest for agent "${name}": ${getErrorMessage(error)}`,
                    );
                }
            }
        }
    }

    // The config provider flattens every agent's schemas (including the
    // built-in dispatcher/system schemas) and parses their action definitions.
    const { provider } = await getAllActionConfigProvider(providers);
    const configs = provider.getActionConfigs();

    // Group schema configs by their owning agent.
    const configsByAgent = new Map<string, ActionConfig[]>();
    for (const config of configs) {
        const agentName = getAppAgentName(config.schemaName);
        let list = configsByAgent.get(agentName);
        if (list === undefined) {
            list = [];
            configsByAgent.set(agentName, list);
        }
        list.push(config);
    }

    const agents: AgentInfo[] = [];
    const runtimeOnlySchemas: string[] = [];
    let actionCount = 0;

    for (const [agentName, agentConfigs] of [...configsByAgent].sort((a, b) =>
        a[0].localeCompare(b[0]),
    )) {
        const schemas: SchemaInfo[] = [];
        for (const config of sortSchemas(agentConfigs, agentName)) {
            if (isRuntimeOnlySchema(config)) {
                runtimeOnlySchemas.push(config.schemaName);
                continue;
            }
            const actions = collectActions(
                provider,
                config,
                options.strict ?? false,
            );
            actionCount += actions.length;
            schemas.push({
                schemaName: config.schemaName,
                description: config.description ?? "",
                defaultEnabled: config.schemaDefaultEnabled,
                transient: config.transient,
                actions,
            });
        }
        // Skip agents that expose no actions at all — nothing to browse.
        if (schemas.every((s) => s.actions.length === 0)) {
            continue;
        }
        agents.push({
            name: agentName,
            category: categoryForAgent(agentName),
            emoji: agentConfigs[0]?.emojiChar ?? "",
            description: manifests[agentName]?.description ?? "",
            schemas,
        });
    }

    const commands = await collectCommands({
        strict: options.strict ?? false,
    });
    const commandActionLinkIssues = resolveCommandActionLinks(agents, commands);
    const missingCommandActions = findMissingCommandActions(commands);
    const commandEndpoints = commands.filter((command) => command.executable);
    const linkedCommandEndpoints = commandEndpoints.filter(
        (command) => command.action?.resolvedSchema !== undefined,
    ).length;

    return {
        generatedAt: new Date().toISOString(),
        agents,
        commands,
        commandActionLinkIssues,
        missingCommandActions,
        runtimeOnlySchemas: runtimeOnlySchemas.sort(),
        counts: {
            agents: agents.length,
            actions: actionCount,
            commands: commands.length,
            commandEndpoints: commandEndpoints.length,
            linkedCommandEndpoints,
            missingCommandActions: missingCommandActions.length,
            invalidCommandActionLinks: commandActionLinkIssues.length,
        },
    };
}

export function isRuntimeOnlySchema(config: ActionConfig): boolean {
    if (
        config.schemaFilePath !== undefined ||
        config.originalSchemaFilePath !== undefined
    ) {
        return false;
    }
    try {
        const schema =
            typeof config.schemaFile === "function"
                ? config.schemaFile()
                : config.schemaFile;
        return schema.content.trim().length === 0;
    } catch {
        return false;
    }
}

/** Resolve every declared command link to exactly one registered action. */
export function resolveCommandActionLinks(
    agents: AgentInfo[],
    commands: CommandInfo[],
): CommandActionLinkIssue[] {
    const schemasByAgent = new Map<string, SchemaInfo[]>();
    for (const agent of agents) {
        schemasByAgent.set(agent.name, agent.schemas);
    }

    const issues: CommandActionLinkIssue[] = [];
    for (const command of commands) {
        const link = command.action;
        if (link === undefined) {
            continue;
        }
        delete link.resolvedSchema;

        const schemas = schemasByAgent.get(command.host) ?? [];
        const candidates =
            link.schema === undefined
                ? schemas.filter((schema) =>
                      schema.actions.some(
                          (action) => action.actionName === link.actionName,
                      ),
                  )
                : schemas.filter((schema) => schema.schemaName === link.schema);

        if (link.schema !== undefined && candidates.length === 0) {
            issues.push(
                createLinkIssue(
                    command,
                    `Schema "${link.schema}" is not registered for host "${command.host}".`,
                ),
            );
            continue;
        }

        const matches = candidates.filter((schema) =>
            schema.actions.some(
                (action) => action.actionName === link.actionName,
            ),
        );
        if (matches.length === 0) {
            issues.push(
                createLinkIssue(
                    command,
                    link.schema === undefined
                        ? `Action "${link.actionName}" is not registered for host "${command.host}".`
                        : `Action "${link.actionName}" is not registered in schema "${link.schema}".`,
                ),
            );
            continue;
        }
        if (matches.length > 1) {
            issues.push(
                createLinkIssue(
                    command,
                    `Action "${link.actionName}" is ambiguous across schemas: ${matches.map((schema) => schema.schemaName).join(", ")}.`,
                ),
            );
            continue;
        }
        link.resolvedSchema = matches[0].schemaName;
    }
    return issues;
}

export function findMissingCommandActions(
    commands: CommandInfo[],
): CommandActionGap[] {
    return commands
        .filter((command) => command.executable && command.action === undefined)
        .map((command) => ({ host: command.host, path: command.path }));
}

function createLinkIssue(
    command: CommandInfo,
    message: string,
): CommandActionLinkIssue {
    const link = command.action!;
    return {
        host: command.host,
        path: command.path,
        actionName: link.actionName,
        ...(link.schema === undefined ? {} : { schema: link.schema }),
        message,
    };
}

/** Order schemas so the agent's primary schema leads, then the rest by name. */
function sortSchemas(
    configs: ActionConfig[],
    agentName: string,
): ActionConfig[] {
    return [...configs].sort((a, b) => {
        const aPrimary = a.schemaName === agentName ? 0 : 1;
        const bPrimary = b.schemaName === agentName ? 0 : 1;
        if (aPrimary !== bPrimary) {
            return aPrimary - bPrimary;
        }
        return a.schemaName.localeCompare(b.schemaName);
    });
}

/** Parse a schema config into its action list, enriched with phrasings. */
function collectActions(
    provider: Awaited<
        ReturnType<typeof getAllActionConfigProvider>
    >["provider"],
    config: ActionConfig,
    strict: boolean,
): ActionInfo[] {
    const phrasings = collectPhrasings(config);

    let actionSchemas: Map<string, ActionSchemaTypeDefinition>;
    try {
        const schemaFile = provider.getActionSchemaFileForConfig(config);
        actionSchemas = schemaFile.parsedActionSchema.actionSchemas;
    } catch (error) {
        if (strict) {
            throw new Error(
                `Failed to load action schema "${config.schemaName}": ${getErrorMessage(error)}`,
            );
        }
        return [];
    }

    const actions: ActionInfo[] = [];
    for (const [actionName, def] of actionSchemas) {
        actions.push({
            actionName,
            description: joinComments(def.comments),
            parameters: extractParams(def),
            phrasings: phrasings.get(actionName) ?? [],
        });
    }
    actions.sort((a, b) => a.actionName.localeCompare(b.actionName));
    return actions;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Load and parse the schema's grammar file into per-action phrasings. */
function collectPhrasings(config: ActionConfig): Map<string, string[]> {
    const grammar = grammarContentOf(config);
    if (grammar === undefined) {
        return new Map();
    }
    // Agents ship either raw `.agr` grammar or the pre-compiled `.ag.json`
    // form; render example phrasings from whichever is present.
    if (grammar.format === "agr") {
        return extractPhrasings(`${config.schemaName}.agr`, grammar.content);
    }
    if (grammar.format === "ag") {
        return extractCompiledPhrasings(grammar.content, grammar.sourceMap);
    }
    return new Map();
}

/** Resolve the (possibly lazily-loaded) grammar content for a schema config. */
function grammarContentOf(config: ActionConfig): GrammarContent | undefined {
    const grammarFile = config.grammarFile;
    if (grammarFile === undefined) {
        return undefined;
    }
    try {
        return typeof grammarFile === "function" ? grammarFile() : grammarFile;
    } catch {
        return undefined;
    }
}
