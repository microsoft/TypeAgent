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
    ProduceOptions,
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

// --- Backfill helpers --------------------------------------------------------
// Kept as free functions so the command's `run()` stays within the complexity
// budget: `run()` orchestrates, these do the branchy work.

type BackfillAgents = CommandHandlerContext["agents"];

type PendingFile = {
    path: string;
    file: KeywordFile;
    contributors: string[];
    distilled: number;
    lexical: number;
};

// Per-path pending files plus the classification buckets for schemas that were
// skipped / preserved / errored rather than written.
type BackfillPlan = {
    pendingByPath: Map<string, PendingFile>;
    preservedPaths: Set<string>;
    skippedNoActions: string[];
    skippedNoPath: string[];
    preserved: string[];
    loadErrors: string[];
};

function newBackfillPlan(): BackfillPlan {
    return {
        pendingByPath: new Map(),
        preservedPaths: new Set(),
        skippedNoActions: [],
        skippedNoPath: [],
        preserved: [],
        loadErrors: [],
    };
}

// Fold a produced keyword file into the pending map. Several schema names can
// share one source `.ts` (an agent's base + activity / sub schemas); their
// action vectors are UNIONED into the single shared file instead of overwriting.
function mergePendingFile(
    pendingByPath: Map<string, PendingFile>,
    keywordPath: string,
    schemaName: string,
    produced: { file: KeywordFile; distilled: number; lexical: number },
): void {
    const entry = pendingByPath.get(keywordPath);
    if (entry === undefined) {
        pendingByPath.set(keywordPath, {
            path: keywordPath,
            file: produced.file,
            contributors: [schemaName],
            distilled: produced.distilled,
            lexical: produced.lexical,
        });
        return;
    }
    // Co-located schemas have distinct action names, so this never clobbers.
    Object.assign(entry.file.actions, produced.file.actions);
    // The file is only fully "llm" if every contributor was.
    if (produced.file.generatedBy !== "llm") {
        entry.file.generatedBy = "lexical";
    }
    entry.contributors.push(schemaName);
    entry.distilled += produced.distilled;
    entry.lexical += produced.lexical;
}

// Phase 1 for one schema: resolve its committed keyword-file path, honor the
// preserve/force policy, produce its vector, and fold it into `plan`. Never
// throws — a schema whose file won't load is recorded in `plan.loadErrors`.
async function planSchemaBackfill(
    schemaName: string,
    agents: BackfillAgents,
    createModel: ProduceOptions["createModel"],
    force: boolean,
    plan: BackfillPlan,
): Promise<void> {
    try {
        const schemaFile = agents.tryGetActionSchemaFile(schemaName);
        const actionSchemas = schemaFile?.parsedActionSchema.actionSchemas;
        if (actionSchemas === undefined || actionSchemas.size === 0) {
            plan.skippedNoActions.push(schemaName);
            return;
        }
        // Committed keyword file: a sibling of this schema's `.ts` source. Only
        // place one beside a source that actually exists on disk — skips
        // inline/dynamic agents (echo, MCP) whose schema is generated in memory.
        const config = agents.tryGetActionConfig(schemaName);
        const sourcePath =
            config?.originalSchemaFilePath ?? config?.schemaFilePath;
        const keywordPath = keywordFilePathFor(
            config?.originalSchemaFilePath,
            config?.schemaFilePath,
        );
        if (
            keywordPath === undefined ||
            sourcePath === undefined ||
            !fs.existsSync(sourcePath)
        ) {
            plan.skippedNoPath.push(schemaName);
            return;
        }
        if (plan.preservedPaths.has(keywordPath)) {
            plan.preserved.push(schemaName);
            return;
        }
        // Don't let a lexical backfill silently downgrade an existing
        // LLM-distilled file — require --force (or --llm). Checked once per path
        // (the first time it is seen) so it also short-circuits the other
        // schemas that share that file.
        if (
            !plan.pendingByPath.has(keywordPath) &&
            createModel === undefined &&
            !force
        ) {
            const existing = loadKeywordFile(keywordPath, schemaName);
            if (existing?.generatedBy === "llm") {
                plan.preservedPaths.add(keywordPath);
                plan.preserved.push(schemaName);
                return;
            }
        }
        const input: SchemaActions = {
            schemaName,
            schemaDescription: config?.description,
            sourceHash: schemaFile?.sourceHash,
            actions: actionSchemas,
        };
        const produced = await produceKeywordFile(input, { createModel });
        mergePendingFile(plan.pendingByPath, keywordPath, schemaName, produced);
    } catch {
        // A schema whose file won't load/parse (a dynamic/inline agent with no
        // authored `.ts`, e.g. MCP) can't be backfilled — record it, but don't
        // let it abort the roster.
        plan.loadErrors.push(schemaName);
    }
}

type BackfillWriteResult = {
    filesWritten: number;
    schemasWritten: number;
    actionsTotal: number;
    distilledTotal: number;
    lexicalTotal: number;
    preservedTotal: number;
    mergedFiles: number;
    failed: string[];
};

// Phase 2: write each pending file once and invalidate the in-memory index so
// the fresh vectors take effect on the next collision without a restart.
// `preserveExisting` (set for a PARTIAL run that names specific schemas) merges
// any actions already on disk that this run didn't produce, so backfilling a
// subset of schemas that share one source file doesn't drop the omitted
// co-located siblings' committed vectors.
function writePendingFiles(
    pendingByPath: Map<string, PendingFile>,
    invalidate: (schemaName: string) => void,
    preserveExisting: boolean,
): BackfillWriteResult {
    const result: BackfillWriteResult = {
        filesWritten: 0,
        schemasWritten: 0,
        actionsTotal: 0,
        distilledTotal: 0,
        lexicalTotal: 0,
        preservedTotal: 0,
        mergedFiles: 0,
        failed: [],
    };
    for (const entry of pendingByPath.values()) {
        // Actions carried over from the on-disk file (a partial run keeping
        // co-located siblings) are preserved, not produced — counted separately
        // so `actionsTotal` stays equal to distilled + lexical.
        let preserved = 0;
        if (preserveExisting) {
            const existing = loadKeywordFile(entry.path, entry.file.schema);
            for (const [action, vec] of Object.entries(
                existing?.actions ?? {},
            )) {
                if (!(action in entry.file.actions)) {
                    entry.file.actions[action] = vec;
                    preserved++;
                }
            }
        }
        const written = writeKeywordFile(entry.path, entry.file);
        if (written === undefined) {
            result.failed.push(...entry.contributors);
            continue;
        }
        for (const s of entry.contributors) {
            invalidate(s);
        }
        result.filesWritten++;
        result.schemasWritten += entry.contributors.length;
        result.actionsTotal += entry.distilled + entry.lexical;
        result.distilledTotal += entry.distilled;
        result.lexicalTotal += entry.lexical;
        result.preservedTotal += preserved;
        if (entry.contributors.length > 1) {
            result.mergedFiles++;
        }
    }
    return result;
}

// Render the human-readable backfill summary.
function formatBackfillSummary(
    llm: boolean,
    plan: BackfillPlan,
    w: BackfillWriteResult,
): string {
    const lines = [
        `Keyword backfill complete (${llm ? "LLM distillation" : "lexical"}):`,
        `  files written:   ${w.filesWritten} (${w.schemasWritten} schemas)`,
        `  actions produced: ${w.actionsTotal} (distilled ${w.distilledTotal}, lexical ${w.lexicalTotal})`,
    ];
    if (w.preservedTotal > 0) {
        lines.push(
            `  kept:            ${w.preservedTotal} co-located action(s) carried over from existing file(s) (partial run)`,
        );
    }
    if (w.mergedFiles > 0) {
        lines.push(
            `  merged:          ${w.mergedFiles} file(s) shared by multiple schemas`,
        );
    }
    if (plan.preserved.length > 0) {
        lines.push(
            `  preserved (existing llm file; use --force to overwrite): ${plan.preserved.length}`,
        );
    }
    if (plan.skippedNoPath.length > 0) {
        lines.push(
            `  skipped (no committable source path): ${plan.skippedNoPath.length} (${plan.skippedNoPath.slice(0, 8).join(", ")}${plan.skippedNoPath.length > 8 ? ", …" : ""})`,
        );
    }
    if (plan.skippedNoActions.length > 0) {
        lines.push(
            `  skipped (no actions loaded): ${plan.skippedNoActions.length}`,
        );
    }
    if (plan.loadErrors.length > 0) {
        lines.push(
            `  skipped (schema did not load): ${plan.loadErrors.length} (${plan.loadErrors.join(", ")})`,
        );
    }
    if (w.failed.length > 0) {
        lines.push(`  FAILED to write: ${w.failed.join(", ")}`);
    }
    if (w.filesWritten > 0) {
        lines.push(
            "  Note: other active sessions pick up the change on their next reload.",
        );
    }
    return lines.join("\n");
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
        const partial = requested !== undefined && requested.length > 0;
        const schemaNames = partial ? requested : agents.getSchemaNames();

        // Default chat model, tagged for token accounting; only built when --llm.
        const createModel = params.flags.llm
            ? (name: string) => openai.createChatModelDefault(name)
            : undefined;

        const plan = newBackfillPlan();
        for (const schemaName of schemaNames) {
            await planSchemaBackfill(
                schemaName,
                agents,
                createModel,
                params.flags.force,
                plan,
            );
        }
        const written = writePendingFiles(
            plan.pendingByPath,
            (s) => ctx.contextSelectorKeywords.invalidate(s),
            partial,
        );
        displayResult(
            formatBackfillSummary(params.flags.llm, plan, written),
            context,
        );
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
