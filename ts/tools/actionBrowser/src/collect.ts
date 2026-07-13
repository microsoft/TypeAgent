// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getDefaultAppAgentProviders } from "default-agent-provider";
import {
    getAllActionConfigProvider,
    getAppAgentName,
    type ActionConfig,
} from "agent-dispatcher/internal";
import type { AppAgentManifest, GrammarContent } from "@typeagent/agent-sdk";
import { extractParams } from "./paramTypes.js";
import { extractPhrasings, extractCompiledPhrasings } from "./phrasings.js";
import { collectSystemCommands } from "./systemCommands.js";
import { categoryForAgent } from "./categories.js";
import { joinComments } from "./util.js";
import type { ActionInfo, AgentInfo, Catalog, SchemaInfo } from "./types.js";

/**
 * Collect the full capability catalog from the workspace's bundled agents.
 *
 * This is a purely static enumeration — it reads agent manifests, action
 * schemas, and grammar files from disk (no running dispatcher, no network,
 * no LLM). Dynamic, runtime-only capabilities (MCP tools, recorded web flows)
 * are intentionally out of scope so the catalog can be generated during the
 * documentation build.
 */
export async function collectCatalog(): Promise<Catalog> {
    // `undefined` builds only the static bundled-agent provider (no instance
    // directory, so no installed/MCP agents are pulled in).
    const providers = getDefaultAppAgentProviders(undefined);

    // Agent-level metadata (emoji + description) comes from the manifests.
    const manifests: Record<string, AppAgentManifest> = {};
    for (const provider of providers) {
        for (const name of provider.getAppAgentNames()) {
            try {
                manifests[name] = await provider.getAppAgentManifest(name);
            } catch {
                // Skip agents whose manifest can't be resolved statically.
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
    let actionCount = 0;

    for (const [agentName, agentConfigs] of [...configsByAgent].sort((a, b) =>
        a[0].localeCompare(b[0]),
    )) {
        const schemas: SchemaInfo[] = [];
        for (const config of sortSchemas(agentConfigs, agentName)) {
            const actions = collectActions(provider, config);
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

    const systemCommands = collectSystemCommands();

    return {
        generatedAt: new Date().toISOString(),
        agents,
        systemCommands,
        counts: {
            agents: agents.length,
            actions: actionCount,
            commands: systemCommands.length,
        },
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
): ActionInfo[] {
    const phrasings = collectPhrasings(config);

    let actionSchemas: Map<string, any>;
    try {
        const schemaFile = provider.getActionSchemaFileForConfig(config);
        actionSchemas = schemaFile.parsedActionSchema.actionSchemas;
    } catch {
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
        return extractCompiledPhrasings(grammar.content);
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
