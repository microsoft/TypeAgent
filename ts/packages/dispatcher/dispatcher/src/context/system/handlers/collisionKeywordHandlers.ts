// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@collision keywords` — inspect and edit the per-(schema, action) keyword
// overrides consumed by the contextSelector tier (design §5.3). Edits land in
// the profile-scoped `collision-keywords.json` sidecar as deltas over the
// derived lexical defaults; the merged effective set feeds the scorer (§9).

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { KeywordVector } from "../../contextSelector/keywordVector.js";

type Target = { schemaName: string; actionName: string; id: string };

// Parse a `schema.action` token. The action name is the segment after the LAST
// dot (action names are single identifiers); the schema name is the remainder
// (may itself contain dots for sub-schemas). Returns undefined when malformed.
function parseTarget(token: string): Target | undefined {
    const t = token.trim();
    const dot = t.lastIndexOf(".");
    if (dot <= 0 || dot >= t.length - 1) {
        return undefined;
    }
    return {
        schemaName: t.slice(0, dot),
        actionName: t.slice(dot + 1),
        id: t,
    };
}

function fmt(vector: KeywordVector): string {
    const list = [...vector].sort();
    return list.length > 0 ? list.join(", ") : "(none)";
}

function showEffective(
    context: ActionContext<CommandHandlerContext>,
    target: Target,
): void {
    const ctx = context.sessionContext.agentContext;
    const derived = ctx.contextSelectorKeywords.derived(
        target.schemaName,
        target.actionName,
    );
    const effective = ctx.contextSelectorKeywords.effective(
        target.schemaName,
        target.actionName,
    );
    const delta = ctx.contextSelectorSidecar.deltaFor(
        target.schemaName,
        target.actionName,
    );
    const lines = [
        `keywords for ${target.id}:`,
        `  derived:   ${fmt(derived)}`,
    ];
    if (delta?.replace !== undefined) {
        lines.push(`  replace:   ${delta.replace.join(", ") || "(none)"}`);
    } else {
        if (delta?.add && delta.add.length > 0) {
            lines.push(`  + add:     ${delta.add.join(", ")}`);
        }
        if (delta?.remove && delta.remove.length > 0) {
            lines.push(`  - remove:  ${delta.remove.join(", ")}`);
        }
    }
    lines.push(`  effective: ${fmt(effective)}`);
    displayResult(lines.join("\n"), context);
}

class CollisionKeywordsListCommandHandler implements CommandHandler {
    public readonly description =
        "Show derived + override keywords, merged, for a schema.action (or list all overrides)";
    public readonly parameters = {
        args: {
            target: {
                description:
                    'A schema.action, e.g. "excel.addRow". Omit to list all overrides.',
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const ctx = context.sessionContext.agentContext;
        if (params.args.target === undefined) {
            const entries = ctx.contextSelectorSidecar.list();
            if (entries.length === 0) {
                displayResult(
                    "No keyword overrides. Add one with `@collision keywords <schema.action> add <keywords…>`.",
                    context,
                );
                return;
            }
            const lines = entries.map(({ id, delta }) => {
                const parts: string[] = [];
                if (delta.replace) parts.push(`replace=[${delta.replace}]`);
                if (delta.add?.length) parts.push(`add=[${delta.add}]`);
                if (delta.remove?.length)
                    parts.push(`remove=[${delta.remove}]`);
                return `- ${id}: ${parts.join(" ")}`;
            });
            displayResult(
                `Keyword overrides (${entries.length}):\n${lines.join("\n")}`,
                context,
            );
            return;
        }
        const target = parseTarget(params.args.target);
        if (target === undefined) {
            displayWarn(
                `Invalid target "${params.args.target}". Expected schema.action.`,
                context,
            );
            return;
        }
        showEffective(context, target);
    }
}

class CollisionKeywordsAddCommandHandler implements CommandHandler {
    public readonly description =
        "Add discriminative keywords for a schema.action (layered over the derived defaults)";
    public readonly parameters = {
        args: {
            target: {
                description: 'The schema.action to tune, e.g. "excel.addRow".',
                type: "string",
            },
            keywords: {
                description: "One or more keywords to add.",
                type: "string",
                multiple: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const target = parseTarget(params.args.target);
        if (target === undefined) {
            displayWarn(
                `Invalid target "${params.args.target}". Expected schema.action.`,
                context,
            );
            return;
        }
        context.sessionContext.agentContext.contextSelectorSidecar.addKeywords(
            target.id,
            params.args.keywords,
        );
        showEffective(context, target);
    }
}

class CollisionKeywordsRemoveCommandHandler implements CommandHandler {
    public readonly description =
        "Remove keywords from a schema.action's effective set (masks derived + added)";
    public readonly parameters = {
        args: {
            target: {
                description: 'The schema.action to tune, e.g. "excel.addRow".',
                type: "string",
            },
            keywords: {
                description: "One or more keywords to remove.",
                type: "string",
                multiple: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const target = parseTarget(params.args.target);
        if (target === undefined) {
            displayWarn(
                `Invalid target "${params.args.target}". Expected schema.action.`,
                context,
            );
            return;
        }
        context.sessionContext.agentContext.contextSelectorSidecar.removeKeywords(
            target.id,
            params.args.keywords,
        );
        showEffective(context, target);
    }
}

class CollisionKeywordsClearCommandHandler implements CommandHandler {
    public readonly description =
        "Clear all overrides for a schema.action (revert to derived-only)";
    public readonly parameters = {
        args: {
            target: {
                description: 'The schema.action to reset, e.g. "excel.addRow".',
                type: "string",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const target = parseTarget(params.args.target);
        if (target === undefined) {
            displayWarn(
                `Invalid target "${params.args.target}". Expected schema.action.`,
                context,
            );
            return;
        }
        const removed =
            context.sessionContext.agentContext.contextSelectorSidecar.clearEntry(
                target.id,
            );
        displayResult(
            removed
                ? `Cleared overrides for ${target.id} (reverted to derived-only).`
                : `No overrides for ${target.id}.`,
            context,
        );
    }
}

export function getCollisionKeywordCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Inspect and tune per-action keyword vectors used by the contextSelector tier",
        defaultSubCommand: "list",
        commands: {
            list: new CollisionKeywordsListCommandHandler(),
            add: new CollisionKeywordsAddCommandHandler(),
            remove: new CollisionKeywordsRemoveCommandHandler(),
            clear: new CollisionKeywordsClearCommandHandler(),
        },
    };
}
