// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Loads the bundled Action Browser catalog (agent actions + @-commands, with the
// explicit command->action links) and turns a user question into a compact,
// host-grouped grounding for the LLM. The catalog file is copied into dist at
// build time (see scripts/copyCatalog.mjs); nothing is fetched at runtime.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type CatalogParam = {
    name: string;
    type: string;
    optional: boolean;
    description: string;
};

export type CatalogAction = {
    actionName: string;
    description: string;
    parameters: CatalogParam[];
    phrasings: string[];
};

export type CatalogSchema = {
    schemaName: string;
    description: string;
    defaultEnabled: boolean;
    transient: boolean;
    actions: CatalogAction[];
};

export type CatalogAgent = {
    name: string;
    category: string;
    emoji: string;
    description: string;
    schemas: CatalogSchema[];
};

export type CatalogCommandArg = {
    name: string;
    type: string;
    optional: boolean;
    description: string;
};

export type CatalogCommandFlag = {
    name: string;
    char: string;
    type: string;
    default: string;
    description: string;
};

export type CatalogActionLink = { schema?: string; actionName: string };

export type CatalogCommand = {
    host: string;
    path: string;
    description: string;
    group: boolean;
    args: CatalogCommandArg[];
    flags: CatalogCommandFlag[];
    action?: CatalogActionLink;
};

export type Catalog = {
    generatedAt: string;
    agents: CatalogAgent[];
    commands: CatalogCommand[];
    counts: { agents: number; actions: number; commands: number };
};

export type CatalogIndex = {
    catalog: Catalog;
    // Actions keyed by `${host}\u0000${actionName}`. Scoped by host because the
    // same actionName can appear under multiple agents (e.g. newConversation).
    actionByKey: Map<string, CatalogAction>;
    commandByKey: Map<string, CatalogCommand>;
};

function key(host: string, name: string): string {
    return `${host}\u0000${name}`;
}

// Grammar phrasings carry tokens like {polite} (a politeness filler) and {name}
// (a captured slot). Drop the filler and show remaining slots as <slot> so the
// suggestions read as plain English.
export function cleanPhrasing(phrasing: string): string {
    return phrasing
        .replace(/\{polite\}/gi, " ")
        .replace(/\{([^}]+)\}/g, "<$1>")
        .replace(/\s+/g, " ")
        .trim();
}

export function cleanPhrasings(phrasings: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const phrasing of phrasings) {
        const cleaned = cleanPhrasing(phrasing);
        if (cleaned.length > 0 && !seen.has(cleaned)) {
            seen.add(cleaned);
            out.push(cleaned);
        }
    }
    return out;
}

// Descriptions in the catalog sometimes append few-shot examples ("Example:
// User: ... Agent: { ... }"). Strip those and any JSON-ish blobs so the text
// reads like something the agent would say.
export function cleanDescription(description: string): string {
    let text = description;
    const exampleIndex = text.search(/\bExamples?:/i);
    if (exampleIndex >= 0) {
        text = text.slice(0, exampleIndex);
    }
    return text
        .replace(/\{[^{}]*\}/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

let loaded = false;
let cachedIndex: CatalogIndex | undefined;

// Reads and indexes the bundled catalog once. Returns undefined when the file is
// missing or unparseable; callers surface a friendly message instead.
export function loadCatalogIndex(): CatalogIndex | undefined {
    if (loaded) {
        return cachedIndex;
    }
    loaded = true;
    try {
        const path = fileURLToPath(
            new URL("./action-browser.json", import.meta.url),
        );
        const catalog = JSON.parse(readFileSync(path, "utf8")) as Catalog;
        cachedIndex = indexCatalog(catalog);
    } catch {
        cachedIndex = undefined;
    }
    return cachedIndex;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
    const actionByKey = new Map<string, CatalogAction>();
    for (const agent of catalog.agents) {
        for (const schema of agent.schemas) {
            for (const action of schema.actions) {
                // Normalize grammar phrasings and strip few-shot examples once
                // so every consumer (scoring, grounding, rendering) gets clean
                // text.
                action.phrasings = cleanPhrasings(action.phrasings);
                action.description = cleanDescription(action.description);
                const k = key(agent.name, action.actionName);
                // First definition wins; a name can repeat across an agent's
                // schemas, and the description/phrasings are equivalent enough
                // for grounding.
                if (!actionByKey.has(k)) {
                    actionByKey.set(k, action);
                }
            }
        }
    }
    const commandByKey = new Map<string, CatalogCommand>();
    for (const command of catalog.commands) {
        command.description = cleanDescription(command.description);
        commandByKey.set(key(command.host, command.path), command);
    }
    return { catalog, actionByKey, commandByKey };
}

export function lookupAction(
    index: CatalogIndex,
    host: string,
    actionName: string,
): CatalogAction | undefined {
    return index.actionByKey.get(key(host, actionName));
}

export function lookupCommand(
    index: CatalogIndex,
    host: string,
    path: string,
): CatalogCommand | undefined {
    return index.commandByKey.get(key(host, path));
}

export type HostGroup = {
    host: string;
    description: string;
    commands: CatalogCommand[];
    actions: CatalogAction[];
};

const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "for",
    "how",
    "do",
    "i",
    "what",
    "whats",
    "is",
    "are",
    "can",
    "could",
    "would",
    "should",
    "my",
    "me",
    "you",
    "your",
    "with",
    "and",
    "or",
    "that",
    "this",
    "please",
    "want",
    "need",
    "get",
    "use",
    "using",
    "command",
    "commands",
    "typeagent",
    "there",
    "does",
    "it",
    "was",
    "were",
    "will",
    "from",
    "by",
    "at",
    "as",
    "be",
    "am",
]);

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// A command's searchable text folds in its linked action's phrasings so a
// naturally phrased question still matches the typed command.
function commandText(index: CatalogIndex, cmd: CatalogCommand): string {
    const parts = [cmd.path, cmd.description];
    if (cmd.action) {
        const action = lookupAction(index, cmd.host, cmd.action.actionName);
        if (action) {
            parts.push(action.description, action.phrasings.join(" "));
        }
    }
    return parts.join(" ").toLowerCase();
}

function actionText(action: CatalogAction): string {
    return [action.actionName, action.description, action.phrasings.join(" ")]
        .join(" ")
        .toLowerCase();
}

function score(queryTokens: string[], text: string): number {
    let s = 0;
    for (const token of queryTokens) {
        if (text.includes(token)) {
            s++;
        }
    }
    return s;
}

type ScoredCommand = {
    kind: "command";
    host: string;
    command: CatalogCommand;
    s: number;
};
type ScoredAction = {
    kind: "action";
    host: string;
    action: CatalogAction;
    s: number;
};

type GroupSelection = {
    commands: Map<string, CatalogCommand>;
    actions: Map<string, CatalogAction>;
};

const MAX_ENTRIES = 24;

function collectScoredEntries(
    index: CatalogIndex,
    queryTokens: string[],
): (ScoredCommand | ScoredAction)[] {
    const scored: (ScoredCommand | ScoredAction)[] = [];
    const { catalog } = index;
    for (const command of catalog.commands) {
        const s = score(queryTokens, commandText(index, command));
        if (s > 0) {
            scored.push({ kind: "command", host: command.host, command, s });
        }
    }
    for (const agent of catalog.agents) {
        for (const schema of agent.schemas) {
            for (const action of schema.actions) {
                const s = score(queryTokens, actionText(action));
                if (s > 0) {
                    scored.push({
                        kind: "action",
                        host: agent.name,
                        action,
                        s,
                    });
                }
            }
        }
    }
    scored.sort((a, b) => b.s - a.s);
    return scored;
}

function ensureGroup(
    groups: Map<string, GroupSelection>,
    host: string,
): GroupSelection {
    let group = groups.get(host);
    if (!group) {
        group = { commands: new Map(), actions: new Map() };
        groups.set(host, group);
    }
    return group;
}

function addCommandSelection(
    index: CatalogIndex,
    groups: Map<string, GroupSelection>,
    item: ScoredCommand,
): void {
    const group = ensureGroup(groups, item.host);
    group.commands.set(item.command.path, item.command);
    const link = item.command.action;
    if (!link) {
        return;
    }
    const action = lookupAction(index, item.host, link.actionName);
    if (action) {
        group.actions.set(action.actionName, action);
    }
}

function addActionSelection(
    index: CatalogIndex,
    groups: Map<string, GroupSelection>,
    item: ScoredAction,
): void {
    const group = ensureGroup(groups, item.host);
    group.actions.set(item.action.actionName, item.action);
    for (const command of index.catalog.commands) {
        if (
            command.host === item.host &&
            command.action?.actionName === item.action.actionName
        ) {
            group.commands.set(command.path, command);
        }
    }
}

function describeHosts(catalog: Catalog): Map<string, string> {
    return new Map(catalog.agents.map((agent) => [agent.name, agent.description]));
}

// Keyword-overlap prefilter: the full catalog (~500 actions) is too large to
// hand the model wholesale, so select the entries most relevant to the question,
// keeping each command together with its linked action.
export function selectRelevantGroups(
    index: CatalogIndex,
    question: string,
): HostGroup[] {
    const queryTokens = [...new Set(tokenize(question))];
    const { catalog } = index;
    const scored = collectScoredEntries(index, queryTokens);
    const groups = new Map<string, GroupSelection>();

    for (const item of scored.slice(0, MAX_ENTRIES)) {
        if (item.kind === "command") {
            addCommandSelection(index, groups, item);
            continue;
        }
        addActionSelection(index, groups, item);
    }

    // Nothing matched: offer a compact list of every command so the model can
    // still find one or state plainly that none apply.
    if (groups.size === 0) {
        for (const command of catalog.commands) {
            ensureGroup(groups, command.host).commands.set(command.path, command);
        }
    }

    const descByHost = describeHosts(catalog);
    return [...groups.entries()].map(([host, g]) => ({
        host,
        description: descByHost.get(host) ?? "",
        commands: [...g.commands.values()],
        actions: [...g.actions.values()],
    }));
}

const MAX_GROUNDING_PHRASINGS = 4;

// Renders the selected capabilities as the compact text handed to the model.
// Command and action identifiers are quoted so the model copies them verbatim.
export function formatGrounding(groups: HostGroup[]): string {
    const lines: string[] = [
        "Available TypeAgent capabilities. Use ONLY these; copy host, commandPath, and actionName exactly.",
    ];
    for (const group of groups) {
        lines.push("");
        lines.push(
            `## host: ${group.host}${group.description ? ` — ${group.description}` : ""}`,
        );
        if (group.commands.length > 0) {
            lines.push("Commands:");
            for (const cmd of group.commands) {
                const args = cmd.args
                    .map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`))
                    .join(" ");
                const link = cmd.action
                    ? ` (action: ${cmd.action.actionName})`
                    : "";
                lines.push(
                    `- commandPath: "${cmd.path}"${args ? ` ${args}` : ""}${link} — ${cmd.description}`,
                );
            }
        }
        if (group.actions.length > 0) {
            lines.push("Actions (natural language):");
            for (const action of group.actions) {
                const phrasings = action.phrasings
                    .slice(0, MAX_GROUNDING_PHRASINGS)
                    .map((p) => `"${p}"`)
                    .join("; ");
                lines.push(
                    `- actionName: "${action.actionName}" — ${action.description}${phrasings ? ` | e.g. ${phrasings}` : ""}`,
                );
            }
        }
    }
    return lines.join("\n");
}
