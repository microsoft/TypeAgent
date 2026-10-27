// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseViewDraftCapability } from "./viewBuildValidation.js";
import type { FileMemoryServiceOptions } from "./fileMemoryService.js";
import {
    resolveTopicDecisionExecution,
    type TopicDecisionExecutionOptions,
} from "./topicDecision.js";

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
> {
    const execution = configuredDecisionExecution(environment);
    return {
        ...(execution ? { decisionTopicExecution: execution } : {}),
        viewDrafts: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_VIEW_DRAFTS,
        ),
        informationalViews: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS,
            "TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS",
        ),
        ...(environment.TYPEAGENT_MEMORY_DECISION_TOPICS !== undefined
            ? {
                  decisionTopics: parseViewDraftCapability(
                      environment.TYPEAGENT_MEMORY_DECISION_TOPICS,
                      "TYPEAGENT_MEMORY_DECISION_TOPICS",
                  ),
              }
            : {}),
    };
}
