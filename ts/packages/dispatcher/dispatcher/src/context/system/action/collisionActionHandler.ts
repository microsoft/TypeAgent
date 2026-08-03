// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    ParsedCommandParams,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { CollisionAction } from "../schema/collisionActionSchema.js";

function csv(values: string[] | undefined): string | undefined {
    return values?.join(",");
}

/** Returns `{ [key]: value }` when value is defined, `{}` otherwise. */
function opt(value: unknown, key: string): Record<string, unknown> {
    return value !== undefined ? { [key]: value } : {};
}

type Executor = (
    commands: string[],
    params?: ParsedCommandParams<any>,
) => Promise<ActionResult | undefined>;

// ---------------------------------------------------------------------------
// Action-name groups used for dispatching in executeCollisionAction
// ---------------------------------------------------------------------------
const CORPUS_GEN_ACTIONS = new Set([
    "generateCollisionCorpus",
    "probeCollisionCorpus",
    "translateCollisionCorpus",
    "reanalyzeCollisionCorpus",
]);

const CORPUS_VIZ_ACTIONS = new Set([
    "visualizeCollisionCorpus",
    "runCollisionCorpusPipeline",
    "analyzeCollisionRecovery",
    "visualizeCollisionRecovery",
]);

const KEYWORDS_ACTIONS = new Set([
    "manageCollisionKeywords",
    "backfillCollisionKeywords",
    "buildCollisionNeighborhoods",
]);

const OPTIMIZE_CORE_ACTIONS = new Set([
    "listCollisionOptimizationLevers",
    "exploreCollisionOptimizations",
    "validateCollisionOptimizations",
    "mineCollisionOptimizationPatterns",
]);

const OPTIMIZE_PIPELINE_ACTIONS = new Set([
    "runCollisionOptimizationPipeline",
    "distillCollisionOptimizationPatterns",
    "browseCollisionOptimizationRuns",
]);

const PREFERENCES_ACTIONS = new Set([
    "listCollisionPreferences",
    "setCollisionPreference",
    "removeCollisionPreference",
    "clearCollisionPreferences",
]);

// ---------------------------------------------------------------------------
// Sub-handlers (one per logical action group)
// ---------------------------------------------------------------------------

function executeCollisionCorpusGenAction(
    actionName: string,
    p: any,
    execute: Executor,
): Promise<ActionResult | undefined> {
    switch (actionName) {
        case "generateCollisionCorpus":
            return execute(["corpus", "generate"], {
                args: {},
                flags: {
                    ...opt(csv(p.schemas), "schemas"),
                    ...opt(csv(p.models), "models"),
                    ...opt(csv(p.styles), "styles"),
                    concurrency: p.concurrency ?? 8,
                    ...opt(p.outputPath, "out"),
                    ...opt(p.workdir, "workdir"),
                },
            });
        case "probeCollisionCorpus":
            return execute(["corpus", "probe"], {
                args: {},
                flags: {
                    ...opt(p.inputPath, "in"),
                    ...opt(p.outputPath, "out"),
                    top: p.top ?? 5,
                    delta: p.delta ?? 0.05,
                    concurrency: p.concurrency ?? 8,
                    ...opt(p.workdir, "workdir"),
                },
            });
        case "translateCollisionCorpus":
            return execute(["corpus", "translate"], {
                args: {},
                flags: {
                    ...opt(p.inputPath, "in"),
                    ...opt(p.outputPath, "out"),
                    concurrency: p.concurrency ?? 4,
                    strategy: p.strategy ?? "first-match",
                    ...opt(p.maxPhrases, "max-phrases"),
                    ...opt(p.modelLabel, "model-label"),
                    "user-context-mode": p.userContextMode ?? "none",
                    ...opt(p.userContextJson, "user-context-json"),
                    ...opt(p.outputSuffix, "output-suffix"),
                    ...opt(p.workdir, "workdir"),
                },
            });
        case "reanalyzeCollisionCorpus":
            return execute(["corpus", "reanalyze"], {
                args: {},
                flags: {
                    ...opt(p.inputPath, "in"),
                    ...opt(p.outputPath, "out"),
                    delta: p.delta ?? 0.05,
                    ...opt(p.workdir, "workdir"),
                },
            });
        default:
            throw new Error(`Unknown corpus gen action: ${actionName}`);
    }
}

function executeCollisionCorpusVizAction(
    actionName: string,
    p: any,
    execute: Executor,
): Promise<ActionResult | undefined> {
    switch (actionName) {
        case "visualizeCollisionCorpus":
            return execute(["corpus", "visualize"], {
                args: {},
                flags: {
                    ...opt(p.inputPath, "in"),
                    ...opt(p.outputPath, "out"),
                    top: p.top ?? 60,
                    "similarity-strategy": p.similarityStrategy ?? "balanced",
                    "similarity-threshold": String(
                        p.similarityThreshold ?? 0.85,
                    ),
                    "no-similarity": p.noSimilarity ?? false,
                    ...opt(p.translatorPath, "translator"),
                    "no-translator": p.noTranslator ?? false,
                    ...opt(p.workdir, "workdir"),
                },
            });
        case "runCollisionCorpusPipeline":
            return execute(["corpus", "run"], {
                args: {},
                flags: {
                    from: p.from ?? "generate",
                    ...opt(p.workdir, "workdir"),
                    ...opt(csv(p.schemas), "schemas"),
                    ...opt(csv(p.models), "models"),
                    ...opt(csv(p.styles), "styles"),
                    concurrency: p.concurrency ?? 8,
                    delta: p.delta ?? 0.05,
                    top: p.top ?? 5,
                    "sankey-top": p.sankeyTop ?? 60,
                },
            });
        case "analyzeCollisionRecovery":
            return execute(["corpus", "recovery"], {
                args: {},
                flags: {
                    ...opt(p.inputPath, "in"),
                    ...opt(p.workdir, "workdir"),
                    delta: p.delta ?? 0.05,
                },
            });
        case "visualizeCollisionRecovery":
            return execute(["corpus", "visualize-recovery"], {
                args: {},
                flags: {
                    ...opt(p.inputPath, "in"),
                    ...opt(p.outputPath, "out"),
                    delta: p.delta ?? 0.05,
                    ...opt(p.workdir, "workdir"),
                },
            });
        default:
            throw new Error(`Unknown corpus viz action: ${actionName}`);
    }
}

function executeCollisionKeywordsAction(
    actionName: string,
    p: any,
    execute: Executor,
): Promise<ActionResult | undefined> {
    switch (actionName) {
        case "manageCollisionKeywords": {
            const operation =
                p.operation ?? (p.target === undefined ? "listOverrides" : "show");
            if (operation === "listOverrides") {
                return execute(["keywords"], { args: {}, flags: {} });
            }
            if (p.target === undefined) {
                throw new Error(
                    `A target is required to ${operation} collision keywords.`,
                );
            }
            return execute(["keywords"], {
                args: {
                    tokens: [p.target, operation, ...(p.keywords ?? [])],
                },
                flags: {},
            } as unknown as ParsedCommandParams<any>);
        }
        case "backfillCollisionKeywords":
            return execute(["keywords", "backfill"], {
                args: { ...opt(p.schemas, "schemas") },
                flags: {
                    llm: p.useLlm ?? false,
                    force: p.force ?? false,
                },
            } as unknown as ParsedCommandParams<any>);
        case "buildCollisionNeighborhoods":
            return execute(["neighborhoods"], {
                args: {},
                flags: {
                    ...opt(p.corpusPath, "corpus"),
                    "min-misroute": p.minMisroute ?? 2,
                    "include-same-schema": p.includeSameSchema ?? true,
                    "samples-per-category": p.samplesPerCategory ?? 5,
                    ...opt(p.outputPath, "out"),
                    ...opt(p.outputHtmlPath, "out-html"),
                    ...opt(p.workdir, "workdir"),
                },
            });
        default:
            throw new Error(`Unknown keywords action: ${actionName}`);
    }
}

function executeCollisionOptimizeCoreAction(
    actionName: string,
    p: any,
    execute: Executor,
): Promise<ActionResult | undefined> {
    switch (actionName) {
        case "listCollisionOptimizationLevers":
            return execute(["optimize", "list-levers"], {
                args: {},
                flags: {},
            });
        case "exploreCollisionOptimizations":
            return execute(["optimize", "explore"], {
                args: {},
                flags: {
                    ...opt(p.corpusPath, "corpus"),
                    ...opt(p.baselinePath, "baseline"),
                    top: p.top ?? 5,
                    "hypotheses-per-lever": p.hypothesesPerLever ?? 3,
                    depth: p.depth ?? 2,
                    ...opt(csv(p.levers), "lever"),
                    severity: csv(p.severities) ?? "blocker,leaky",
                    ...opt(p.workdir, "workdir"),
                    "dry-run": p.dryRun ?? false,
                    concurrency: p.concurrency ?? 8,
                },
            });
        case "validateCollisionOptimizations":
            return execute(["optimize", "validate"], {
                args: {},
                flags: {
                    ...opt(p.runId, "run"),
                    ...opt(p.neighborhoodId, "phrases"),
                    ...opt(p.baselinePath, "baseline"),
                    ...opt(p.workdir, "workdir"),
                    ...opt(csv(p.winners), "winners"),
                    ...opt(csv(p.leaveOneOut), "leave-one-out"),
                },
            });
        case "mineCollisionOptimizationPatterns":
            return execute(["optimize", "patterns"], {
                args: {},
                flags: {
                    ...opt(p.patternsFile, "patterns-file"),
                    "min-attempts": p.minAttempts ?? 5,
                    "surface-disagreement": String(p.surfaceDisagreement ?? 0.5),
                    ...opt(p.outputPath, "out"),
                    ...opt(p.outputHtmlPath, "out-html"),
                    ...opt(p.workdir, "workdir"),
                },
            });
        default:
            throw new Error(`Unknown optimize core action: ${actionName}`);
    }
}

function executeCollisionOptimizePipelineAction(
    actionName: string,
    p: any,
    execute: Executor,
): Promise<ActionResult | undefined> {
    switch (actionName) {
        case "runCollisionOptimizationPipeline":
            return execute(["optimize", "run"], {
                args: {},
                flags: {
                    from: p.from ?? "neighborhoods",
                    top: p.top ?? 5,
                    depth: p.depth ?? 2,
                    ...opt(csv(p.levers), "lever"),
                    severity: csv(p.severities) ?? "blocker,leaky",
                    "dry-run": p.dryRun ?? false,
                    "skip-distill": p.skipDistill ?? false,
                    "distill-min-attempts": p.distillMinAttempts ?? 10,
                    ...opt(p.workdir, "workdir"),
                },
            });
        case "distillCollisionOptimizationPatterns":
            return execute(["optimize", "distill"], {
                args: {},
                flags: {
                    "min-attempts": p.minAttempts ?? 10,
                    ...opt(p.workdir, "workdir"),
                },
            });
        case "browseCollisionOptimizationRuns":
            return execute(["optimize", "browse"], {
                args: {},
                flags: {
                    ...opt(p.runId, "run"),
                    all: p.all ?? false,
                    ...opt(p.workdir, "workdir"),
                },
            });
        default:
            throw new Error(`Unknown optimize pipeline action: ${actionName}`);
    }
}

function executeCollisionPreferencesAction(
    actionName: string,
    p: any,
    execute: Executor,
): Promise<ActionResult | undefined> {
    switch (actionName) {
        case "listCollisionPreferences":
            return execute(["preferences", "list"], { args: {}, flags: {} });
        case "setCollisionPreference":
            return execute(["preferences", "set"], {
                args: {
                    candidates: p.candidates.join(","),
                    chosen: p.chosen,
                },
                flags: {},
            });
        case "removeCollisionPreference":
            return execute(["preferences", "remove"], {
                args: { key: p.key },
                flags: {},
            });
        case "clearCollisionPreferences":
            return execute(["preferences", "clear"], { args: {}, flags: {} });
        default:
            throw new Error(`Unknown preferences action: ${actionName}`);
    }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export function executeCollisionAction(
    action: TypeAgentAction<CollisionAction, "system.collision">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
    commandExecutor: typeof executeCommandFromHandlers = executeCommandFromHandlers,
): Promise<ActionResult | undefined> {
    const execute: Executor = (commands, params) =>
        commandExecutor(handlers, commands, params, context);
    const p: any = "parameters" in action ? action.parameters : {};

    if (CORPUS_GEN_ACTIONS.has(action.actionName)) {
        return executeCollisionCorpusGenAction(action.actionName, p, execute);
    }
    if (CORPUS_VIZ_ACTIONS.has(action.actionName)) {
        return executeCollisionCorpusVizAction(action.actionName, p, execute);
    }
    if (KEYWORDS_ACTIONS.has(action.actionName)) {
        return executeCollisionKeywordsAction(action.actionName, p, execute);
    }
    if (OPTIMIZE_CORE_ACTIONS.has(action.actionName)) {
        return executeCollisionOptimizeCoreAction(action.actionName, p, execute);
    }
    if (OPTIMIZE_PIPELINE_ACTIONS.has(action.actionName)) {
        return executeCollisionOptimizePipelineAction(action.actionName, p, execute);
    }
    if (PREFERENCES_ACTIONS.has(action.actionName)) {
        return executeCollisionPreferencesAction(action.actionName, p, execute);
    }

    switch (action.actionName) {
        case "showCollisionEvents":
            return execute(["events"], {
                args: {},
                flags: {
                    limit: p.limit ?? 10,
                    ...opt(p.kind, "kind"),
                },
            });
        case "findSimilarActions":
            return execute(["similar"], {
                args: {},
                flags: {
                    threshold: p.threshold ?? 0.85,
                    strategy: p.strategy ?? "balanced",
                    "all-strategies": p.allStrategies ?? false,
                    pairs: p.pairs ?? false,
                    top: p.top ?? 50,
                    ...opt(p.jsonPath, "json"),
                    "no-cache": p.noCache ?? false,
                },
            });
        case "listCollisionStrategies":
            return execute(["list-strategies"], { args: {}, flags: {} });
        case "probeCollisionPhrase":
            return execute(["probe"], {
                args: { phrase: p.phrase },
                flags: {
                    top: p.top ?? 5,
                    ...opt(p.expected, "expected"),
                    delta: p.delta ?? 0.05,
                    "include-inactive": p.includeInactive ?? false,
                },
            });
        default:
            throw new Error(`Unknown collision action: ${action.actionName}`);
    }
}
