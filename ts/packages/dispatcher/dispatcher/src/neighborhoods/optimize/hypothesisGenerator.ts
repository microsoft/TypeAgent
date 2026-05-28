// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Iterate over a chosen set of registered levers, call each lever's
// `proposeHypotheses(caseDesc, priorAttempts, ctx)`, concatenate. Re-tag
// each lever's hypothesis IDs so they're globally unique within a case
// (the orchestrator prefixes `-rN` at depth N > 0).
//
// Lever ordering is stable: alphabetical, matching `listLevers()`. The
// case loop ranks attempts by score regardless of order, but stable
// ordering makes attempt directories deterministic across runs (useful
// for diffing two attempts archives produced by the same corpus).

import type { AttemptRecord, CaseDescription, Hypothesis } from "./types.js";
import {
    listLevers,
    type LeverPlugin,
    type ProposeContext,
} from "./registry.js";

export interface GenerateHypothesesOpts {
    caseDesc: CaseDescription;
    priorAttempts: AttemptRecord[];
    /** When set, only run levers in this list. Names not in the registry
     *  are silently dropped (the orchestrator surfaces a warning before
     *  calling). When undefined, all registered levers are used. */
    leverFilter?: string[];
    /** Per-attempt context handed to each lever. */
    ctx: ProposeContext;
    /** Sequence number offset for hypothesis IDs. The case loop uses 0 at
     *  depth 0, then increments by the prior round's hypothesis count for
     *  depth N+1 so IDs are unique across rounds. Each hypothesis gets
     *  `h${(offset+i+1).pad(2)}-${leverName}` (plus `-rN` suffix at the
     *  case-loop level). */
    idOffset?: number;
}

/**
 * Generate hypotheses by calling every (filtered) lever's
 * `proposeHypotheses`. Levers are called sequentially — concurrency
 * happens within each lever (via `ctx.pmap`), not across levers, so
 * different levers don't compete for LLM rate limits unnecessarily.
 */
export async function generateHypotheses(
    opts: GenerateHypothesesOpts,
): Promise<Hypothesis[]> {
    const levers = selectLevers(opts.leverFilter);
    const offset = opts.idOffset ?? 0;
    const out: Hypothesis[] = [];

    for (const lever of levers) {
        const proposed = await lever.proposeHypotheses(
            opts.caseDesc,
            opts.priorAttempts,
            opts.ctx,
        );
        for (const h of proposed) {
            // Levers MAY return IDs (typically of the form
            // `h01-${name}`); we replace with a globally-unique sequence
            // tag so the orchestrator's attempt dir names stay collision-
            // free even if a lever returns duplicate IDs across calls.
            const seq = offset + out.length + 1;
            const renumbered: Hypothesis = {
                ...h,
                id: `h${String(seq).padStart(2, "0")}-${lever.name}`,
            };
            out.push(renumbered);
        }
    }

    return out;
}

/** Resolve names → LeverPlugin[]. Drops names not in the registry; the
 *  orchestrator warns about unknown names BEFORE calling this. Exported
 *  for unit tests. */
export function selectLevers(filter?: string[]): LeverPlugin[] {
    if (!filter || filter.length === 0) {
        return listLevers();
    }
    const set = new Set(filter);
    return listLevers().filter((l) => set.has(l.name));
}
