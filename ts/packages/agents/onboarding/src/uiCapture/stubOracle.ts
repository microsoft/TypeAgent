// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DecisionInput,
    DecisionOracle,
    ExploreDecision,
} from "./exploreTypes.js";

/**
 * Deterministic test oracle. Picks the first non-destructive frontier item,
 * preferring `invoke` and `select` verbs. Stops when the frontier is empty
 * or when a maxDecisions cap is hit.
 *
 * Useful for proving the loop mechanics without LLM calls. Slice 6b replaces
 * this with a typechat-backed oracle.
 */
export class StubOracle implements DecisionOracle {
    private decisions = 0;

    constructor(
        private readonly opts: { maxDecisions?: number; preferVerbs?: string[] } = {},
    ) {}

    async decide(input: DecisionInput): Promise<ExploreDecision> {
        const cap = this.opts.maxDecisions ?? 5;
        if (this.decisions >= cap) {
            return { kind: "stop", reason: `stub-cap (${cap})` };
        }
        const preferred = this.opts.preferVerbs ?? ["invoke", "select"];
        const isWindowMgmt = (f: { name?: string; automationId?: string }) =>
            /(?:Close|Minimize|Maximize|Restore)\b/i.test(
                `${f.name ?? ""} ${f.automationId ?? ""}`,
            );
        const candidates = input.frontier.filter(
            (f) => !f.destructiveHint && !isWindowMgmt(f),
        );
        const pick =
            candidates.find((f) =>
                f.verbs.some((v) => preferred.includes(v.verb)),
            ) ?? candidates[0];
        if (!pick) {
            return { kind: "stop", reason: "no candidates in frontier" };
        }
        const verb =
            pick.verbs.find((v) => preferred.includes(v.verb))?.verb ??
            pick.verbs[0]!.verb;
        this.decisions++;
        return {
            kind: "act",
            frontierId: pick.id,
            verb,
            expectedDelta: `(stub) ${verb} on ${pick.controlType} '${pick.name ?? pick.automationId ?? ""}'`,
            rationale: `stub-oracle pick #${this.decisions}: ${verb} ${pick.id}`,
        };
    }
}
