// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseViewDraftCapability,
    resolveTopicBuildTimeout,
} from "./viewBuildValidation.js";
import { resolveMaintenanceConcurrency } from "./maintenanceConcurrency.js";
import type { FileMemoryServiceOptions } from "./fileMemoryService.js";
import {
    validateTopicCurationSettings,
    type TopicCurationSettings,
} from "./topicCuration.js";
import {
    resolveTopicDecisionExecution,
    type TopicDecisionExecutionOptions,
} from "./topicDecision.js";

function curationSettings(
    environment: Readonly<Record<string, string | undefined>>,
): TopicCurationSettings | undefined {
    function numeric(name: string): number | undefined {
        const raw = environment[name];
        if (raw === undefined) return undefined;
        if (!raw.trim() || !Number.isFinite(Number(raw)))
            throw new Error(`Invalid ${name}`);
        return Number(raw);
    }
    const inputTokenTarget = numeric("TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS");
    const concurrency = numeric("TYPEAGENT_MEMORY_TOPIC_CONCURRENCY");
    const priorContextFraction = numeric(
        "TYPEAGENT_MEMORY_TOPIC_PRIOR_FRACTION",
    );
    if (
        inputTokenTarget === undefined &&
        concurrency === undefined &&
        priorContextFraction === undefined
    )
        return undefined;
    if (concurrency !== undefined && concurrency !== 1 && concurrency !== 2)
        throw new Error("Invalid TYPEAGENT_MEMORY_TOPIC_CONCURRENCY");
    const settings: TopicCurationSettings = {
        ...(inputTokenTarget !== undefined ? { inputTokenTarget } : {}),
        ...(concurrency !== undefined ? { concurrency } : {}),
        ...(priorContextFraction !== undefined ? { priorContextFraction } : {}),
    };
    validateTopicCurationSettings(settings);
    return settings;
}

function configuredDecisionExecution(
    environment: Readonly<Record<string, string | undefined>>,
) {
    const options: TopicDecisionExecutionOptions = {};
    const fields = [
        ["concurrency", "TYPEAGENT_MEMORY_DECISION_CONCURRENCY"],
        ["lookahead", "TYPEAGENT_MEMORY_DECISION_LOOKAHEAD"],
        ["maxQuestions", "TYPEAGENT_MEMORY_DECISION_MAX_QUESTIONS"],
    ] as const;
    for (const [field, name] of fields)
        if (environment[name] !== undefined)
            options[field] = Number(environment[name]);
    const batch = environment.TYPEAGENT_MEMORY_DECISION_BATCH_SIZE;
    if (batch !== undefined)
        options.batchSize = batch === "context" ? batch : Number(batch);
    if (environment.TYPEAGENT_MEMORY_DECISION_FULL_TRANSACTIONS !== undefined)
        options.fullTransactions = parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_DECISION_FULL_TRANSACTIONS,
            "TYPEAGENT_MEMORY_DECISION_FULL_TRANSACTIONS",
        );
    if (environment.TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION !== undefined)
        options.clusterValidation = parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION,
            "TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION",
        );
    if (!Object.keys(options).length) return undefined;
    return resolveTopicDecisionExecution(options);
}

export function getConfiguredMemoryViewOptions(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): Pick<
    FileMemoryServiceOptions,
    | "viewDrafts"
    | "informationalViews"
    | "decisionTopics"
    | "decisionTopicExecution"
    | "topicCuration"
    | "understanding"
    | "topicBuildTimeoutMs"
    | "maintenanceConcurrency"
    | "maintenanceShortBuildReservation"
    | "maintenanceShortBuildPriority"
    | "wikiAssessmentConcurrency"
> {
    const wikiAssessmentConcurrency =
        environment.TYPEAGENT_MEMORY_WIKI_ASSESSMENT_CONCURRENCY;
    if (
        wikiAssessmentConcurrency !== undefined &&
        (!Number.isSafeInteger(Number(wikiAssessmentConcurrency)) ||
            Number(wikiAssessmentConcurrency) < 1 ||
            Number(wikiAssessmentConcurrency) > 4)
    )
        throw new Error("Invalid TYPEAGENT_MEMORY_WIKI_ASSESSMENT_CONCURRENCY");
    const execution = configuredDecisionExecution(environment);
    const topicCuration = curationSettings(environment);
    const decisionTopics =
        environment.TYPEAGENT_MEMORY_DECISION_TOPICS === undefined
            ? undefined
            : parseViewDraftCapability(
                  environment.TYPEAGENT_MEMORY_DECISION_TOPICS,
                  "TYPEAGENT_MEMORY_DECISION_TOPICS",
              );
    if (decisionTopics && topicCuration)
        throw new Error(
            "Generative topic settings cannot configure Decision topics",
        );
    return {
        ...(environment.TYPEAGENT_MEMORY_UNDERSTANDING !== undefined
            ? {
                  understanding: parseViewDraftCapability(
                      environment.TYPEAGENT_MEMORY_UNDERSTANDING,
                      "TYPEAGENT_MEMORY_UNDERSTANDING",
                  ),
              }
            : {}),
        ...(environment.TYPEAGENT_MEMORY_SHORT_BUILD_PRIORITY === undefined
            ? {}
            : {
                  maintenanceShortBuildPriority: parseViewDraftCapability(
                      environment.TYPEAGENT_MEMORY_SHORT_BUILD_PRIORITY,
                      "TYPEAGENT_MEMORY_SHORT_BUILD_PRIORITY",
                  ),
              }),
        ...(wikiAssessmentConcurrency === undefined
            ? {}
            : { wikiAssessmentConcurrency: Number(wikiAssessmentConcurrency) }),
        ...(environment.TYPEAGENT_MEMORY_SHORT_BUILD_RESERVATION === undefined
            ? {}
            : {
                  maintenanceShortBuildReservation: parseViewDraftCapability(
                      environment.TYPEAGENT_MEMORY_SHORT_BUILD_RESERVATION,
                      "TYPEAGENT_MEMORY_SHORT_BUILD_RESERVATION",
                  ),
              }),
        ...(environment.TYPEAGENT_MEMORY_VIEW_BUILD_CONCURRENCY === undefined &&
        environment.TYPEAGENT_MEMORY_MAINTENANCE_MODEL_CONCURRENCY === undefined
            ? {}
            : {
                  maintenanceConcurrency: resolveMaintenanceConcurrency({
                      ...(environment.TYPEAGENT_MEMORY_VIEW_BUILD_CONCURRENCY ===
                      undefined
                          ? {}
                          : {
                                builds: Number(
                                    environment.TYPEAGENT_MEMORY_VIEW_BUILD_CONCURRENCY,
                                ),
                            }),
                      ...(environment.TYPEAGENT_MEMORY_MAINTENANCE_MODEL_CONCURRENCY ===
                      undefined
                          ? {}
                          : {
                                modelRequests: Number(
                                    environment.TYPEAGENT_MEMORY_MAINTENANCE_MODEL_CONCURRENCY,
                                ),
                            }),
                  }),
              }),
        ...(environment.TYPEAGENT_MEMORY_TOPIC_BUILD_TIMEOUT_MS === undefined
            ? {}
            : {
                  topicBuildTimeoutMs: resolveTopicBuildTimeout(
                      Number(
                          environment.TYPEAGENT_MEMORY_TOPIC_BUILD_TIMEOUT_MS,
                      ),
                  ),
              }),
        ...(execution ? { decisionTopicExecution: execution } : {}),
        ...(topicCuration ? { topicCuration } : {}),
        viewDrafts: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_VIEW_DRAFTS,
        ),
        informationalViews: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS,
            "TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS",
        ),
        ...(decisionTopics !== undefined ? { decisionTopics } : {}),
    };
}
