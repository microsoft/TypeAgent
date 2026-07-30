// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Turns a validated CommandHelpResponse into structured display blocks: a short
// summary followed by one card per way (command usage as the title, what it does
// as the subtitle, and the natural-language phrasings under an "Or say" field).
// Everything is resolved from the catalog so the output stays grounded. Pure and
// side-effect free for testing.

import {
    CatalogCommand,
    CatalogIndex,
    cleanDescription,
    lookupAction,
    lookupCommand,
} from "./catalog.js";
import {
    CommandHelpResponse,
    CommandHelpWay,
} from "./commandHelpResponseSchema.js";
import { StructuredBlock } from "@typeagent/agent-sdk";

const MAX_RENDERED_PHRASINGS = 3;

export function formatCommandUsage(cmd: CatalogCommand): string {
    const parts = [`@${cmd.path}`];
    for (const arg of cmd.args) {
        const token = `<${arg.name}>`;
        parts.push(arg.optional ? `[${token}]` : token);
    }
    return parts.join(" ");
}

function quotePhrasings(phrasings: string[]): string {
    return phrasings.map((p) => `“${p}”`).join(", ");
}

// CardBlock, without needing the type exported from the SDK. Optional props are
// assigned only when present because the tsconfig uses exactOptionalPropertyTypes.
type CardBlock = Extract<StructuredBlock, { kind: "card" }>;

function renderWayCard(
    way: CommandHelpWay,
    index: CatalogIndex,
): StructuredBlock | undefined {
    const cmd = way.commandPath
        ? lookupCommand(index, way.host, way.commandPath)
        : undefined;
    // Prefer the command's own declared action link over the model's guess.
    const actionName = cmd?.action?.actionName ?? way.actionName;
    const action = actionName
        ? lookupAction(index, way.host, actionName)
        : undefined;
    const does = cleanDescription(
        cmd?.description || action?.description || way.does || "",
    );
    const say = action
        ? quotePhrasings(action.phrasings.slice(0, MAX_RENDERED_PHRASINGS))
        : "";

    if (cmd) {
        const card: CardBlock = {
            kind: "card",
            title: formatCommandUsage(cmd),
        };
        if (does) card.subtitle = does;
        if (say) card.fields = [{ label: "Or say", value: say }];
        return card;
    }
    if (action) {
        const card: CardBlock = {
            kind: "card",
            title: does || action.actionName,
        };
        if (say) card.fields = [{ label: "Say", value: say }];
        return card;
    }
    // The model named a command path we couldn't resolve; show it as given.
    if (way.commandPath) {
        const card: CardBlock = { kind: "card", title: `@${way.commandPath}` };
        if (does) card.subtitle = does;
        return card;
    }
    return undefined;
}

export function renderStructured(
    response: CommandHelpResponse,
    index: CatalogIndex,
): StructuredBlock[] {
    const summary = response.summary?.trim();
    const ways = Array.isArray(response.ways) ? response.ways : [];

    if (ways.length === 0) {
        return [
            {
                kind: "text",
                text:
                    summary ||
                    "I couldn't find a matching TypeAgent command for that.",
            },
            {
                kind: "text",
                text: "Run `@help` to see all available commands.",
            },
        ];
    }

    const blocks: StructuredBlock[] = [];
    if (summary) {
        blocks.push({ kind: "text", text: summary });
    }
    for (const way of ways) {
        const card = renderWayCard(way, index);
        if (card) {
            blocks.push(card);
        }
    }
    return blocks;
}
