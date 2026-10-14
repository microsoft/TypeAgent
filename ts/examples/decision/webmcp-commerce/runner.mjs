// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    bindAnswers,
    buildQuestions,
    classifyRequest,
    decisionState,
    looksMultiIntent,
} from "./bind.mjs";
import { execute, mutationCount } from "./execute.mjs";
import {
    assessGenOnlyProposal,
    GEN_ONLY_PROMPT,
    GEN_ONLY_SCHEMA,
    GENERATIVE_PLAN_PROMPT,
    GENERATIVE_PLAN_SCHEMA,
    plannerEvidence,
    validatePlan,
} from "./planner.mjs";

export async function runDecisionCase(item, client) {
    const blocked = preModelGate(item.request);
    if (blocked) return { ...blocked, lane: "decision" };
    if (looksMultiIntent(item.request)) {
        return closed("no_fit", "multi_intent_needs_plan", "decision");
    }
    if (!client) return closed("not_run", "offline-dry-run", "decision");
    return bindAndExecute(item.request, client, null);
}

export async function runHybridCase(item, clients) {
    const blocked = preModelGate(item.request);
    if (blocked) return { ...blocked, lane: "hybrid" };
    if (!clients?.generativeClient) {
        return closed("blocked", "generative-client-unavailable", "hybrid");
    }
    let plannerCalls = 0;
    let decisionCalls = 0;
    try {
        plannerCalls = 1;
        const generated = await clients.generativeClient.generate(
            GENERATIVE_PLAN_PROMPT,
            plannerEvidence(item.request),
            GENERATIVE_PLAN_SCHEMA,
        );
        const plan = validatePlan(item.request, generated?.value);
        if (!plan.ok) {
            return {
                ...closed("failed_closed", plan.reason, "hybrid"),
                plannerCalls,
                decisionCalls,
            };
        }
        const steps = [];
        for (const subtask of plan.subtasks) {
            const step = await bindAndExecute(
                item.request,
                clients.decisionClient,
                subtask.intent,
            );
            decisionCalls += step.decisionCalls;
            if (step.status !== "ok") {
                return {
                    ...step,
                    lane: "hybrid",
                    plannerCalls,
                    decisionCalls,
                    steps,
                    executed: steps.length > 0,
                    mutated: false,
                };
            }
            steps.push(step);
        }
        return {
            status: "ok",
            lane: "hybrid",
            plannerCalls,
            decisionCalls,
            steps,
            executed: true,
            mutated: mutationCount() !== 0,
        };
    } catch {
        return {
            ...closed("failed_closed", "planner_or_decision_failed", "hybrid"),
            plannerCalls,
            decisionCalls,
        };
    }
}

export async function runGenOnly(item, generativeClient) {
    if (!generativeClient) {
        return closed("blocked", "generative-client-unavailable", "gen-only");
    }
    const generated = await generativeClient.generate(
        GEN_ONLY_PROMPT,
        plannerEvidence(item.request),
        GEN_ONLY_SCHEMA,
    );
    const assessed = assessGenOnlyProposal(generated?.value);
    return {
        ...assessed,
        lane: "gen-only",
        plannerCalls: 1,
        decisionCalls: 0,
        mutated: false,
    };
}

function preModelGate(original) {
    const gate = classifyRequest(original);
    if (gate.status === "candidate") return null;
    return {
        ...closed(gate.status, gate.reason, "host"),
        modelCalls: 0,
        decisionCalls: 0,
        plannerCalls: 0,
    };
}

async function bindAndExecute(original, client, subtaskIntent) {
    if (!client) return closed("not_run", "offline-dry-run", "decision");
    let decisionCalls = 0;
    try {
        const built = buildQuestions(original);
        decisionCalls = 1;
        const response = await client.decide(
            decisionState(original, built.spans, subtaskIntent),
            built.questions,
        );
        const bound = bindAnswers(original, response, built.spans);
        if (bound.status !== "bound") {
            return {
                ...bound,
                decisionCalls,
                executed: false,
                mutated: false,
            };
        }
        const result = execute(
            bound.tool,
            bound.arguments,
            original,
            built.spans,
        );
        return { ...result, binding: bound, decisionCalls };
    } catch {
        return {
            ...closed("failed_closed", "decision_failed", "decision"),
            decisionCalls,
        };
    }
}

function closed(status, reason, lane) {
    return {
        status,
        reason,
        lane,
        executed: false,
        mutated: false,
        decisionCalls: 0,
        plannerCalls: 0,
    };
}
