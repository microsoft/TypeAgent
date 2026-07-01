// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The contextSelector orchestrator (§11): adapts the grammar path's validated
// MatchResults into scorer candidates, runs the deterministic pipeline
// (signal -> keywords -> scorer -> decision), emits telemetry, and returns the
// winning match plus a UX affordance note — or undefined to abstain. Pure
// engine logic lives under ../context/contextSelector/; this file is the thin
// MatchResult-aware seam plus telemetry.

import { MatchResult } from "agent-cache";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import {
    CollisionCandidate,
    emitCollisionEvent,
} from "../context/collisionTelemetry.js";
import { getAppAgentName } from "./agentTranslators.js";
import {
    CandidateScore,
    ScorerCandidate,
    TfIdfScorer,
} from "../context/contextSelector/scorer.js";
import { decide } from "../context/contextSelector/decision.js";

// v1 scorer selection (§9). Stateless — a single instance is reused. This is the
// swap point for a future knowPro-entity / embedding scorer.
const scorer = new TfIdfScorer();

export type ContextSelectorResolution = {
    // The winning validated match to resolve to (avoids the downstream LLM).
    match: MatchResult;
    // Non-blocking UX affordance shown on a reroute (U-2, §11.2).
    note: string;
};

function primaryOf(match: MatchResult): {
    schemaName: string;
    actionName: string;
} {
    const first = match.match.actions[0]?.action;
    return {
        schemaName: first?.schemaName ?? "",
        actionName: first?.actionName ?? "",
    };
}

type Candidate = ScorerCandidate & { match: MatchResult };

function toTelemetryCandidates(scores: CandidateScore[]): CollisionCandidate[] {
    return scores.map((s) => ({
        schemaName: s.schemaName,
        actionName: s.actionName,
        score: s.score,
        matchedTokens: s.matched.map((m) => ({
            token: m.token,
            weight: m.contribution,
        })),
    }));
}

// Resolve a grammar-path collision by topical proximity, or abstain. Assumes the
// caller has already confirmed this is a collision and that
// `contextSelector.detect` is on.
export function resolveContextSelector(
    validated: MatchResult[],
    ctx: CommandHandlerContext,
    request: string,
): ContextSelectorResolution | undefined {
    const cfg = ctx.session.getConfig().collision;
    const startedAt = performance.now();

    // Distinct (schema, action) candidates, each keeping the first MatchResult
    // to resolve to. Effective keywords = derived floor + sidecar overrides.
    const byId = new Map<string, Candidate>();
    for (const match of validated) {
        const { schemaName, actionName } = primaryOf(match);
        if (schemaName === "" || actionName === "") {
            continue;
        }
        const id = `${schemaName}.${actionName}`;
        if (!byId.has(id)) {
            byId.set(id, {
                schemaName,
                actionName,
                keywords: ctx.contextSelectorKeywords.effective(
                    schemaName,
                    actionName,
                ),
                match,
            });
        }
    }
    const candidates = [...byId.values()];
    if (candidates.length < 2) {
        return undefined;
    }

    const covered = candidates.every((c) => c.keywords.size > 0);
    const contextVector = ctx.conversationSignal.getContextVector();
    const scores = scorer.score(contextVector, candidates);
    const decision = decide(scores, covered, {
        minUniqueTokens: cfg.contextSelector.minUniqueTokens,
        minMass: cfg.contextSelector.minMass,
        margin: cfg.contextSelector.margin,
    });

    const telemetryCandidates = toTelemetryCandidates(decision.ranked);
    const elapsedMs = performance.now() - startedAt;

    if (decision.kind === "abstain") {
        emitCollisionEvent(
            {
                kind: "grammarMatch",
                request,
                candidates: telemetryCandidates,
                classifier: cfg.grammarMatch.classifier,
                strategy: "context-weight",
                elapsedMs,
                note: `abstain:${decision.reason}`,
            },
            ctx,
        );
        return undefined;
    }

    const winner = decision.winner;
    const winning = byId.get(`${winner.schemaName}.${winner.actionName}`);
    if (winning === undefined) {
        // Defensive: winner id must be present. Treat as abstain rather than
        // resolving to the wrong match.
        return undefined;
    }
    const chosen: CollisionCandidate = {
        schemaName: winner.schemaName,
        actionName: winner.actionName,
        score: winner.score,
        matchedTokens: winner.matched.map((m) => ({
            token: m.token,
            weight: m.contribution,
        })),
    };
    emitCollisionEvent(
        {
            kind: "grammarMatch",
            request,
            candidates: telemetryCandidates,
            chosen,
            classifier: cfg.grammarMatch.classifier,
            strategy: "context-weight",
            elapsedMs,
            note: `resolve; matched ${winner.uniqueTokenCount} token(s), mass ${winner.score.toFixed(3)}`,
        },
        ctx,
    );

    const agentName = getAppAgentName(winner.schemaName);
    const topTokens = winner.matched
        .slice()
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 3)
        .map((m) => m.token);
    const topicSuffix =
        topTokens.length > 0 ? ` (${topTokens.join(", ")})` : "";
    return {
        match: winning.match,
        note: `↪ routed to ${agentName} — recent topic${topicSuffix}`,
    };
}
