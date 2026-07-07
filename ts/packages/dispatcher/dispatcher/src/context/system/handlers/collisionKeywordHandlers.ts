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
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { openai } from "@typeagent/aiclient";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { KeywordVector } from "../../contextSelector/keywordVector.js";
import {
    produceKeywordFile,
    SchemaActions,
} from "../../contextSelector/keywordProducer.js";
import {
    writeKeywordFile,
    loadKeywordFile,
    keywordFilePathFor,
} from "../../contextSelector/keywordFile.js";

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

// `@collision keywords backfill [--llm] [schema…]` — generate/refresh the
// committed keyword files (§5 Source 1) via standard extraction (§6.1). Lexical
// by default (deterministic, no model); `--llm` runs the preferred distillation
// pass. Writes `<schema>.keywords.json` for every loaded schema (or the named
// ones) and invalidates the in-memory index so the fresh vectors take effect on
// the next collision without a restart.
class CollisionKeywordsBackfillCommandHandler implements CommandHandler {
    public readonly description =
        "Backfill/refresh committed keyword files for agent actions. Lexical by default; --llm uses the preferred LLM distillation pass.";
    public readonly parameters = {
        flags: {
            llm: {
                description:
                    "Use LLM distillation (the preferred producer) instead of the deterministic lexical floor.",
                type: "boolean",
                default: false,
            },
            force: {
                description:
                    "Overwrite an existing LLM-distilled file with a lexical one (a lexical backfill preserves llm files by default).",
                type: "boolean",
                default: false,
            },
        },
        args: {
            schemas: {
                description:
                    "Schema names to backfill; omit to backfill every loaded schema.",
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
        const ctx = context.sessionContext.agentContext;
        const agents = ctx.agents;
        const requested = params.args.schemas;
        const schemaNames =
            requested !== undefined && requested.length > 0
                ? requested
                : agents.getSchemaNames();

        // Default chat model, tagged for token accounting; only built when --llm.
        const createModel = params.flags.llm
            ? (name: string) => openai.createChatModelDefault(name)
            : undefined;

        let schemasWritten = 0;
        let actionsTotal = 0;
        let distilledTotal = 0;
        let lexicalTotal = 0;
        const skipped: string[] = [];
        const preserved: string[] = [];
        const failed: string[] = [];

        for (const schemaName of schemaNames) {
            try {
                const schemaFile = agents.tryGetActionSchemaFile(schemaName);
                const actionSchemas =
                    schemaFile?.parsedActionSchema.actionSchemas;
                if (actionSchemas === undefined || actionSchemas.size === 0) {
                    skipped.push(schemaName);
                    continue;
                }
                // Per-agent keyword file: a sibling of this schema's source.
                // No path (dynamic/inline agent) -> can't place a committed file.
                const config = agents.tryGetActionConfig(schemaName);
                const keywordPath = keywordFilePathFor(
                    config?.originalSchemaFilePath,
                    config?.schemaFilePath,
                );
                if (keywordPath === undefined) {
                    skipped.push(schemaName);
                    continue;
                }
                // Don't let a lexical backfill silently downgrade an existing
                // LLM-distilled file — require --force (or --llm) to overwrite it.
                if (createModel === undefined && !params.flags.force) {
                    const existing = loadKeywordFile(keywordPath, schemaName);
                    if (existing?.generatedBy === "llm") {
                        preserved.push(schemaName);
                        continue;
                    }
                }
                const input: SchemaActions = {
                    schemaName,
                    schemaDescription: config?.description,
                    sourceHash: schemaFile?.sourceHash,
                    actions: actionSchemas,
                };
                const { file, distilled, lexical } = await produceKeywordFile(
                    input,
                    { createModel },
                );
                const written = writeKeywordFile(keywordPath, file);
                if (written === undefined) {
                    failed.push(schemaName);
                    continue;
                }
                // Drop cached vectors so the fresh file is read next collision.
                ctx.contextSelectorKeywords.invalidate(schemaName);
                schemasWritten++;
                actionsTotal += Object.keys(file.actions).length;
                distilledTotal += distilled;
                lexicalTotal += lexical;
            } catch {
                // One unloadable/misbehaving schema must not abort the roster.
                failed.push(schemaName);
            }
        }

        const lines = [
            `Keyword backfill complete (${params.flags.llm ? "LLM distillation" : "lexical"}):`,
            `  schemas written: ${schemasWritten}`,
            `  actions:         ${actionsTotal} (distilled ${distilledTotal}, lexical ${lexicalTotal})`,
        ];
        if (preserved.length > 0) {
            lines.push(
                `  preserved (existing llm file; use --force to overwrite): ${preserved.length}`,
            );
        }
        if (skipped.length > 0) {
            lines.push(
                `  skipped (no actions loaded): ${skipped.length} (${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? ", …" : ""})`,
            );
        }
        if (failed.length > 0) {
            lines.push(`  FAILED to write: ${failed.join(", ")}`);
        }
        if (schemasWritten > 0) {
            lines.push(
                "  Note: other active sessions pick up the change on their next reload.",
            );
        }
        displayResult(lines.join("\n"), context);
    }
}

export function getCollisionKeywordCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Inspect/tune contextSelector keyword vectors, or backfill the committed keyword files.",
        // `backfill` is an explicit subcommand; anything else (a schema.action
        // target, or nothing) falls through to the target-first handler.
        defaultSubCommand: new CollisionKeywordsCommandHandler(),
        commands: {
            backfill: new CollisionKeywordsBackfillCommandHandler(),
        },
    };
}
