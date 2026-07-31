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

export function executeCollisionAction(
    action: TypeAgentAction<CollisionAction, "system.collision">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
    commandExecutor: typeof executeCommandFromHandlers = executeCommandFromHandlers,
): Promise<ActionResult | undefined> {
    const execute = (commands: string[], params?: ParsedCommandParams<any>) =>
        commandExecutor(handlers, commands, params, context);
    const params: any = "parameters" in action ? action.parameters : undefined;

    switch (action.actionName) {
        case "showCollisionEvents":
            return execute(["events"], {
                args: {},
                flags: {
                    limit: params?.limit ?? 10,
                    ...(params?.kind === undefined
                        ? {}
                        : { kind: params.kind }),
                },
            });
        case "findSimilarActions":
            return execute(["similar"], {
                args: {},
                flags: {
                    threshold: params?.threshold ?? 0.85,
                    strategy: params?.strategy ?? "balanced",
                    "all-strategies": params?.allStrategies ?? false,
                    pairs: params?.pairs ?? false,
                    top: params?.top ?? 50,
                    ...(params?.jsonPath === undefined
                        ? {}
                        : { json: params.jsonPath }),
                    "no-cache": params?.noCache ?? false,
                },
            });
        case "listCollisionStrategies":
            return execute(["list-strategies"], { args: {}, flags: {} });
        case "probeCollisionPhrase":
            return execute(["probe"], {
                args: { phrase: params.phrase },
                flags: {
                    top: params.top ?? 5,
                    ...(params.expected === undefined
                        ? {}
                        : { expected: params.expected }),
                    delta: params.delta ?? 0.05,
                    "include-inactive": params.includeInactive ?? false,
                },
            });
        case "generateCollisionCorpus":
            return execute(["corpus", "generate"], {
                args: {},
                flags: {
                    ...(params?.schemas === undefined
                        ? {}
                        : { schemas: csv(params.schemas) }),
                    ...(params?.models === undefined
                        ? {}
                        : { models: csv(params.models) }),
                    ...(params?.styles === undefined
                        ? {}
                        : { styles: csv(params.styles) }),
                    concurrency: params?.concurrency ?? 8,
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "probeCollisionCorpus":
            return execute(["corpus", "probe"], {
                args: {},
                flags: {
                    ...(params?.inputPath === undefined
                        ? {}
                        : { in: params.inputPath }),
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    top: params?.top ?? 5,
                    delta: params?.delta ?? 0.05,
                    concurrency: params?.concurrency ?? 8,
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "translateCollisionCorpus":
            return execute(["corpus", "translate"], {
                args: {},
                flags: {
                    ...(params?.inputPath === undefined
                        ? {}
                        : { in: params.inputPath }),
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    concurrency: params?.concurrency ?? 4,
                    strategy: params?.strategy ?? "first-match",
                    ...(params?.maxPhrases === undefined
                        ? {}
                        : { "max-phrases": params.maxPhrases }),
                    ...(params?.modelLabel === undefined
                        ? {}
                        : { "model-label": params.modelLabel }),
                    "user-context-mode": params?.userContextMode ?? "none",
                    ...(params?.userContextJson === undefined
                        ? {}
                        : { "user-context-json": params.userContextJson }),
                    ...(params?.outputSuffix === undefined
                        ? {}
                        : { "output-suffix": params.outputSuffix }),
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "reanalyzeCollisionCorpus":
            return execute(["corpus", "reanalyze"], {
                args: {},
                flags: {
                    ...(params?.inputPath === undefined
                        ? {}
                        : { in: params.inputPath }),
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    delta: params?.delta ?? 0.05,
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "visualizeCollisionCorpus":
            return execute(["corpus", "visualize"], {
                args: {},
                flags: {
                    ...(params?.inputPath === undefined
                        ? {}
                        : { in: params.inputPath }),
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    top: params?.top ?? 60,
                    "similarity-strategy":
                        params?.similarityStrategy ?? "balanced",
                    "similarity-threshold": String(
                        params?.similarityThreshold ?? 0.85,
                    ),
                    "no-similarity": params?.noSimilarity ?? false,
                    ...(params?.translatorPath === undefined
                        ? {}
                        : { translator: params.translatorPath }),
                    "no-translator": params?.noTranslator ?? false,
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "runCollisionCorpusPipeline":
            return execute(["corpus", "run"], {
                args: {},
                flags: {
                    from: params?.from ?? "generate",
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                    ...(params?.schemas === undefined
                        ? {}
                        : { schemas: csv(params.schemas) }),
                    ...(params?.models === undefined
                        ? {}
                        : { models: csv(params.models) }),
                    ...(params?.styles === undefined
                        ? {}
                        : { styles: csv(params.styles) }),
                    concurrency: params?.concurrency ?? 8,
                    delta: params?.delta ?? 0.05,
                    top: params?.top ?? 5,
                    "sankey-top": params?.sankeyTop ?? 60,
                },
            });
        case "analyzeCollisionRecovery":
            return execute(["corpus", "recovery"], {
                args: {},
                flags: {
                    ...(params?.inputPath === undefined
                        ? {}
                        : { in: params.inputPath }),
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                    delta: params?.delta ?? 0.05,
                },
            });
        case "visualizeCollisionRecovery":
            return execute(["corpus", "visualize-recovery"], {
                args: {},
                flags: {
                    ...(params?.inputPath === undefined
                        ? {}
                        : { in: params.inputPath }),
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    delta: params?.delta ?? 0.05,
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "manageCollisionKeywords": {
            const operation =
                params?.operation ??
                (params?.target === undefined ? "listOverrides" : "show");
            if (operation === "listOverrides") {
                return execute(["keywords"], {
                    args: {},
                    flags: {},
                });
            }
            if (params?.target === undefined) {
                throw new Error(
                    `A target is required to ${operation} collision keywords.`,
                );
            }
            return execute(["keywords"], {
                args: {
                    tokens: [
                        params.target,
                        operation,
                        ...(params.keywords ?? []),
                    ],
                },
                flags: {},
            } as unknown as ParsedCommandParams<any>);
        }
        case "backfillCollisionKeywords":
            return execute(["keywords", "backfill"], {
                args: {
                    ...(params?.schemas === undefined
                        ? {}
                        : { schemas: params.schemas }),
                },
                flags: {
                    llm: params?.useLlm ?? false,
                    force: params?.force ?? false,
                },
            } as unknown as ParsedCommandParams<any>);
        case "buildCollisionNeighborhoods":
            return execute(["neighborhoods"], {
                args: {},
                flags: {
                    ...(params?.corpusPath === undefined
                        ? {}
                        : { corpus: params.corpusPath }),
                    "min-misroute": params?.minMisroute ?? 2,
                    "include-same-schema": params?.includeSameSchema ?? true,
                    "samples-per-category": params?.samplesPerCategory ?? 5,
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    ...(params?.outputHtmlPath === undefined
                        ? {}
                        : { "out-html": params.outputHtmlPath }),
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "listCollisionOptimizationLevers":
            return execute(["optimize", "list-levers"], {
                args: {},
                flags: {},
            });
        case "exploreCollisionOptimizations":
            return execute(["optimize", "explore"], {
                args: {},
                flags: {
                    ...(params?.corpusPath === undefined
                        ? {}
                        : { corpus: params.corpusPath }),
                    ...(params?.baselinePath === undefined
                        ? {}
                        : { baseline: params.baselinePath }),
                    top: params?.top ?? 5,
                    "hypotheses-per-lever": params?.hypothesesPerLever ?? 3,
                    depth: params?.depth ?? 2,
                    ...(params?.levers === undefined
                        ? {}
                        : { lever: csv(params.levers) }),
                    severity: csv(params?.severities) ?? "blocker,leaky",
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                    "dry-run": params?.dryRun ?? false,
                    concurrency: params?.concurrency ?? 8,
                },
            });
        case "validateCollisionOptimizations":
            return execute(["optimize", "validate"], {
                args: {},
                flags: {
                    ...(params?.runId === undefined
                        ? {}
                        : { run: params.runId }),
                    ...(params?.neighborhoodId === undefined
                        ? {}
                        : { phrases: params.neighborhoodId }),
                    ...(params?.baselinePath === undefined
                        ? {}
                        : { baseline: params.baselinePath }),
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                    ...(params?.winners === undefined
                        ? {}
                        : { winners: csv(params.winners) }),
                    ...(params?.leaveOneOut === undefined
                        ? {}
                        : { "leave-one-out": csv(params.leaveOneOut) }),
                },
            });
        case "mineCollisionOptimizationPatterns":
            return execute(["optimize", "patterns"], {
                args: {},
                flags: {
                    ...(params?.patternsFile === undefined
                        ? {}
                        : { "patterns-file": params.patternsFile }),
                    "min-attempts": params?.minAttempts ?? 5,
                    "surface-disagreement": String(
                        params?.surfaceDisagreement ?? 0.5,
                    ),
                    ...(params?.outputPath === undefined
                        ? {}
                        : { out: params.outputPath }),
                    ...(params?.outputHtmlPath === undefined
                        ? {}
                        : { "out-html": params.outputHtmlPath }),
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "runCollisionOptimizationPipeline":
            return execute(["optimize", "run"], {
                args: {},
                flags: {
                    from: params?.from ?? "neighborhoods",
                    top: params?.top ?? 5,
                    depth: params?.depth ?? 2,
                    ...(params?.levers === undefined
                        ? {}
                        : { lever: csv(params.levers) }),
                    severity: csv(params?.severities) ?? "blocker,leaky",
                    "dry-run": params?.dryRun ?? false,
                    "skip-distill": params?.skipDistill ?? false,
                    "distill-min-attempts": params?.distillMinAttempts ?? 10,
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "distillCollisionOptimizationPatterns":
            return execute(["optimize", "distill"], {
                args: {},
                flags: {
                    "min-attempts": params?.minAttempts ?? 10,
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "browseCollisionOptimizationRuns":
            return execute(["optimize", "browse"], {
                args: {},
                flags: {
                    ...(params?.runId === undefined
                        ? {}
                        : { run: params.runId }),
                    all: params?.all ?? false,
                    ...(params?.workdir === undefined
                        ? {}
                        : { workdir: params.workdir }),
                },
            });
        case "listCollisionPreferences":
            return execute(["preferences", "list"], {
                args: {},
                flags: {},
            });
        case "setCollisionPreference":
            return execute(["preferences", "set"], {
                args: {
                    candidates: params.candidates.join(","),
                    chosen: params.chosen,
                },
                flags: {},
            });
        case "removeCollisionPreference":
            return execute(["preferences", "remove"], {
                args: { key: params.key },
                flags: {},
            });
        case "clearCollisionPreferences":
            return execute(["preferences", "clear"], {
                args: {},
                flags: {},
            });
    }
}
