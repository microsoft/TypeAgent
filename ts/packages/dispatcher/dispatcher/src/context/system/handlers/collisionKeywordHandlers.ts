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
import fs from "node:fs";
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
    KeywordFile,
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

        // Produce a keyword file per schema, but GROUP by the committed file
        // path first: several schema names can share one source `.ts` (an agent's
        // base schema plus its activity / sub schemas), and each must MERGE its
        // action vectors into the single shared file instead of overwriting the
        // others (which would silently drop the earlier schema's vectors).
        type PendingFile = {
            path: string;
            file: KeywordFile;
            contributors: string[];
            distilled: number;
            lexical: number;
        };
        const pendingByPath = new Map<string, PendingFile>();
        const preservedPaths = new Set<string>();
        const skippedNoActions: string[] = [];
        const skippedNoPath: string[] = [];
        const preserved: string[] = [];
        const failed: string[] = [];
        const loadErrors: string[] = [];

        for (const schemaName of schemaNames) {
            try {
                const schemaFile = agents.tryGetActionSchemaFile(schemaName);
                const actionSchemas =
                    schemaFile?.parsedActionSchema.actionSchemas;
                if (actionSchemas === undefined || actionSchemas.size === 0) {
                    skippedNoActions.push(schemaName);
                    continue;
                }
                // Committed keyword file: a sibling of this schema's `.ts`
                // source. No path -> a dynamic/inline agent (or a dist-only
                // schema) that can't host a committed file and uses the floor.
                const config = agents.tryGetActionConfig(schemaName);
                const sourcePath =
                    config?.originalSchemaFilePath ?? config?.schemaFilePath;
                const keywordPath = keywordFilePathFor(
                    config?.originalSchemaFilePath,
                    config?.schemaFilePath,
                );
                // Only place a committed file beside a source that actually
                // exists on disk — skips inline/dynamic agents (echo, MCP) whose
                // schema is generated in memory, not authored in a `.ts` file.
                if (
                    keywordPath === undefined ||
                    sourcePath === undefined ||
                    !fs.existsSync(sourcePath)
                ) {
                    skippedNoPath.push(schemaName);
                    continue;
                }
                if (preservedPaths.has(keywordPath)) {
                    preserved.push(schemaName);
                    continue;
                }
                // Don't let a lexical backfill silently downgrade an existing
                // LLM-distilled file — require --force (or --llm). Checked once
                // per path (the first time it is seen) so it also short-circuits
                // producing for the other schemas that share that file.
                if (
                    !pendingByPath.has(keywordPath) &&
                    createModel === undefined &&
                    !params.flags.force
                ) {
                    const existing = loadKeywordFile(keywordPath, schemaName);
                    if (existing?.generatedBy === "llm") {
                        preservedPaths.add(keywordPath);
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
                const entry = pendingByPath.get(keywordPath);
                if (entry === undefined) {
                    pendingByPath.set(keywordPath, {
                        path: keywordPath,
                        file,
                        contributors: [schemaName],
                        distilled,
                        lexical,
                    });
                } else {
                    // Union the action vectors; co-located schemas have distinct
                    // action names, so a merge never clobbers another's vector.
                    Object.assign(entry.file.actions, file.actions);
                    // The file is only fully "llm" if every contributor was.
                    if (file.generatedBy !== "llm") {
                        entry.file.generatedBy = "lexical";
                    }
                    entry.contributors.push(schemaName);
                    entry.distilled += distilled;
                    entry.lexical += lexical;
                }
            } catch {
                // A schema whose file won't load/parse (a dynamic/inline agent
                // with no authored `.ts`, e.g. MCP) can't be backfilled — record
                // it, but don't let it abort the roster.
                loadErrors.push(schemaName);
            }
        }

        let filesWritten = 0;
        let schemasWritten = 0;
        let actionsTotal = 0;
        let distilledTotal = 0;
        let lexicalTotal = 0;
        let mergedFiles = 0;
        for (const entry of pendingByPath.values()) {
            const written = writeKeywordFile(entry.path, entry.file);
            if (written === undefined) {
                failed.push(...entry.contributors);
                continue;
            }
            // Drop cached vectors so the fresh file is read next collision.
            for (const s of entry.contributors) {
                ctx.contextSelectorKeywords.invalidate(s);
            }
            filesWritten++;
            schemasWritten += entry.contributors.length;
            actionsTotal += Object.keys(entry.file.actions).length;
            distilledTotal += entry.distilled;
            lexicalTotal += entry.lexical;
            if (entry.contributors.length > 1) {
                mergedFiles++;
            }
        }

        const lines = [
            `Keyword backfill complete (${params.flags.llm ? "LLM distillation" : "lexical"}):`,
            `  files written:   ${filesWritten} (${schemasWritten} schemas)`,
            `  actions:         ${actionsTotal} (distilled ${distilledTotal}, lexical ${lexicalTotal})`,
        ];
        if (mergedFiles > 0) {
            lines.push(
                `  merged:          ${mergedFiles} file(s) shared by multiple schemas`,
            );
        }
        if (preserved.length > 0) {
            lines.push(
                `  preserved (existing llm file; use --force to overwrite): ${preserved.length}`,
            );
        }
        if (skippedNoPath.length > 0) {
            lines.push(
                `  skipped (no committable source path): ${skippedNoPath.length} (${skippedNoPath.slice(0, 8).join(", ")}${skippedNoPath.length > 8 ? ", …" : ""})`,
            );
        }
        if (skippedNoActions.length > 0) {
            lines.push(
                `  skipped (no actions loaded): ${skippedNoActions.length}`,
            );
        }
        if (loadErrors.length > 0) {
            lines.push(
                `  skipped (schema did not load): ${loadErrors.length} (${loadErrors.join(", ")})`,
            );
        }
        if (failed.length > 0) {
            lines.push(`  FAILED to write: ${failed.join(", ")}`);
        }
        if (filesWritten > 0) {
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
