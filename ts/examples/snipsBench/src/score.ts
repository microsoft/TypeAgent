// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SnipsExample, SlotSpan, tagsToSpans } from "./data.js";

/** A model's prediction for one example: an intent and aligned BIO tags. */
export interface Prediction {
    intent: string;
    tags: string[];
}

export interface PRF {
    precision: number;
    recall: number;
    f1: number;
    numCorrect: number;
    numPred: number;
    numGold: number;
}

function prf(numCorrect: number, numPred: number, numGold: number): PRF {
    const precision = numPred === 0 ? 0 : numCorrect / numPred;
    const recall = numGold === 0 ? 0 : numCorrect / numGold;
    const f1 =
        precision + recall === 0
            ? 0
            : (2 * precision * recall) / (precision + recall);
    return { precision, recall, f1, numCorrect, numPred, numGold };
}

const spanKey = (s: SlotSpan) => `${s.label}:${s.start}:${s.end}`;

export interface SlotScore extends PRF {
    /** Micro-averaged per-label breakdown. */
    perLabel: Map<string, PRF>;
}

/**
 * CoNLL entity-level slot F1: a predicted span counts as correct iff a gold
 * span with the identical (label, start, end) exists. Micro-averaged over all
 * examples. This matches seqeval / conlleval semantics.
 */
export function scoreSlots(
    examples: SnipsExample[],
    preds: Prediction[],
): SlotScore {
    if (examples.length !== preds.length) {
        throw new Error(
            `example/prediction count mismatch (${examples.length} vs ${preds.length})`,
        );
    }
    let numCorrect = 0;
    let numPred = 0;
    let numGold = 0;
    const perLabel = new Map<
        string,
        { correct: number; pred: number; gold: number }
    >();
    const bump = (label: string, k: "correct" | "pred" | "gold") => {
        let e = perLabel.get(label);
        if (!e) {
            e = { correct: 0, pred: 0, gold: 0 };
            perLabel.set(label, e);
        }
        e[k]++;
    };

    for (let i = 0; i < examples.length; i++) {
        const gold = tagsToSpans(examples[i].tags);
        const pred = tagsToSpans(preds[i].tags);
        const goldKeys = new Set(gold.map(spanKey));

        numGold += gold.length;
        numPred += pred.length;
        for (const g of gold) bump(g.label, "gold");
        for (const p of pred) {
            bump(p.label, "pred");
            if (goldKeys.has(spanKey(p))) {
                numCorrect++;
                bump(p.label, "correct");
            }
        }
    }

    const perLabelPrf = new Map<string, PRF>();
    for (const [label, c] of perLabel) {
        perLabelPrf.set(label, prf(c.correct, c.pred, c.gold));
    }
    return { ...prf(numCorrect, numPred, numGold), perLabel: perLabelPrf };
}

/** Exact-match intent classification accuracy. */
export function scoreIntent(
    examples: SnipsExample[],
    preds: Prediction[],
): { accuracy: number; numCorrect: number; total: number } {
    let numCorrect = 0;
    for (let i = 0; i < examples.length; i++) {
        if (examples[i].intent === preds[i].intent) numCorrect++;
    }
    return {
        accuracy: examples.length === 0 ? 0 : numCorrect / examples.length,
        numCorrect,
        total: examples.length,
    };
}

const pct = (x: number) => (x * 100).toFixed(2);

/** Render a compact human-readable report. */
export function formatReport(
    title: string,
    examples: SnipsExample[],
    preds: Prediction[],
    opts: { perLabel?: boolean } = {},
): string {
    const intent = scoreIntent(examples, preds);
    const slots = scoreSlots(examples, preds);
    const lines: string[] = [];
    lines.push(`── ${title} ──`);
    lines.push(
        `  intent acc : ${pct(intent.accuracy)}%  (${intent.numCorrect}/${intent.total})`,
    );
    lines.push(
        `  slot   F1  : ${pct(slots.f1)}%  (P ${pct(slots.precision)} / R ${pct(slots.recall)}, ` +
            `correct ${slots.numCorrect}, pred ${slots.numPred}, gold ${slots.numGold})`,
    );
    if (opts.perLabel) {
        const rows = [...slots.perLabel.entries()].sort(
            (a, b) => a[1].f1 - b[1].f1,
        );
        for (const [label, p] of rows) {
            lines.push(
                `    ${label.padEnd(26)} F1 ${pct(p.f1).padStart(6)}  ` +
                    `(P ${pct(p.precision).padStart(6)} R ${pct(p.recall).padStart(6)}, gold ${p.numGold})`,
            );
        }
    }
    return lines.join("\n");
}
