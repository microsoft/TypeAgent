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
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { DiscoveryActions } from "./discoverySchema.js";
import {
    loadState,
    updatePhase,
    writeArtifactJson,
    readArtifactJson,
} from "../lib/workspace.js";
import { getDiscoveryModel } from "../lib/llm.js";
import { execFile } from "child_process";
import { promisify } from "util";
import registerDebug from "debug";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { loadSchema } from "typeagent";
import { CliDiscoveryResult } from "./discoveryLlmSchema.js";

const execFileAsync = promisify(execFile);
const debug = registerDebug("typeagent:onboarding:discovery");

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

export type DiscoveredEntity = {
    name: string;
    description?: string;
    examples?: string[];
};

export type ApiSurface = {
    integrationName: string;
    discoveredAt: string;
    source: string;
    actions: DiscoveredAction[];
    entities?: DiscoveredEntity[];
    approved?: boolean;
    approvedAt?: string;
    approvedActions?: string[];
};

// TypeChat translator for structured CLI help extraction
function createCliDiscoveryTranslator(): TypeChatJsonTranslator<CliDiscoveryResult> {
    const model = getDiscoveryModel();
    const schema = loadSchema(["discoveryLlmSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<CliDiscoveryResult>(
        schema,
        "CliDiscoveryResult",
    );
    return createJsonTranslator<CliDiscoveryResult>(model, validator);
}

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

        case "crawlCliHelp":
            return handleCrawlCliHelp(
                action.parameters.integrationName,
                action.parameters.command,
                action.parameters.maxDepth,
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
        return {
            error: `Integration "${integrationName}" not found. Run startOnboarding first.`,
        };
    }

    await updatePhase(integrationName, "discovery", { status: "in-progress" });

    const model = getDiscoveryModel();

    // Fetch and parse the documentation page
    let pageContent: string;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return {
                error: `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
            };
        }
        pageContent = await response.text();
    } catch (err: any) {
        return { error: `Failed to fetch ${url}: ${err?.message ?? err}` };
    }

    // Strip HTML tags and collapse whitespace to get readable text content
    const textContent = stripHtml(pageContent);

    // Follow links up to maxDepth levels
    const linkedContent = await crawlLinks(
        url,
        pageContent,
        maxDepth,
        integrationName,
    );

    // Use LLM to extract API actions from the page content
    const prompt = [
        {
            role: "system" as const,
            content:
                "You are an API documentation analyzer. Extract a list of user-facing API actions/operations from the provided documentation. " +
                "For each action, identify: name (camelCase), description, HTTP method (if applicable), endpoint path (if applicable), and parameters. " +
                "IMPORTANT: Only include actions that represent real operations a user would invoke. " +
                "Exclude internal/infrastructure methods like: load, sync, toJSON, context, track, untrack, set, get (bare getters/setters without a domain concept). " +
                "Return a JSON array of actions with shape: { name, description, method?, path?, parameters?: [{name, type, description?, required?}] }[]",
        },
        {
            role: "user" as const,
            content:
                `Extract all user-facing API actions from this documentation for the "${integrationName}" integration.\n\n` +
                `Primary URL: ${url}\n\n` +
                `Content:\n${(textContent + "\n\n" + linkedContent).slice(0, 16000)}`,
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

    // Add source URL to each action; filter out internal framework methods
    actions = actions
        .map((a) => ({ ...a, sourceUrl: url }))
        .filter((a) => !isInternalAction(a.name));

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
            ...(existing?.actions ?? []).filter(
                (a) => !actions.find((n) => n.name === a.name),
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

// ── HTML helpers ─────────────────────────────────────────────────────────────

// Strip HTML tags and collapse whitespace to extract readable text.
function stripHtml(html: string): string {
    let sanitized = html;
    let previous: string;

    // First pass: remove dangerous blocks and tags until stable.
    do {
        previous = sanitized;
        sanitized = sanitized
            .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, "")
            .replace(/<[^>]+>/g, " ");
    } while (sanitized !== previous);

    // Decode common entities.
    sanitized = sanitized
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");

    // Decode can re-introduce tag delimiters; sanitize again until stable.
    do {
        previous = sanitized;
        sanitized = sanitized
            .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, "")
            .replace(/<[^>]+>/g, " ");
    } while (sanitized !== previous);

    // Final hardening: neutralize any remaining tag delimiters as single chars.
    return sanitized
        .replace(/[<>]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// Extract same-origin links from an HTML page.
function extractLinks(baseUrl: string, html: string): string[] {
    const base = new URL(baseUrl);
    const links: string[] = [];
    const hrefRe = /href=["']([^"'#?]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = hrefRe.exec(html)) !== null) {
        try {
            const resolved = new URL(m[1], baseUrl);
            // Only follow links on the same hostname and path prefix
            if (
                resolved.hostname === base.hostname &&
                resolved.pathname.startsWith(
                    base.pathname.split("/").slice(0, -1).join("/"),
                )
            ) {
                links.push(resolved.href);
            }
        } catch {
            // skip malformed URLs
        }
    }
    // Deduplicate
    return [...new Set(links)].slice(0, 30); // cap at 30 links
}

// Crawl linked pages up to maxDepth and return combined text (capped to 8000 chars per page).
async function crawlLinks(
    baseUrl: string,
    baseHtml: string,
    maxDepth: number,
    _integrationName: string,
): Promise<string> {
    if (maxDepth <= 1) return "";

    const links = extractLinks(baseUrl, baseHtml);
    const visited = new Set<string>([baseUrl]);
    const chunks: string[] = [];

    for (const link of links.slice(0, 15)) {
        if (visited.has(link)) continue;
        visited.add(link);
        try {
            const resp = await fetch(link);
            if (!resp.ok) continue;
            const html = await resp.text();
            const text = stripHtml(html).slice(0, 8000);
            chunks.push(`\n--- ${link} ---\n${text}`);
        } catch {
            // skip unreachable pages
        }
    }

    return chunks.join("\n").slice(0, 40000);
}

// Names that are internal Office.js / API framework infrastructure, not user-facing operations.
const INTERNAL_ACTION_NAMES = new Set([
    "load",
    "sync",
    "toJSON",
    "track",
    "untrack",
    "context",
    "getItem",
    "getCount",
    "getItemOrNullObject",
    "getFirstOrNullObject",
    "getLastOrNullObject",
    "getLast",
    "getFirst",
    "items",
]);

function isInternalAction(name: string): boolean {
    if (INTERNAL_ACTION_NAMES.has(name)) return true;
    // Bare getters/setters with no domain concept (e.g. "get", "set", "load")
    if (/^(get|set|load|read|fetch)$/.test(name)) return true;
    return false;
}

async function handleParseOpenApiSpec(
    integrationName: string,
    specSource: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) {
        return {
            error: `Integration "${integrationName}" not found. Run startOnboarding first.`,
        };
    }

    await updatePhase(integrationName, "discovery", { status: "in-progress" });

    // Fetch the spec (URL or file path)
    let specContent: string;
    try {
        if (
            specSource.startsWith("http://") ||
            specSource.startsWith("https://")
        ) {
            const response = await fetch(specSource);
            if (!response.ok) {
                return {
                    error: `Failed to fetch spec: ${response.status} ${response.statusText}`,
                };
            }
            specContent = await response.text();
        } else {
            const fs = await import("fs/promises");
            specContent = await fs.readFile(specSource, "utf-8");
        }
    } catch (err: any) {
        return {
            error: `Failed to read spec from ${specSource}: ${err?.message ?? err}`,
        };
    }

    let spec: any;
    try {
        spec = JSON.parse(specContent);
    } catch {
        try {
            // Try YAML if JSON fails (basic line parsing)
            return {
                error: "YAML specs not yet supported — please provide a JSON OpenAPI spec.",
            };
        } catch {
            return { error: "Could not parse spec as JSON or YAML." };
        }
    }

    // Extract actions from OpenAPI paths
    const actions: DiscoveredAction[] = [];
    const paths = spec.paths ?? {};
    for (const [pathStr, pathItem] of Object.entries(paths) as [
        string,
        any,
    ][]) {
        for (const method of [
            "get",
            "post",
            "put",
            "patch",
            "delete",
        ] as const) {
            const op = pathItem?.[method];
            if (!op) continue;

            const name =
                op.operationId ??
                `${method}${pathStr.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const camelName = name.replace(
                /_([a-z])/g,
                (_: string, c: string) => c.toUpperCase(),
            );

            const parameters: DiscoveredParameter[] = (op.parameters ?? []).map(
                (p: any) => ({
                    name: p.name,
                    type: p.schema?.type ?? "string",
                    description: p.description,
                    required: p.required ?? false,
                }),
            );

            // Also include request body fields as parameters
            const requestBody =
                op.requestBody?.content?.["application/json"]?.schema;
            if (requestBody?.properties) {
                for (const [propName, propSchema] of Object.entries(
                    requestBody.properties,
                ) as [string, any][]) {
                    parameters.push({
                        name: propName,
                        type: propSchema.type ?? "string",
                        description: propSchema.description,
                        required:
                            requestBody.required?.includes(propName) ?? false,
                    });
                }
            }

            actions.push({
                name: camelName,
                description:
                    op.summary ??
                    op.description ??
                    `${method.toUpperCase()} ${pathStr}`,
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

    await writeArtifactJson(
        integrationName,
        "discovery",
        "api-surface.json",
        surface,
    );

    return createActionResultFromMarkdownDisplay(
        `## OpenAPI spec parsed: ${integrationName}\n\n` +
            `**Source:** ${specSource}\n` +
            `**OpenAPI version:** ${spec.openapi ?? spec.swagger ?? "unknown"}\n` +
            `**Actions found:** ${actions.length}\n\n` +
            actions
                .slice(0, 20)
                .map(
                    (a) =>
                        `- **${a.name}** (\`${a.method} ${a.path}\`): ${a.description}`,
                )
                .join("\n") +
            (actions.length > 20
                ? `\n\n_...and ${actions.length - 20} more_`
                : "") +
            `\n\nReview with \`listDiscoveredActions\`, then \`approveApiSurface\` to proceed.`,
    );
}

// ── CLI Help Crawler ──────────────────────────────────────────────────────

// CLIs where both --help and -h are known to be safe help flags.
// For unlisted commands only --help is attempted (since -h can mean
// something else, e.g. -h is "human-readable" in some Unix tools).
const SAFE_SHORT_HELP_CLIS = new Set([
    "gh",
    "git",
    "az",
    "kubectl",
    "docker",
    "npm",
    "pnpm",
    "yarn",
    "node",
    "python",
    "pip",
    "dotnet",
    "cargo",
    "go",
    "terraform",
    "helm",
    "aws",
    "gcloud",
    "heroku",
]);

async function runHelp(
    command: string,
    args: string[],
): Promise<string | undefined> {
    const flags = SAFE_SHORT_HELP_CLIS.has(command)
        ? ["--help", "-h"]
        : ["--help"];
    if (!SAFE_SHORT_HELP_CLIS.has(command)) {
        debug(
            "Skipping -h fallback for unknown CLI %s (only --help is tried)",
            command,
        );
    }
    for (const flag of flags) {
        try {
            const { stdout, stderr } = await execFileAsync(
                command,
                [...args, flag],
                {
                    timeout: 15_000,
                    windowsHide: true,
                },
            );
            const output = (stdout || stderr).trim();
            if (output.length > 0) return output;
        } catch (err: any) {
            // Many CLIs print help to stderr and exit non-zero; capture that
            const output = ((err.stdout ?? "") + (err.stderr ?? "")).trim();
            if (output.length > 0) return output;
        }
    }
    return undefined;
}

// Parse subcommand names from help text heuristically
function parseSubcommands(helpText: string): string[] {
    const subcommands: string[] = [];

    // Common patterns:
    //   "Available Commands:" / "Commands:" / "COMMANDS:" section
    //   Each line starts with optional whitespace then a command name
    const sectionRe =
        /(?:available\s+)?(?:commands|subcommands):\s*\n((?:[ \t]+\S.*\n?)+)/gi;
    let match: RegExpExecArray | null;
    while ((match = sectionRe.exec(helpText)) !== null) {
        const block = match[1];
        for (const line of block.split("\n")) {
            const m = line.match(/^\s{2,}(\S+)/);
            if (m && !m[1].startsWith("-") && !m[1].startsWith("[")) {
                subcommands.push(m[1]);
            }
        }
    }

    return [...new Set(subcommands)];
}

async function crawlCliRecursive(
    command: string,
    args: string[],
    depth: number,
    maxDepth: number,
    visited: Set<string> = new Set(),
): Promise<{ command: string; helpText: string }[]> {
    const cmdKey = [command, ...args].join(" ");
    if (depth > maxDepth || visited.has(cmdKey)) return [];
    visited.add(cmdKey);

    const helpText = await runHelp(command, args);
    if (!helpText) return [];

    const results: { command: string; helpText: string }[] = [
        { command: [command, ...args].join(" "), helpText },
    ];

    const subcommands = parseSubcommands(helpText);
    for (const sub of subcommands) {
        const childResults = await crawlCliRecursive(
            command,
            [...args, sub],
            depth + 1,
            maxDepth,
            visited,
        );
        results.push(...childResults);
    }

    return results;
}

async function handleCrawlCliHelp(
    integrationName: string,
    command: string,
    maxDepth?: number,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) {
        return {
            error: `Integration "${integrationName}" not found. Run startOnboarding first.`,
        };
    }

    await updatePhase(integrationName, "discovery", { status: "in-progress" });

    // Crawl the CLI help recursively
    const helpEntries = await crawlCliRecursive(command, [], 0, maxDepth ?? 4);
    if (helpEntries.length === 0) {
        return {
            error: `Could not retrieve help output from "${command}". Ensure the command is installed and accessible.`,
        };
    }

    // Combine all help text for LLM extraction
    const combinedHelp = helpEntries
        .map((e) => `### ${e.command}\n\n${e.helpText}`)
        .join("\n\n---\n\n");

    const maxHelpChars = 12000;
    const helpText = combinedHelp.slice(0, maxHelpChars);
    if (combinedHelp.length > maxHelpChars) {
        debug(
            "Help output truncated from %d to %d chars for %s",
            combinedHelp.length,
            maxHelpChars,
            command,
        );
    }

    // Use TypeChat for structured LLM extraction with validation and retry
    const translator = createCliDiscoveryTranslator();
    const request =
        `Extract all leaf CLI actions from the following help output for "${integrationName}".\n\n` +
        `Base command: ${command}\n` +
        `Total subcommands crawled: ${helpEntries.length}\n` +
        `Only include leaf commands that perform an action, not command groups.\n` +
        `Derive camelCase names from the command path (e.g. "gh repo create" → "repoCreate").\n` +
        `Also identify the domain entities referenced across the CLI ` +
        `(e.g. repositories, issues, pull requests, users).\n\n` +
        `Help output:\n${helpText}`;

    const result = await translator.translate(request);
    if (!result.success) {
        return { error: `LLM extraction failed: ${result.message}` };
    }

    const source = `cli:${command}`;
    let actions: DiscoveredAction[] = result.data.actions.map((a) => {
        const action: DiscoveredAction = {
            name: a.name,
            description: a.description,
            method: "CLI",
            path: a.path,
            sourceUrl: source,
        };
        if (a.parameters && a.parameters.length > 0) {
            action.parameters = a.parameters.map((p) => {
                const param: DiscoveredParameter = {
                    name: p.name,
                    type: p.type,
                };
                if (p.description) param.description = p.description;
                if (p.required !== undefined) param.required = p.required;
                return param;
            });
        }
        return action;
    });

    // Map extracted entities
    const entities: DiscoveredEntity[] = (result.data.entities ?? []).map(
        (e) => {
            const entity: DiscoveredEntity = { name: e.name };
            if (e.description) entity.description = e.description;
            if (e.examples && e.examples.length > 0)
                entity.examples = e.examples;
            return entity;
        },
    );

    // Merge with any existing discovered actions
    const existing = await readArtifactJson<ApiSurface>(
        integrationName,
        "discovery",
        "api-surface.json",
    );
    const merged: ApiSurface = {
        integrationName,
        discoveredAt: new Date().toISOString(),
        source,
        actions: [
            ...(existing?.actions ?? []).filter(
                (a) => !actions.find((n) => n.name === a.name),
            ),
            ...actions,
        ],
    };
    if (entities.length > 0) {
        // Merge entities, deduplicating by name
        const existingEntities = existing?.entities ?? [];
        const entityMap = new Map(existingEntities.map((e) => [e.name, e]));
        for (const e of entities) {
            entityMap.set(e.name, e);
        }
        merged.entities = [...entityMap.values()];
    }

    await writeArtifactJson(
        integrationName,
        "discovery",
        "api-surface.json",
        merged,
    );

    return createActionResultFromMarkdownDisplay(
        `## CLI discovery complete: ${integrationName}\n\n` +
            `**Command:** \`${command}\`\n` +
            `**Subcommands crawled:** ${helpEntries.length}\n` +
            `**Actions found:** ${actions.length}\n` +
            `**Entities found:** ${entities.length}\n\n` +
            actions
                .slice(0, 20)
                .map((a) => `- **${a.name}** (\`${a.path}\`): ${a.description}`)
                .join("\n") +
            (actions.length > 20
                ? `\n\n_...and ${actions.length - 20} more_`
                : "") +
            (entities.length > 0
                ? `\n\n**Entities:** ${entities.map((e) => e.name).join(", ")}`
                : "") +
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
        return {
            error: `No discovered actions found for "${integrationName}". Run crawlDocUrl or parseOpenApiSpec first.`,
        };
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
            (a, i) => `| ${i + 1} | \`${a.name}\` | ${a.description} |`,
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
        return {
            error: `No discovered actions found for "${integrationName}".`,
        };
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

    await writeArtifactJson(
        integrationName,
        "discovery",
        "api-surface.json",
        updated,
    );
    await updatePhase(integrationName, "discovery", { status: "approved" });

    // If many actions, recommend sub-schema categorization
    let subSchemaNote = "";
    if (approved.length > 20) {
        subSchemaNote = await generateSubSchemaRecommendation(
            integrationName,
            approved,
        );
    }

    return createActionResultFromMarkdownDisplay(
        `## API surface approved: ${integrationName}\n\n` +
            `**Approved actions:** ${approved.length}\n\n` +
            approved
                .map((a) => `- \`${a.name}\`: ${a.description}`)
                .join("\n") +
            subSchemaNote +
            `\n\n**Next step:** Phase 2 — use \`generatePhrases\` to create natural language samples.`,
    );
}

// When the approved action count exceeds 20, ask the LLM to categorize them
// into logical groups and save a sub-schema-groups.json artifact so that the
// scaffolder phase can generate sub-action manifests.
type SubSchemaGroup = {
    name: string;
    description: string;
    actions: string[];
};

type SubSchemaSuggestion = {
    recommended: boolean;
    groups: SubSchemaGroup[];
};

async function generateSubSchemaRecommendation(
    integrationName: string,
    approved: DiscoveredAction[],
): Promise<string> {
    const model = getDiscoveryModel();
    const actionList = approved
        .map((a) => `- ${a.name}: ${a.description}`)
        .join("\n");

    const prompt = [
        {
            role: "system" as const,
            content:
                "You are an API architect. Given a list of API actions, categorize them " +
                "into logical groups suitable for sub-schema separation in a TypeAgent agent. " +
                "Each group should have a short camelCase name, a description, and the list of action names belonging to it. " +
                "Every action must appear in exactly one group. Aim for 3-7 groups. " +
                "Return ONLY a JSON array of objects with keys: name, description, actions.",
        },
        {
            role: "user" as const,
            content: `Categorize these ${approved.length} actions for the "${integrationName}" integration into logical sub-schema groups:\n\n${actionList}`,
        },
    ];

    const result = await model.complete(prompt);
    if (!result.success) {
        // Non-fatal — just skip the recommendation
        return "\n\n> **Note:** Could not generate sub-schema recommendation (LLM error). You can still proceed.";
    }

    let groups: SubSchemaGroup[] = [];
    try {
        const jsonMatch = result.data.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            groups = JSON.parse(jsonMatch[0]);
        }
    } catch {
        return "\n\n> **Note:** Could not parse sub-schema recommendation. You can still proceed.";
    }

    if (groups.length === 0) {
        return "";
    }

    const suggestion: SubSchemaSuggestion = {
        recommended: true,
        groups,
    };

    await writeArtifactJson(
        integrationName,
        "discovery",
        "sub-schema-groups.json",
        suggestion,
    );

    const groupSummary = groups
        .map(
            (g) =>
                `- **${g.name}** (${g.actions.length} actions): ${g.description}`,
        )
        .join("\n");

    return (
        `\n\n---\n### Sub-schema recommendation\n\n` +
        `With **${approved.length} actions**, we recommend splitting into sub-schemas for better organization:\n\n` +
        groupSummary +
        `\n\nThis grouping has been saved to \`discovery/sub-schema-groups.json\`. ` +
        `The scaffolder will use it to generate separate schema and grammar files per group.`
    );
}
