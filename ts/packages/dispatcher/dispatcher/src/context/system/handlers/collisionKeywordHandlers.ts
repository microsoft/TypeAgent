// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@collision keywords` — inspect and edit the per-(schema, action) keyword
// overrides consumed by the contextSelector tier (design §5.3). Edits land in
// the profile-scoped `collision-keywords.json` sidecar as deltas over the
// derived lexical defaults; the merged effective set feeds the scorer (§9).
//
// Target-first grammar (the schema.action is the primary key, §5.3):
//   @collision keywords                              # list all overrides
//   @collision keywords <schema.action>             # show derived + overrides, merged
//   @collision keywords <schema.action> list         # (same as above)
//   @collision keywords <schema.action> add k1 k2…  # add discriminative keywords
//   @collision keywords <schema.action> remove k1…  # mask keywords
//   @collision keywords <schema.action> clear        # revert to derived-only

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
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

function listAllOverrides(context: ActionContext<CommandHandlerContext>): void {
    const entries =
        context.sessionContext.agentContext.contextSelectorSidecar.list();
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
        if (delta.remove?.length) parts.push(`remove=[${delta.remove}]`);
        return `- ${id}: ${parts.join(" ")}`;
    });
    displayResult(
        `Keyword overrides (${entries.length}):\n${lines.join("\n")}`,
        context,
    );
}

// Single target-first handler (§5.3). Tokens are parsed manually so the target
// (schema.action) can come first with an optional trailing verb — matching the
// documented syntax rather than the framework's verb-first subcommand shape.
class CollisionKeywordsCommandHandler implements CommandHandler {
    public readonly description =
        "Inspect/tune contextSelector keyword vectors: @collision keywords [<schema.action> [list|add|remove|clear] [keywords…]]";
    public readonly parameters = {
        args: {
            tokens: {
                description:
                    'e.g. "list.addItems", "list.addItems add grocery shopping", or omit to list all overrides.',
                type: "string",
                multiple: true,
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const tokens = params.args.tokens ?? [];
        if (tokens.length === 0) {
            listAllOverrides(context);
            return;
        }
        const target = parseTarget(tokens[0]);
        if (target === undefined) {
            displayWarn(
                `Invalid target "${tokens[0]}". Expected schema.action, e.g. "list.addItems".`,
                context,
            );
            return;
        }
        const verb = (tokens[1] ?? "list").toLowerCase();
        const keywords = tokens.slice(2);
        const sidecar =
            context.sessionContext.agentContext.contextSelectorSidecar;

        switch (verb) {
            case "list":
            case "show":
                showEffective(context, target);
                return;
            case "add":
                if (keywords.length === 0) {
                    displayWarn(
                        `Provide keywords to add, e.g. "@collision keywords ${target.id} add grocery shopping".`,
                        context,
                    );
                    return;
                }
                sidecar.addKeywords(target.id, keywords);
                showEffective(context, target);
                return;
            case "remove":
                if (keywords.length === 0) {
                    displayWarn(
                        `Provide keywords to remove, e.g. "@collision keywords ${target.id} remove office".`,
                        context,
                    );
                    return;
                }
                sidecar.removeKeywords(target.id, keywords);
                showEffective(context, target);
                return;
            case "clear": {
                const removed = sidecar.clearEntry(target.id);
                displayResult(
                    removed
                        ? `Cleared overrides for ${target.id} (reverted to derived-only).`
                        : `No overrides for ${target.id}.`,
                    context,
                );
                return;
            }
            default:
                displayWarn(
                    `Unknown verb "${verb}". Use list, add, remove, or clear.`,
                    context,
                );
                return;
        }
    }
}

export function getCollisionKeywordCommandHandlers(): CommandHandler {
    return new CollisionKeywordsCommandHandler();
}
