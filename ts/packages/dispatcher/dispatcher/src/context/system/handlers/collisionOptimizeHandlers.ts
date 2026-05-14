// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@collision optimize …` command handlers.
//
// Phase 2 shipped `list-levers`. Phase 3 adds `explore` — the core
// engine. Subsequent phases land: validate (5), patterns (6), run (7),
// distill (9).
//
// `initBuiltInLevers()` runs at command-creation time so the registry is
// populated before any handler runs.

import * as path from "node:path";

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayStatus, displayWarn } from "@typeagent/agent-sdk/helpers/display";

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { listLevers } from "../../../neighborhoods/optimize/registry.js";
import { initBuiltInLevers } from "../../../neighborhoods/optimize/levers/index.js";
import { runCorpusLoop } from "../../../neighborhoods/optimize/corpusLoop.js";
import { loadSandboxProvider } from "../../../neighborhoods/optimize/sandboxProvider.js";
import {
    translateCorpusWithProvider,
} from "../../../neighborhoods/optimize/sandboxTranslate.js";
import {
    defaultPath,
    resolveWorkdir,
    withReadOnlySession,
} from "../../../neighborhoods/optimize/util.js";
import type {
    CaseDescription,
    Hypothesis,
} from "../../../neighborhoods/optimize/types.js";
import type { DiffPayload } from "../../../neighborhoods/optimize/hypothesisEvaluator.js";
import type { TranslationCorpus } from "../../../translation/translationProbeRunner.js";
import { runValidate } from "../../../neighborhoods/optimize/validateImpact.js";
import {
    minePatterns,
    parsePatternsJsonl,
} from "../../../neighborhoods/optimize/patternMiner.js";
import { buildPatternsHTML } from "../../../neighborhoods/optimize/patternsViz.js";
import { runPipeline } from "../../../neighborhoods/optimize/runPipeline.js";
import {
    RUN_STEPS,
    type RunStep,
} from "../../../neighborhoods/optimize/runSteps.js";
import * as fs from "node:fs";

const DEFAULT_NEIGHBORHOODS_JSON = "neighborhoods.json";
const DEFAULT_BASELINE = "translation-results.json";

// =============================================================================
// list-levers
// =============================================================================

class CollisionOptimizeListLeversCommandHandler implements CommandHandler {
    public readonly description =
        "List all registered optimization levers with their description, consumes, and probeType.";
    public readonly parameters = {} as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        _params: ParsedCommandParams<typeof this.parameters>,
    ) {
        initBuiltInLevers();
        const levers = listLevers();

        const rows = levers.map((l) => ({
            name: l.name,
            description: l.description,
            consumes: l.consumes.join(", "),
            probeType: l.probeType,
        }));

        const textLines = [
            `${rows.length} lever(s) registered:`,
            ...rows.map(
                (r) =>
                    `  ${r.name.padEnd(12)} [${r.probeType}] consumes(${r.consumes}) — ${r.description}`,
            ),
        ];
        const htmlRows = rows
            .map(
                (r) =>
                    `<tr><td><b>${r.name}</b></td><td>${r.probeType}</td><td>${r.consumes}</td><td>${r.description}</td></tr>`,
            )
            .join("");
        const html =
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1000px;">` +
            `<h3 style="margin:0 0 6px;font-size:14px;">${rows.length} lever(s) registered</h3>` +
            `<table style="font-size:12px;border-collapse:collapse;width:100%;">` +
            `<thead><tr style="background:#f4f4f4;"><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd;">name</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd;">probe</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd;">consumes</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd;">description</th></tr></thead>` +
            `<tbody>${htmlRows}</tbody>` +
            `</table>` +
            `</div>`;

        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: textLines }],
        });
    }
}

// =============================================================================
// explore — the core command
// =============================================================================

class CollisionOptimizeExploreCommandHandler implements CommandHandler {
    public readonly description =
        "Run the optimize loop on the top-N collision neighborhoods. Writes an attempts archive under <workdir>/optimization-run-<ts>/.";
    public readonly parameters = {
        flags: {
            corpus: {
                description: `Path to neighborhoods.json (default <workdir>/${DEFAULT_NEIGHBORHOODS_JSON})`,
                type: "string",
                optional: true,
            },
            baseline: {
                description: `Path to translation-results.json (default <workdir>/${DEFAULT_BASELINE})`,
                type: "string",
                optional: true,
            },
            top: {
                description: "Top-N cases by gravity to run (default 5)",
                type: "number",
                default: 5,
            },
            "hypotheses-per-lever": {
                description:
                    "K hypotheses per lever per case (default 3). Reserved — levers pick K from this flag in a future revision.",
                type: "number",
                default: 3,
            },
            depth: {
                description:
                    "Recursion depth budget (default 2). When all hypotheses at depth N regress, the case loop re-prompts the LLM with the failed mechanisms and asks for a different approach.",
                type: "number",
                default: 2,
            },
            lever: {
                description:
                    "Comma-separated lever names. Default: all registered levers.",
                type: "string",
                optional: true,
            },
            severity: {
                description:
                    "Comma-separated severity tiers to include (default blocker,leaky). Allowed: blocker, leaky, minor.",
                type: "string",
                default: "blocker,leaky",
            },
            workdir: {
                description:
                    "Directory for default-named files. Default: <instanceDir>/collisions",
                type: "string",
                optional: true,
            },
            "dry-run": {
                description:
                    "Write attempt scaffolding only — no LLM calls, no apply, no probe.",
                type: "boolean",
                default: false,
            },
            concurrency: {
                description: "Reserved for future per-case parallelism.",
                type: "number",
                default: 8,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        initBuiltInLevers();
        const systemContext = context.sessionContext.agentContext;
        const workdir = resolveWorkdir(systemContext, params.flags.workdir);
        const neighborhoodsPath = defaultPath(
            systemContext,
            params.flags.corpus,
            workdir,
            DEFAULT_NEIGHBORHOODS_JSON,
        );
        const baselinePath = defaultPath(
            systemContext,
            params.flags.baseline,
            workdir,
            DEFAULT_BASELINE,
        );

        const leverFilter = parseCsvList(params.flags.lever);
        const severities = parseSeverities(params.flags.severity);
        if (!severities) {
            displayWarn(
                `Invalid --severity value. Allowed: blocker, leaky, minor (comma-separated).`,
                context,
            );
            return;
        }

        const dryRun = params.flags["dry-run"] ?? false;

        const onProgress = (label: string) =>
            displayStatus(`Optimize · ${label}`, context);

        // Real-run probe: load the baseline corpus once, build a focused
        // sub-corpus per attempt via the bidirectional phrase filter, run
        // sandbox-aware translateRequest, diff vs. baseline.
        let runProbe:
            | ((
                  runRoot: string,
                  hypothesis: Hypothesis,
                  caseDesc: CaseDescription,
              ) => Promise<DiffPayload>)
            | undefined;
        if (!dryRun) {
            runProbe = async (runRoot, hypothesis, caseDesc) =>
                runRealProbe(
                    runRoot,
                    hypothesis,
                    caseDesc,
                    baselinePath,
                    context,
                );
        }

        try {
            await withReadOnlySession(context, async () => {
                const run = await runCorpusLoop({
                    neighborhoodsPath,
                    baselinePath,
                    workdir,
                    sourceProvider: systemContext.agents,
                    context,
                    top: params.flags.top ?? 5,
                    severities,
                    ...(leverFilter && { leverFilter }),
                    depth: params.flags.depth ?? 2,
                    ...(runProbe && { runProbe }),
                    dryRun,
                    concurrency: params.flags.concurrency ?? 8,
                    onProgress,
                });

                const text = [
                    `Optimize run ${run.runId} written`,
                    `  cases: ${run.cases.length}`,
                    `  winners: ${run.cases.filter((c) => c.winner !== null).length}`,
                    `  sandbox: ${run.sandboxRoot}`,
                    `  coverage: ${run.corpusCoverage.reachableMass}/${run.corpusCoverage.totalCollisionMass} mass`,
                    dryRun ? "  (dry-run — no LLM, no probe)" : "",
                ].filter((l) => l.length > 0);
                context.actionIO.appendDisplay({
                    type: "text",
                    content: text,
                });
            });
        } catch (err) {
            displayWarn(
                `Optimize run failed: ${err instanceof Error ? err.message : String(err)}`,
                context,
            );
            throw err;
        }
    }
}

// =============================================================================
// Real-probe wrapper — Phase 3 minimum.
// =============================================================================

async function runRealProbe(
    runRoot: string,
    _hypothesis: Hypothesis,
    caseDesc: CaseDescription,
    baselinePath: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<DiffPayload> {
    const sandboxDir = path.join(runRoot, "sandbox");
    const { provider: sandboxProvider } = loadSandboxProvider(sandboxDir);

    // Build a focused corpus from the case's phrases (misroute + clean +
    // reverse-direction). One TranslationCorpus per probe.
    const corpus = buildFocusedCorpus(caseDesc);

    // Build a baseline-row index so we can diff each phrase result.
    const baseline = JSON.parse(
        require("node:fs").readFileSync(baselinePath, "utf-8"),
    );
    const baselineByPhrase = new Map<
        string,
        { chosenSchema?: string; chosenAction?: string; outcome: string }
    >();
    for (const row of baseline.results ?? []) {
        const key = `${row.expectedSchema}\0${row.expectedAction}\0${row.phraseText}`;
        baselineByPhrase.set(key, {
            chosenSchema: row.chosenSchema,
            chosenAction: row.chosenAction,
            outcome: row.outcome,
        });
    }

    // Corpus is already filtered to the neighborhood's phrases; no extra
    // phraseFilter needed.
    const probe = await translateCorpusWithProvider(
        sandboxProvider,
        corpus,
        context,
        {},
    );

    // Compare phrase by phrase: a rescue is baseline=MISROUTE → candidate=CLEAN
    // for an expected member; a regression is baseline=CLEAN → candidate=MISROUTE
    // OR baseline=MISROUTE-to-non-member → candidate=MISROUTE-to-member.
    let rescues = 0;
    let regressions = 0;
    const regressionPhrases: string[] = [];
    const memberKeys = new Set(
        caseDesc.members.map((m) => `${m.schemaName}.${m.actionName}`),
    );

    for (const row of probe.results) {
        const baselineRow = baselineByPhrase.get(
            `${row.expectedSchema}\0${row.expectedAction}\0${row.phraseText}`,
        );
        if (!baselineRow) continue;

        const expectedKey = `${row.expectedSchema}.${row.expectedAction}`;
        const candidateMatches =
            row.outcome === "CLEAN" &&
            row.chosenSchema === row.expectedSchema &&
            row.chosenAction === row.expectedAction;
        const baselineMatches = baselineRow.outcome === "CLEAN";

        if (memberKeys.has(expectedKey)) {
            if (!baselineMatches && candidateMatches) rescues++;
            else if (baselineMatches && !candidateMatches) {
                regressions++;
                regressionPhrases.push(row.phraseText);
            }
        }
    }

    return { rescues, regressions, regressionPhrases };
}

/**
 * Build a single TranslationCorpus from a CaseDescription's phrases. The
 * corpus groups phrases by (expectedSchema, expectedAction) so the probe
 * runner can iterate cleanly. Uses the union of misroute + clean +
 * reverse-direction phrases.
 */
function buildFocusedCorpus(caseDesc: CaseDescription): TranslationCorpus {
    const byAction = new Map<
        string,
        {
            schemaName: string;
            actionName: string;
            phrases: { text: string; sources: any[] }[];
        }
    >();
    const all = [
        ...caseDesc.misroutePhrases,
        ...caseDesc.cleanPhrases,
        ...caseDesc.reverseDirectionPhrases,
    ];
    for (const p of all) {
        const key = `${p.expectedSchema}.${p.expectedAction}`;
        let bucket = byAction.get(key);
        if (!bucket) {
            bucket = {
                schemaName: p.expectedSchema,
                actionName: p.expectedAction,
                phrases: [],
            };
            byAction.set(key, bucket);
        }
        bucket.phrases.push({
            text: p.phraseText,
            sources: p.sources ?? [],
        });
    }
    return {
        actions: [...byAction.values()],
    };
}

function parseCsvList(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return parts.length > 0 ? parts : undefined;
}

function parseSeverities(
    raw: string | undefined,
):
    | ("blocker" | "leaky" | "minor")[]
    | undefined {
    const allowed = new Set(["blocker", "leaky", "minor"]);
    const list = parseCsvList(raw);
    if (!list) return ["blocker", "leaky"];
    for (const s of list) {
        if (!allowed.has(s)) return undefined;
    }
    return list as ("blocker" | "leaky" | "minor")[];
}

// =============================================================================
// Subcommand table
// =============================================================================

// =============================================================================
// validate — stack winners + combined re-probe
// =============================================================================

class CollisionOptimizeValidateCommandHandler implements CommandHandler {
    public readonly description =
        "Stack all winners from an optimization run and re-probe the full baseline corpus. Emits optimization-impact.{json,html} with cross-neighborhood regression flags.";
    public readonly parameters = {
        flags: {
            run: {
                description:
                    "Run timestamp (the <ts> in optimization-run-<ts>/). Default: latest under <workdir>.",
                type: "string",
                optional: true,
            },
            phrases: {
                description:
                    "Restrict re-probing to phrases for a single neighborhood id. Faster for targeted iteration.",
                type: "string",
                optional: true,
            },
            baseline: {
                description:
                    "Override the baseline path recorded in optimization-run.json (useful when the original baseline moved).",
                type: "string",
                optional: true,
            },
            workdir: {
                description:
                    "Directory containing optimization-run-* subdirectories. Default: <instanceDir>/collisions.",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        initBuiltInLevers();
        const systemContext = context.sessionContext.agentContext;
        const workdir = resolveWorkdir(systemContext, params.flags.workdir);

        const onProgress = (label: string) =>
            displayStatus(`Validate · ${label}`, context);

        try {
            await withReadOnlySession(context, async () => {
                const result = await runValidate({
                    workdir,
                    ...(params.flags.run && { runId: params.flags.run }),
                    ...(params.flags.phrases && {
                        neighborhoodFilter: params.flags.phrases,
                    }),
                    ...(params.flags.baseline && {
                        baselinePathOverride: params.flags.baseline,
                    }),
                    sourceProvider: systemContext.agents,
                    context,
                    onProgress,
                });
                const t = result.impact.transitions;
                const flagged = result.impact.winners.filter(
                    (w) => w.crossNeighborhoodRegression,
                ).length;
                const text = [
                    `Validate written: ${result.impactJsonPath}`,
                    `  HTML: ${result.impactHtmlPath}`,
                    `  rescued: ${t.rescued} · regressed: ${t.regressed} · total: ${t.total}`,
                    flagged > 0
                        ? `  ⚠ ${flagged} winner(s) flagged with cross-neighborhood regression — review before applying`
                        : "",
                ].filter((l) => l.length > 0);
                context.actionIO.appendDisplay({
                    type: "text",
                    content: text,
                });
            });
        } catch (err) {
            displayWarn(
                `Validate failed: ${err instanceof Error ? err.message : String(err)}`,
                context,
            );
            throw err;
        }
    }
}

// =============================================================================
// patterns — cross-run miner
// =============================================================================

class CollisionOptimizePatternsCommandHandler implements CommandHandler {
    public readonly description =
        "Mine patterns.jsonl across all accumulated optimize runs. Emits patterns.{json,html} with three groupings (mechanism × pattern, per-lever, lever-effectiveness) plus classifier agreement.";
    public readonly parameters = {
        flags: {
            "patterns-file": {
                description:
                    "Path to patterns.jsonl. Default: <workdir>/patterns.jsonl",
                type: "string",
                optional: true,
            },
            "min-attempts": {
                description:
                    "Cells with fewer attempts than this render as '—' (default 5).",
                type: "number",
                default: 5,
            },
            "surface-disagreement": {
                description:
                    "Highlight classifier-disagreement cells above this rate (0-1, default 0.5).",
                type: "string",
                default: "0.5",
            },
            out: {
                description: "Output JSON path (default <workdir>/patterns.json).",
                type: "string",
                optional: true,
            },
            "out-html": {
                description:
                    "Output HTML path (default <workdir>/patterns.html).",
                type: "string",
                optional: true,
            },
            workdir: {
                description:
                    "Directory containing patterns.jsonl. Default: <instanceDir>/collisions.",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const workdir = resolveWorkdir(systemContext, params.flags.workdir);
        const patternsFile = defaultPath(
            systemContext,
            params.flags["patterns-file"],
            workdir,
            "patterns.jsonl",
        );
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            "patterns.json",
        );
        const outHtmlPath = defaultPath(
            systemContext,
            params.flags["out-html"],
            workdir,
            "patterns.html",
        );

        if (!fs.existsSync(patternsFile)) {
            displayWarn(
                `patterns.jsonl not found at ${patternsFile}. Run @collision optimize explore first to accumulate data.`,
                context,
            );
            return;
        }

        const minAttempts = Math.max(
            1,
            params.flags["min-attempts"] ?? 5,
        );
        const surfaceDisagreementRaw = parseFloat(
            params.flags["surface-disagreement"] ?? "0.5",
        );
        const surfaceDisagreement = Number.isFinite(surfaceDisagreementRaw)
            ? Math.max(0, Math.min(1, surfaceDisagreementRaw))
            : 0.5;

        const content = fs.readFileSync(patternsFile, "utf-8");
        const rows = parsePatternsJsonl(content);
        const report = minePatterns({ rows });

        fs.writeFileSync(outPath, JSON.stringify(report, undefined, 2));
        fs.writeFileSync(
            outHtmlPath,
            buildPatternsHTML(report, {
                minAttempts,
                surfaceDisagreement,
            }),
        );

        const lines = [
            `Patterns written: ${outPath}`,
            `  HTML: ${outHtmlPath}`,
            `  attempts: ${report.totalAttempts} across ${report.totalRuns} run(s)`,
            `  --min-attempts=${minAttempts} --surface-disagreement=${surfaceDisagreement}`,
        ];
        context.actionIO.appendDisplay({
            type: "text",
            content: lines,
        });
    }
}

// =============================================================================
// run — 5-step pipeline orchestrator
// =============================================================================

class CollisionOptimizeRunCommandHandler implements CommandHandler {
    public readonly description =
        "Run the full optimize pipeline (neighborhoods → explore → validate → patterns → distill) with --from gating. Each step's predecessor must exist before it runs.";
    public readonly parameters = {
        flags: {
            from: {
                description: `Resume from a step: ${RUN_STEPS.join(" | ")} (default neighborhoods)`,
                type: "string",
                default: "neighborhoods",
            },
            top: {
                description: "Top-N cases (forwarded to explore, default 5)",
                type: "number",
                default: 5,
            },
            depth: {
                description:
                    "Recursion depth (forwarded to explore, default 2).",
                type: "number",
                default: 2,
            },
            lever: {
                description: "Lever filter (forwarded to explore)",
                type: "string",
                optional: true,
            },
            severity: {
                description:
                    "Severity tiers (forwarded to explore, default blocker,leaky)",
                type: "string",
                default: "blocker,leaky",
            },
            "dry-run": {
                description: "Dry-run mode (forwarded to explore).",
                type: "boolean",
                default: false,
            },
            "skip-distill": {
                description:
                    "Skip the distill step regardless of attempt count.",
                type: "boolean",
                default: false,
            },
            "distill-min-attempts": {
                description:
                    "Minimum winners in patterns.jsonl before distill runs (default 10).",
                type: "number",
                default: 10,
            },
            workdir: {
                description:
                    "Directory for pipeline intermediates. Default: <instanceDir>/collisions.",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        initBuiltInLevers();
        const systemContext = context.sessionContext.agentContext;
        const workdir = resolveWorkdir(systemContext, params.flags.workdir);

        const fromRaw = (params.flags.from ?? "neighborhoods") as string;
        if (!(RUN_STEPS as readonly string[]).includes(fromRaw)) {
            displayWarn(
                `Invalid --from "${fromRaw}". Use one of: ${RUN_STEPS.join(", ")}.`,
                context,
            );
            return;
        }
        const from = fromRaw as RunStep;

        const leverFilter = parseCsvList(params.flags.lever);
        const severities = parseSeverities(params.flags.severity);
        if (!severities) {
            displayWarn(
                `Invalid --severity value. Allowed: blocker, leaky, minor (comma-separated).`,
                context,
            );
            return;
        }

        const dryRun = params.flags["dry-run"] ?? false;
        const skipDistill = params.flags["skip-distill"] ?? false;
        const distillMinAttempts =
            params.flags["distill-min-attempts"] ?? 10;

        try {
            const result = await runPipeline({
                context,
                workdir,
                from,
                ...(skipDistill && { skipDistill: true }),
                top: params.flags.top ?? 5,
                depth: params.flags.depth ?? 2,
                ...(leverFilter && { leverFilter }),
                severities,
                ...(dryRun && { dryRun: true }),
                distillMinAttempts,
                onStep: (step, label) =>
                    displayStatus(`Pipeline · ${step}: ${label}`, context),
            });
            const lines = [
                `Pipeline complete from --from=${from}`,
                `  ran: ${result.stepsRun.join(", ") || "(none)"}`,
                result.stepsSkipped.length > 0
                    ? `  skipped: ${result.stepsSkipped
                          .map((s) => `${s.step} (${s.reason})`)
                          .join("; ")}`
                    : "",
                dryRun ? "  (dry-run — no LLM, no probe)" : "",
            ].filter((l) => l.length > 0);
            context.actionIO.appendDisplay({
                type: "text",
                content: lines,
            });
        } catch (err) {
            displayWarn(
                `Pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
                context,
            );
            throw err;
        }
    }
}

// =============================================================================
// distill — Phase 9 placeholder
// =============================================================================

class CollisionOptimizeDistillCommandHandler implements CommandHandler {
    public readonly description =
        "Distill winning attempts in patterns.jsonl into candidate schemaGuidelines additions. Groups winners by (mechanism, guidelineHook), calls the LLM with the current schemaGuidelines as context, writes schemaGuidelines.candidates.md for operator review.";
    public readonly parameters = {
        flags: {
            "min-attempts": {
                description:
                    "Minimum winners in patterns.jsonl before distill runs (default 10).",
                type: "number",
                default: 10,
            },
            workdir: {
                description: "Workdir containing patterns.jsonl.",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const workdir = resolveWorkdir(systemContext, params.flags.workdir);
        const patternsFile = path.join(workdir, "patterns.jsonl");
        if (!fs.existsSync(patternsFile)) {
            displayWarn(
                `distill: ${patternsFile} not found. Run explore first.`,
                context,
            );
            return;
        }
        // Delegate to runPipeline starting at distill — same logic, same
        // gating, same placeholder output. Keeps the implementation in
        // one place; Phase 9 fills it in there.
        try {
            const result = await runPipeline({
                context,
                workdir,
                from: "distill",
                distillMinAttempts: params.flags["min-attempts"] ?? 10,
            });
            const skipped = result.stepsSkipped.find(
                (s) => s.step === "distill",
            );
            const text = [
                skipped
                    ? `distill skipped: ${skipped.reason}`
                    : `distill complete — wrote ${path.join(workdir, "schemaGuidelines.candidates.md")}`,
            ];
            context.actionIO.appendDisplay({
                type: "text",
                content: text,
            });
        } catch (err) {
            displayWarn(
                `distill failed: ${err instanceof Error ? err.message : String(err)}`,
                context,
            );
            throw err;
        }
    }
}

// =============================================================================
// Subcommand table
// =============================================================================

export function getCollisionOptimizeCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Optimize translator-collision neighborhoods: propose verified schema/manifest fixes, accumulate cross-run evidence about which lever and mechanism work for which collision class.",
        defaultSubCommand: "list-levers",
        commands: {
            "list-levers": new CollisionOptimizeListLeversCommandHandler(),
            explore: new CollisionOptimizeExploreCommandHandler(),
            validate: new CollisionOptimizeValidateCommandHandler(),
            patterns: new CollisionOptimizePatternsCommandHandler(),
            run: new CollisionOptimizeRunCommandHandler(),
            distill: new CollisionOptimizeDistillCommandHandler(),
        },
    };
}
