// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared resolution + rendering core for agent/action capability discovery.
// Used by describeCommandHandlers.ts (`@describe`). The NL path
// (describeActionHandler.ts) forwards to the `@describe` command directly,
// following the convention used by the other system NL handlers
// (e.g. configActionHandler.ts, historyActionHandler.ts) rather than calling
// into this module a second time.

import type {
    ActionInfo,
    AgentSchemaInfo,
    AgentSubSchemaInfo,
} from "@typeagent/dispatcher-types";
import { openai } from "@typeagent/aiclient";
import type { ChatModelWithStreaming } from "@typeagent/aiclient";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { getAgentSchemas } from "./agentSchemaInfo.js";

const MAX_DEFAULT_ACTIONS = 10;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type AgentResolution =
    | { kind: "found"; agent: AgentSchemaInfo }
    | { kind: "notFound"; agentName: string; suggestion?: string | undefined };

export type ActionMatch = {
    agent: AgentSchemaInfo;
    subSchema: AgentSubSchemaInfo;
    action: ActionInfo;
};

export type ActionResolution =
    | { kind: "found"; match: ActionMatch }
    | { kind: "ambiguous"; actionName: string; matches: ActionMatch[] }
    | { kind: "notFound"; actionName: string; suggestion?: string | undefined };

/** Levenshtein edit distance, used for "did you mean" suggestions. */
function editDistance(a: string, b: string): number {
    const al = a.length;
    const bl = b.length;
    const d: number[][] = Array.from({ length: al + 1 }, () =>
        new Array<number>(bl + 1).fill(0),
    );
    for (let i = 0; i <= al; i++) d[i][0] = i;
    for (let j = 0; j <= bl; j++) d[0][j] = j;
    for (let i = 1; i <= al; i++) {
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost,
            );
        }
    }
    return d[al][bl];
}

/** Return the closest candidate to `name` (case-insensitive), if any is close enough. */
function closestMatch(name: string, candidates: string[]): string | undefined {
    if (name.trim().length === 0) return undefined;
    const target = name.toLowerCase();
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        const distance = editDistance(target, candidate.toLowerCase());
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    // Only suggest when the candidate is plausibly a typo, not an unrelated word.
    const threshold = Math.max(2, Math.ceil(target.length / 3));
    return best !== undefined && bestDistance <= threshold ? best : undefined;
}

export function resolveAgent(
    schemas: AgentSchemaInfo[],
    agentName: string,
): AgentResolution {
    const target = agentName.toLowerCase();
    const agent = schemas.find((a) => a.name.toLowerCase() === target);
    if (agent !== undefined) {
        return { kind: "found", agent };
    }
    const suggestion = closestMatch(
        agentName,
        schemas.map((a) => a.name),
    );
    return { kind: "notFound", agentName, suggestion };
}

function findActionsInAgent(
    agent: AgentSchemaInfo,
    actionName: string,
): ActionMatch[] {
    const target = actionName.toLowerCase();
    const matches: ActionMatch[] = [];
    for (const subSchema of agent.subSchemas) {
        for (const action of subSchema.actions) {
            if (action.name.toLowerCase() === target) {
                matches.push({ agent, subSchema, action });
            }
        }
    }
    return matches;
}

/**
 * Resolve an action, optionally scoped to a single agent.
 * - Accepts a dotted `schema.action` form directly (`actionName` contains a `.`).
 * - Otherwise searches the given agent's sub-schemas, or all agents' if none given.
 */
export function resolveAction(
    schemas: AgentSchemaInfo[],
    actionName: string,
    agentName?: string,
): ActionResolution {
    const dotIndex = actionName.lastIndexOf(".");
    if (dotIndex > 0) {
        const schemaName = actionName.slice(0, dotIndex);
        const bareActionName = actionName.slice(dotIndex + 1);
        for (const agent of schemas) {
            const subSchema = agent.subSchemas.find(
                (s) => s.schemaName.toLowerCase() === schemaName.toLowerCase(),
            );
            if (subSchema === undefined) continue;
            const action = subSchema.actions.find(
                (a) => a.name.toLowerCase() === bareActionName.toLowerCase(),
            );
            if (action !== undefined) {
                return {
                    kind: "found",
                    match: { agent, subSchema, action },
                };
            }
            // Matched the schema but not the action within it: suggest the
            // closest action name in that same sub-schema.
            const suggestion = closestMatch(
                bareActionName,
                subSchema.actions.map((a) => a.name),
            );
            return { kind: "notFound", actionName, suggestion };
        }
        return { kind: "notFound", actionName };
    }

    if (agentName !== undefined) {
        const agentResolution = resolveAgent(schemas, agentName);
        if (agentResolution.kind === "notFound") {
            return { kind: "notFound", actionName };
        }
        const matches = findActionsInAgent(agentResolution.agent, actionName);
        if (matches.length === 1) {
            return { kind: "found", match: matches[0] };
        }
        if (matches.length > 1) {
            return { kind: "ambiguous", actionName, matches };
        }
        const suggestion = closestMatch(
            actionName,
            agentResolution.agent.subSchemas.flatMap((s) =>
                s.actions.map((a) => a.name),
            ),
        );
        return { kind: "notFound", actionName, suggestion };
    }

    const matches = schemas.flatMap((agent) =>
        findActionsInAgent(agent, actionName),
    );
    if (matches.length === 1) {
        return { kind: "found", match: matches[0] };
    }
    if (matches.length > 1) {
        return { kind: "ambiguous", actionName, matches };
    }
    const suggestion = closestMatch(
        actionName,
        schemas.flatMap((agent) =>
            agent.subSchemas.flatMap((s) => s.actions.map((a) => a.name)),
        ),
    );
    return { kind: "notFound", actionName, suggestion };
}

// ---------------------------------------------------------------------------
// Deterministic rendering
// ---------------------------------------------------------------------------

function escapeTableCell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function buildDeterministicAgentSummary(agent: AgentSchemaInfo): string {
    const description = agent.description.trim().replace(/\.$/, "");
    return `**${agent.emoji} The ${agent.name} agent** ${description}. It's capable of the following actions:`;
}

function disabledHints(
    agent: AgentSchemaInfo,
    isSchemaEnabled: (schemaName: string) => boolean,
): string[] {
    return agent.subSchemas
        .filter((s) => !isSchemaEnabled(s.schemaName))
        .map(
            (s) =>
                `_${s.schemaName} is currently disabled — enable it with \`@config schema ${s.schemaName}\`._`,
        );
}

export function renderAgentView(
    agent: AgentSchemaInfo,
    all: boolean,
    isSchemaEnabled: (schemaName: string) => boolean,
): string {
    const showGroup = agent.subSchemas.length > 1;
    const rows: { name: string; description: string; group: string }[] = [];
    for (const subSchema of agent.subSchemas) {
        for (const action of subSchema.actions) {
            rows.push({
                name: action.name,
                description: action.description,
                group: subSchema.schemaName,
            });
        }
    }

    const total = rows.length;
    const shown = all ? rows : rows.slice(0, MAX_DEFAULT_ACTIONS);

    const lines: string[] = [buildDeterministicAgentSummary(agent), ""];

    if (total === 0) {
        lines.push("It currently exposes no callable actions.");
    } else {
        const header = showGroup
            ? "| Action | What it does | Group |"
            : "| Action | What it does |";
        const separator = showGroup
            ? "| ------ | ------------- | ----- |"
            : "| ------ | ------------- |";
        lines.push(header, separator);
        for (const row of shown) {
            const cells = showGroup
                ? [row.name, row.description, row.group]
                : [row.name, row.description];
            lines.push(`| ${cells.map(escapeTableCell).join(" | ")} |`);
        }
        if (!all && total > MAX_DEFAULT_ACTIONS) {
            lines.push(
                "",
                `_Showing ${MAX_DEFAULT_ACTIONS} of ${total} actions. Say "show all ${agent.name} actions" or run \`@describe ${agent.name} --all\`._`,
            );
        }
    }

    const hints = disabledHints(agent, isSchemaEnabled);
    if (hints.length > 0) {
        lines.push("", ...hints);
    }

    return lines.join("\n");
}

/** Best-effort extraction of a single action's parameter list from generated schema text. */
export function extractActionParameters(
    schemaText: string | undefined,
    actionName: string,
): { name: string; type: string; optional: boolean; comment?: string }[] {
    if (schemaText === undefined) return [];

    // Find `actionName: "<actionName>";` then the following `parameters: { ... }` block.
    const actionNameRe = new RegExp(
        `actionName:\\s*"${actionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*;`,
    );
    const nameMatch = actionNameRe.exec(schemaText);
    if (nameMatch === undefined || nameMatch === null) return [];

    const paramsStart = schemaText.indexOf("parameters", nameMatch.index);
    const braceStart = schemaText.indexOf("{", paramsStart);
    if (paramsStart === -1 || braceStart === -1) return [];

    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < schemaText.length; i++) {
        if (schemaText[i] === "{") depth++;
        else if (schemaText[i] === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end === -1) return [];

    const body = schemaText.slice(braceStart + 1, end);
    const params: {
        name: string;
        type: string;
        optional: boolean;
        comment?: string;
    }[] = [];

    // Walk the body line by line, tracking brace depth so that fields of
    // nested object types (e.g. `options: { volume: number; };`) are
    // reported once at the top level (with type "object") rather than
    // their inner fields being mistaken for top-level parameters.
    const fieldRe = /^([A-Za-z_$][\w$]*)(\?)?:\s*([^;]+?);?\s*$/;
    let bodyDepth = 0;
    let pendingComment: string | undefined;
    for (const rawLine of body.split("\n")) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        if (bodyDepth === 0 && line.startsWith("//")) {
            pendingComment = line.replace(/^\/\/\s*/, "");
            continue;
        }
        const fieldMatch = bodyDepth === 0 ? fieldRe.exec(line) : null;
        if (fieldMatch !== null) {
            const type = fieldMatch[3].trim();
            params.push({
                name: fieldMatch[1],
                type: type.includes("{") ? "object" : type,
                optional: fieldMatch[2] === "?",
                ...(pendingComment !== undefined && {
                    comment: pendingComment,
                }),
            });
            pendingComment = undefined;
        }
        for (const ch of line) {
            if (ch === "{") bodyDepth++;
            else if (ch === "}") bodyDepth--;
        }
        if (bodyDepth === 0 && fieldMatch === null) {
            pendingComment = undefined;
        }
    }
    return params;
}

export function renderActionView(match: ActionMatch): string {
    const { agent, subSchema, action } = match;
    const lines: string[] = [
        `**${agent.emoji} ${subSchema.schemaName}.${action.name}** — ${action.description}`,
    ];

    const params = extractActionParameters(subSchema.schemaText, action.name);
    if (params.length > 0) {
        lines.push("", "**Parameters**");
        for (const p of params) {
            const optionalTag = p.optional ? ", optional" : "";
            const comment = p.comment ? ` — ${p.comment}` : "";
            lines.push(`- \`${p.name}\` (${p.type}${optionalTag})${comment}`);
        }
    }

    return lines.join("\n");
}

export function renderAmbiguousActionMessage(
    resolution: Extract<ActionResolution, { kind: "ambiguous" }>,
): string {
    const candidates = resolution.matches
        .map(
            (m) =>
                `\`${m.agent.name} ${m.action.name}\` (${m.subSchema.schemaName})`,
        )
        .join(", ");
    return `There's more than one action named "${resolution.actionName}": ${candidates}. Say which agent you mean, e.g. \`@describe <agent> ${resolution.actionName}\`.`;
}

export function renderActionNotFoundMessage(
    resolution: Extract<ActionResolution, { kind: "notFound" }>,
): string {
    const suggestion = resolution.suggestion
        ? ` Did you mean '${resolution.suggestion}'?`
        : "";
    return `No action named '${resolution.actionName}'.${suggestion}`;
}

export function renderAgentNotFoundMessage(
    resolution: Extract<AgentResolution, { kind: "notFound" }>,
): string {
    const suggestion = resolution.suggestion
        ? ` Did you mean '${resolution.suggestion}'?`
        : "";
    return `No agent named '${resolution.agentName}'.${suggestion}`;
}

// ---------------------------------------------------------------------------
// LLM polish (always attempted when a model is configured; deterministic
// rendering above is the fallback on missing/failed model — see G5).
// ---------------------------------------------------------------------------

function tryCreateDescribeModel(): ChatModelWithStreaming | undefined {
    try {
        const apiSettings = openai.apiSettingsFromEnv();
        return openai.createChatModel(
            apiSettings,
            { temperature: 0.7, max_tokens: 800 },
            undefined,
            ["describeAction"],
        );
    } catch {
        return undefined;
    }
}

async function complete(
    model: ChatModelWithStreaming,
    prompt: string,
): Promise<string | undefined> {
    try {
        const result = await model.complete(prompt);
        if (!result.success) return undefined;
        const text = result.data.trim();
        // An empty completion isn't usable polish; let the caller fall back
        // to the deterministic rendering instead of returning blank text.
        return text.length > 0 ? text : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Produce a fluent paragraph summarizing the agent, replacing the
 * deterministic template sentence. Falls back to the deterministic
 * rendering (`renderAgentView`) unchanged when no model is configured or
 * generation fails.
 */
export async function polishAgentView(
    agent: AgentSchemaInfo,
    deterministic: string,
): Promise<string> {
    const model = tryCreateDescribeModel();
    if (model === undefined) return deterministic;

    const actionList = agent.subSchemas
        .flatMap((s) => s.actions)
        .map((a) => `- ${a.name}: ${a.description}`)
        .join("\n");
    const prompt =
        `Write one fluent, friendly paragraph (2-3 sentences) describing what the "${agent.name}" agent does, ` +
        `for a chat assistant's capability listing. Base it only on the facts below; do not invent features.\n\n` +
        `Agent description: ${agent.description}\n` +
        `Actions:\n${actionList}\n\n` +
        `Respond with just the paragraph, no heading or markdown emphasis.`;
    const polished = await complete(model, prompt);
    if (polished === undefined) return deterministic;

    // Splice the polished paragraph in place of the deterministic summary
    // line (first line of `deterministic`), keeping the rest (table/footer)
    // unchanged and always deterministic.
    const rest = deterministic.split("\n").slice(1).join("\n");
    return `**${agent.emoji} The ${agent.name} agent.** ${polished}\n${rest}`;
}

/**
 * Expand the terse action description into fuller detail, incorporating
 * parameters and a usage example. Falls back to the deterministic
 * rendering (`renderActionView`) unchanged when no model is configured or
 * generation fails.
 */
export async function polishActionView(
    match: ActionMatch,
    deterministic: string,
): Promise<string> {
    const model = tryCreateDescribeModel();
    if (model === undefined) return deterministic;

    const params = extractActionParameters(
        match.subSchema.schemaText,
        match.action.name,
    );
    const paramList = params
        .map(
            (p) =>
                `- ${p.name} (${p.type}${p.optional ? ", optional" : ""})${p.comment ? `: ${p.comment}` : ""}`,
        )
        .join("\n");
    const prompt =
        `Explain what the "${match.action.name}" action of the "${match.agent.name}" agent does, in more ` +
        `detail than a one-line summary, for a chat assistant's capability listing. Base it only on the facts ` +
        `below; do not invent parameters or behavior. Include the parameters and one example natural-language ` +
        `phrasing a user might say to trigger it.\n\n` +
        `Action summary: ${match.action.description}\n` +
        `Parameters:\n${paramList || "(none)"}\n\n` +
        `Format as markdown: a short paragraph, then a "**Parameters**" bullet list (if any), then a ` +
        `"**Example:**" line with a quoted phrase.`;
    const polished = await complete(model, prompt);
    return polished ?? deterministic;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function isSchemaEnabledFn(
    context: CommandHandlerContext,
): (schemaName: string) => boolean {
    return (schemaName) => {
        try {
            return context.agents.isSchemaEnabled(schemaName);
        } catch {
            return false;
        }
    };
}

export async function describeAction(
    context: CommandHandlerContext,
    actionName: string,
    agentName?: string,
): Promise<string> {
    const schemas = await getAgentSchemas(context);
    const resolution = resolveAction(schemas, actionName, agentName);
    switch (resolution.kind) {
        case "ambiguous":
            return renderAmbiguousActionMessage(resolution);
        case "notFound":
            return renderActionNotFoundMessage(resolution);
        case "found": {
            const deterministic = renderActionView(resolution.match);
            return polishActionView(resolution.match, deterministic);
        }
    }
}

/**
 * Entry point for the bare `@describe <name>` command form (no second
 * positional arg): resolve `name` as an agent first, falling back to a
 * cross-agent action search when it isn't one (mirrors the NL schema's
 * optional `agentName` on `DescribeActionAction`).
 */
export async function describeAgentOrAction(
    context: CommandHandlerContext,
    name: string,
    all: boolean,
): Promise<string> {
    const schemas = await getAgentSchemas(context);
    const agentResolution = resolveAgent(schemas, name);
    if (agentResolution.kind === "found") {
        const deterministic = renderAgentView(
            agentResolution.agent,
            all,
            isSchemaEnabledFn(context),
        );
        return polishAgentView(agentResolution.agent, deterministic);
    }

    const actionResolution = resolveAction(schemas, name);
    switch (actionResolution.kind) {
        case "found": {
            const deterministic = renderActionView(actionResolution.match);
            return polishActionView(actionResolution.match, deterministic);
        }
        case "ambiguous":
            return renderAmbiguousActionMessage(actionResolution);
        case "notFound":
            // Neither an agent nor an action: report against the agent name
            // (the more common intent for a single bare argument).
            return renderAgentNotFoundMessage(agentResolution);
    }
}
