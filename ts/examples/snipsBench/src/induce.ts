// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SnipsExample, tagsToSpans } from "./data.js";
import { SlotType } from "./grammar.js";

/**
 * Grammar induction by delexicalization.
 *
 * Each training utterance is turned into a *carrier-phrase template*: slot spans
 * become typed placeholders, non-slot tokens stay as literals. Frequent
 * templates become grammar alternatives. This is the data-driven analogue of
 * the hand-authored grammars — and the regime where the POS boundary signal
 * should matter more, because the only "anchors" are whatever carrier words the
 * data happened to contain.
 *
 *   "add sabrina salerno to my jazz"  (artist, playlist)
 *     →  add {artist} to my {playlist}
 *     →  add $(artist:NP) to my $(playlist:NP) -> {AddToPlaylist, {artist,playlist}}
 */

interface Template {
    /** Sequence of literal tokens and `{label}` placeholders. */
    parts: string[];
    /** Ordered slot labels (one per placeholder). */
    labels: string[];
}

const PLACEHOLDER = /^\{(.+)\}$/;
const SAFE_LITERAL = /^[a-z0-9]+$/; // carrier tokens are ~all alphanumeric

/** Delexicalize one example, or undefined if it can't be templated cleanly. */
export function delexicalize(e: SnipsExample): Template | undefined {
    const spans = tagsToSpans(e.tags).sort((a, b) => a.start - b.start);
    const byStart = new Map(spans.map((s) => [s.start, s]));
    const parts: string[] = [];
    const labels: string[] = [];
    let hasLiteral = false;
    let pos = 0;
    while (pos < e.tokens.length) {
        const span = byStart.get(pos);
        if (span) {
            parts.push(`{${span.label}}`);
            labels.push(span.label);
            pos = span.end;
        } else {
            const tok = e.tokens[pos].toLowerCase();
            if (!SAFE_LITERAL.test(tok)) return undefined; // skip exotic chars
            parts.push(tok);
            hasLiteral = true;
            pos++;
        }
    }
    if (!hasLiteral) return undefined; // pure-slot template matches everything
    if (labels.length === 0) return undefined; // no slots → useless rule
    if (new Set(labels).size !== labels.length) return undefined; // dup labels
    return { parts, labels };
}

export interface InducedGrammar {
    agr: string;
    numAlternatives: number;
    /** Fraction of training examples whose template was kept (≥ minFreq). */
    trainCoverage: number;
}

export interface InduceOptions {
    minFreq?: number; // keep templates seen ≥ this many times (default 2)
    topK?: number; // cap on alternatives per intent (default 400)
}

/**
 * Induce a grammar for one intent from its training examples. The placeholder
 * slot type `S` is the experiment arm (wildcard vs NP).
 */
export function induceGrammar(
    train: SnipsExample[],
    intent: string,
    S: SlotType,
    opts: InduceOptions = {},
): InducedGrammar {
    const minFreq = opts.minFreq ?? 2;
    const topK = opts.topK ?? 400;

    const subset = train.filter((e) => e.intent === intent);
    const counts = new Map<string, { tmpl: Template; n: number }>();
    for (const e of subset) {
        const t = delexicalize(e);
        if (!t) continue;
        const key = t.parts.join(" ");
        const entry = counts.get(key);
        if (entry) entry.n++;
        else counts.set(key, { tmpl: t, n: 1 });
    }

    const kept = [...counts.values()]
        .filter((c) => c.n >= minFreq)
        .sort((a, b) => b.n - a.n)
        .slice(0, topK);

    const coveredCount = kept.reduce((sum, c) => sum + c.n, 0);

    const alternatives = kept.map((c) =>
        templateToAlternative(c.tmpl, intent, S),
    );
    const agr = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

<Start> =
    ${alternatives.join("\n  | ")} ;
`;

    return {
        agr,
        numAlternatives: kept.length,
        trainCoverage: subset.length === 0 ? 0 : coveredCount / subset.length,
    };
}

/** Render one template as an `.agr` alternative with its action. */
function templateToAlternative(
    tmpl: Template,
    intent: string,
    S: SlotType,
): string {
    const pattern = tmpl.parts
        .map((p) => {
            const m = PLACEHOLDER.exec(p);
            return m ? `$(${m[1]}:${S})` : p;
        })
        .join(" ");
    const params = tmpl.labels.join(", ");
    return `${pattern} -> { actionName: "${intent}", parameters: { ${params} } }`;
}
