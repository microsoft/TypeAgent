// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 1 — Discovery handler.
// Enumerates the API surface of the target application from documentation
// or an OpenAPI spec, saving results to the workspace for the next phase.

import {
    ActionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { DiscoveryActions } from "./discoverySchema.js";
import {
    loadState,
    updatePhase,
    writeArtifactJson,
    readArtifactJson,
} from "../lib/workspace.js";
import { getDiscoveryModel } from "../lib/llm.js";

// Represents a single discovered API action
export type DiscoveredAction = {
    name: string;
    description: string;
    // HTTP method if REST, or operation type
    method?: string;
    // Endpoint path or function signature
    path?: string;
    // Discovered parameters
    parameters?: DiscoveredParameter[];
    // Source URL where this was found
    sourceUrl?: string;
};

export type DiscoveredParameter = {
    name: string;
    type: string;
    description?: string;
    required?: boolean;
};

export type ApiSurface = {
    integrationName: string;
    discoveredAt: string;
    source: string;
    actions: DiscoveredAction[];
    approved?: boolean;
    approvedAt?: string;
    approvedActions?: string[];
};

export async function executeDiscoveryAction(
    action: TypeAgentAction<DiscoveryActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "crawlDocUrl":
            return handleCrawlDocUrl(
                action.parameters.integrationName,
                action.parameters.url,
                action.parameters.maxDepth ?? 2,
            );

        case "parseOpenApiSpec":
            return handleParseOpenApiSpec(
                action.parameters.integrationName,
                action.parameters.specSource,
            );

        case "listDiscoveredActions":
            return handleListDiscoveredActions(
                action.parameters.integrationName,
            );

        case "approveApiSurface":
            return handleApproveApiSurface(
                action.parameters.integrationName,
                action.parameters.includeActions,
                action.parameters.excludeActions,
            );
    }
}

async function handleCrawlDocUrl(
    integrationName: string,
    url: string,
    maxDepth: number,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) {
        return { error: `Integration "${integrationName}" not found. Run startOnboarding first.` };
    }

    await updatePhase(integrationName, "discovery", { status: "in-progress" });

    const model = getDiscoveryModel();

    // Fetch and parse the documentation page
    let pageContent: string;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return { error: `Failed to fetch ${url}: ${response.status} ${response.statusText}` };
        }
        pageContent = await response.text();
    } catch (err: any) {
        return { error: `Failed to fetch ${url}: ${err?.message ?? err}` };
    }

    // Use LLM to extract API actions from the page content
    const prompt = [
        {
            role: "system" as const,
            content:
                "You are an API documentation analyzer. Extract a list of API actions/operations from the provided documentation HTML. " +
                "For each action, identify: name (camelCase), description, HTTP method (if applicable), endpoint path (if applicable), and parameters. " +
                "Return a JSON array of actions.",
        },
        {
            role: "user" as const,
            content:
                `Extract all API actions from this documentation page for the "${integrationName}" integration.\n\n` +
                `URL: ${url}\n\n` +
                `Content (truncated to 8000 chars):\n${pageContent.slice(0, 8000)}`,
        },
    ];

    const result = await model.complete(prompt);
    if (!result.success) {
        return { error: `LLM extraction failed: ${result.message}` };
    }

    let actions: DiscoveredAction[] = [];
    try {
        // Extract JSON from LLM response
        const jsonMatch = result.data.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            actions = JSON.parse(jsonMatch[0]);
        }
    } catch {
        return { error: "Failed to parse LLM response as JSON action list." };
    }

    // Add source URL to each action
    actions = actions.map((a) => ({ ...a, sourceUrl: url }));

    // Merge with any existing discovered actions
    const existing = await readArtifactJson<ApiSurface>(
        integrationName,
        "discovery",
        "api-surface.json",
    );
    const merged: ApiSurface = {
        integrationName,
        discoveredAt: new Date().toISOString(),
        source: url,
        actions: [
            ...(existing?.actions ?? []).filter((a) =>
                !actions.find((n) => n.name === a.name),
            ),
            ...actions,
        ],
    };

    await writeArtifactJson(
        integrationName,
        "discovery",
        "api-surface.json",
        merged,
    );

    return createActionResultFromMarkdownDisplay(
        `## Discovery complete: ${integrationName}\n\n` +
            `**Source:** ${url}\n` +
            `**Actions found:** ${actions.length}\n\n` +
            actions
                .slice(0, 20)
                .map((a) => `- **${a.name}**: ${a.description}`)
                .join("\n") +
            (actions.length > 20
                ? `\n\n_...and ${actions.length - 20} more_`
                : "") +
            `\n\nReview with \`listDiscoveredActions\`, then \`approveApiSurface\` to proceed.`,
    );
}

async function handleParseOpenApiSpec(
    integrationName: string,
    specSource: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) {
        return { error: `Integration "${integrationName}" not found. Run startOnboarding first.` };
    }

    await updatePhase(integrationName, "discovery", { status: "in-progress" });

    // Fetch the spec (URL or file path)
    let specContent: string;
    try {
        if (specSource.startsWith("http://") || specSource.startsWith("https://")) {
            const response = await fetch(specSource);
            if (!response.ok) {
                return { error: `Failed to fetch spec: ${response.status} ${response.statusText}` };
            }
            specContent = await response.text();
        } else {
            const fs = await import("fs/promises");
            specContent = await fs.readFile(specSource, "utf-8");
        }
    } catch (err: any) {
        return { error: `Failed to read spec from ${specSource}: ${err?.message ?? err}` };
    }

    let spec: any;
    try {
        spec = JSON.parse(specContent);
    } catch {
        try {
            // Try YAML if JSON fails (basic line parsing)
            return { error: "YAML specs not yet supported — please provide a JSON OpenAPI spec." };
        } catch {
            return { error: "Could not parse spec as JSON or YAML." };
        }
    }

    // Extract actions from OpenAPI paths
    const actions: DiscoveredAction[] = [];
    const paths = spec.paths ?? {};
    for (const [pathStr, pathItem] of Object.entries(paths) as [string, any][]) {
        for (const method of ["get", "post", "put", "patch", "delete"] as const) {
            const op = pathItem?.[method];
            if (!op) continue;

            const name = op.operationId ?? `${method}${pathStr.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const camelName = name.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());

            const parameters: DiscoveredParameter[] = (op.parameters ?? []).map(
                (p: any) => ({
                    name: p.name,
                    type: p.schema?.type ?? "string",
                    description: p.description,
                    required: p.required ?? false,
                }),
            );

            // Also include request body fields as parameters
            const requestBody = op.requestBody?.content?.["application/json"]?.schema;
            if (requestBody?.properties) {
                for (const [propName, propSchema] of Object.entries(requestBody.properties) as [string, any][]) {
                    parameters.push({
                        name: propName,
                        type: propSchema.type ?? "string",
                        description: propSchema.description,
                        required: requestBody.required?.includes(propName) ?? false,
                    });
                }
            }

            actions.push({
                name: camelName,
                description: op.summary ?? op.description ?? `${method.toUpperCase()} ${pathStr}`,
                method: method.toUpperCase(),
                path: pathStr,
                parameters,
                sourceUrl: specSource,
            });
        }
    }

    const surface: ApiSurface = {
        integrationName,
        discoveredAt: new Date().toISOString(),
        source: specSource,
        actions,
    };

    await writeArtifactJson(integrationName, "discovery", "api-surface.json", surface);

    return createActionResultFromMarkdownDisplay(
        `## OpenAPI spec parsed: ${integrationName}\n\n` +
            `**Source:** ${specSource}\n` +
            `**OpenAPI version:** ${spec.openapi ?? spec.swagger ?? "unknown"}\n` +
            `**Actions found:** ${actions.length}\n\n` +
            actions
                .slice(0, 20)
                .map((a) => `- **${a.name}** (\`${a.method} ${a.path}\`): ${a.description}`)
                .join("\n") +
            (actions.length > 20 ? `\n\n_...and ${actions.length - 20} more_` : "") +
            `\n\nReview with \`listDiscoveredActions\`, then \`approveApiSurface\` to proceed.`,
    );
}

async function handleListDiscoveredActions(
    integrationName: string,
): Promise<ActionResult> {
    const surface = await readArtifactJson<ApiSurface>(
        integrationName,
        "discovery",
        "api-surface.json",
    );
    if (!surface) {
        return { error: `No discovered actions found for "${integrationName}". Run crawlDocUrl or parseOpenApiSpec first.` };
    }

    const lines = [
        `## Discovered actions: ${integrationName}`,
        ``,
        `**Source:** ${surface.source}`,
        `**Discovered:** ${surface.discoveredAt}`,
        `**Total actions:** ${surface.actions.length}`,
        `**Status:** ${surface.approved ? "✅ Approved" : "⏳ Pending approval"}`,
        ``,
        `| # | Name | Description |`,
        `|---|---|---|`,
        ...surface.actions.map(
            (a, i) =>
                `| ${i + 1} | \`${a.name}\` | ${a.description} |`,
        ),
    ];

    return createActionResultFromMarkdownDisplay(lines.join("\n"));
}

async function handleApproveApiSurface(
    integrationName: string,
    includeActions?: string[],
    excludeActions?: string[],
): Promise<ActionResult> {
    const surface = await readArtifactJson<ApiSurface>(
        integrationName,
        "discovery",
        "api-surface.json",
    );
    if (!surface) {
        return { error: `No discovered actions found for "${integrationName}".` };
    }

    let approved = surface.actions;
    if (includeActions && includeActions.length > 0) {
        approved = approved.filter((a) => includeActions.includes(a.name));
    }
    if (excludeActions && excludeActions.length > 0) {
        approved = approved.filter((a) => !excludeActions.includes(a.name));
    }

    const updated: ApiSurface = {
        ...surface,
        approved: true,
        approvedAt: new Date().toISOString(),
        approvedActions: approved.map((a) => a.name),
        actions: approved,
    };

    await writeArtifactJson(integrationName, "discovery", "api-surface.json", updated);
    await updatePhase(integrationName, "discovery", { status: "approved" });

    return createActionResultFromMarkdownDisplay(
        `## API surface approved: ${integrationName}\n\n` +
            `**Approved actions:** ${approved.length}\n\n` +
            approved.map((a) => `- \`${a.name}\`: ${a.description}`).join("\n") +
            `\n\n**Next step:** Phase 2 — use \`generatePhrases\` to create natural language samples.`,
    );
}
