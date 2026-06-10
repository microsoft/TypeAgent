// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Static detection of `api.callAction("schema", "action", …)` sites whose
// (schema, action) pair isn't in an ActionRegistry. The single biggest
// signal-per-line for repair-loop quality: catching invented action names
// (e.g. `setRangeItalic` when the real call is `setFont` with italic:true)
// at validation time, before the broken script is persisted and surfaces
// at runtime as an opaque "argument is invalid" error.
//
// Suggestions are ranked by:
//   1. Curated aliases (highest signal — caller-provided lowercase key →
//      candidate action names; only fire when the candidate exists in the
//      same schema's action set).
//   2. Substring / Levenshtein distance among the schema's actions.
//
// Suggestions for an unknown SCHEMA (vs unknown action within a known
// schema) are Levenshtein-only on the schema name.

import type { ActionRegistry } from "./actionCatalog.js";

export interface UnknownActionCall {
    schemaName: string;
    actionName: string;
    /** 1-based line number where the offending call appears. */
    line: number;
    /** Closest-named alternatives (up to `maxSuggestions`, default 3). */
    suggestions: string[];
}

export interface FindUnknownActionsOptions {
    // Schema names whose actions aren't known at validation time (resolved
    // against runtime state — e.g. a flow store). Calls into these schemas
    // are skipped, not reported.
    dynamicSchemas?: ReadonlySet<string>;
    // Curated aliases: lowercase key (the LLM's invented name, lower-cased)
    // → candidate action names. Only candidates that exist in the same
    // schema's action set are surfaced. Use this to handle hallucinations
    // that pure fuzzy matching won't catch (e.g. `setRangeItalic` →
    // `setFont`, too many edits for Levenshtein to connect).
    aliases?: Record<string, string[]>;
    // Cap on number of suggestions per finding. Default 3.
    maxSuggestions?: number;
}

// Scan `script` for literal `api.callAction("schema", "action", …)` calls
// whose (schema, action) pair isn't in `registry`. Non-literal args
// (template literals, variables) are skipped. Returns one finding per
// unique (schema, action) pair, anchored at the first call site so the
// repair loop sees a stable line number.
export function findUnknownActionCalls(
    script: string,
    registry: ActionRegistry,
    options?: FindUnknownActionsOptions,
): UnknownActionCall[] {
    const dynamic = options?.dynamicSchemas ?? new Set<string>();
    const aliases = options?.aliases ?? {};
    const maxSuggestions = options?.maxSuggestions ?? 3;

    const findings = new Map<string, UnknownActionCall>();

    // api.callAction("schema", "action", … — matched-quote, no template literals.
    const callRe =
        /api\s*\.\s*callAction\s*\(\s*(['"])([^'"\r\n]+)\1\s*,\s*(['"])([^'"\r\n]+)\3/g;

    const lines = script.split("\n");
    let match: RegExpExecArray | null;
    while ((match = callRe.exec(script)) !== null) {
        const schemaName = match[2];
        const actionName = match[4];

        if (dynamic.has(schemaName)) continue;

        if (!registry.hasSchema(schemaName)) {
            const key = `${schemaName}::${actionName}`;
            if (findings.has(key)) continue;
            findings.set(key, {
                schemaName,
                actionName,
                line: lineNumberOfOffset(script, match.index, lines),
                suggestions: suggestSimilarSchemas(
                    schemaName,
                    registry.listSchemas(),
                    maxSuggestions,
                ),
            });
            continue;
        }
        if (registry.hasAction(schemaName, actionName)) continue;

        const key = `${schemaName}::${actionName}`;
        if (findings.has(key)) continue;
        findings.set(key, {
            schemaName,
            actionName,
            line: lineNumberOfOffset(script, match.index, lines),
            suggestions: closestActions(
                actionName,
                registry.listActions(schemaName),
                aliases,
                maxSuggestions,
            ),
        });
    }

    return Array.from(findings.values());
}

// Render an UnknownActionCall as a `Line N: …` error with a "Did you mean"
// trailer when we found close matches.
export function formatUnknownActionError(u: UnknownActionCall): string {
    const target = `${u.schemaName}.${u.actionName}`;
    const hint =
        u.suggestions.length > 0
            ? ` Did you mean: ${u.suggestions.map((s) => `'${s}'`).join(", ")}?`
            : "";
    return (
        `Line ${u.line}: Unknown action '${target}' — ` +
        `the schema/action pair is not in the action catalog.${hint}`
    );
}

function lineNumberOfOffset(
    script: string,
    offset: number,
    lines: string[],
): number {
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineLen = lines[i].length + 1;
        if (offset < charCount + lineLen) return i + 1;
        charCount += lineLen;
    }
    return Math.max(1, lines.length);
}

function suggestSimilarSchemas(
    target: string,
    schemas: readonly string[],
    maxSuggestions: number,
): string[] {
    return schemas
        .map((s) => ({ s, d: levenshtein(target, s) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, maxSuggestions)
        .filter((x) => x.d <= Math.max(3, Math.floor(target.length / 2)))
        .map((x) => x.s);
}

// Closest actions in a schema's action set, by (aliases first, then
// substring containment + Levenshtein). Deduped, capped at maxSuggestions.
export function closestActions(
    target: string,
    actions: readonly string[],
    aliases: Record<string, string[]> = {},
    maxSuggestions: number = 3,
): string[] {
    const lowered = target.toLowerCase();
    const actionSet = new Set(actions);

    const aliasMatches = (aliases[lowered] ?? []).filter((a) =>
        actionSet.has(a),
    );

    const fuzzy = actions
        .map((a) => ({
            a,
            d: levenshtein(lowered, a.toLowerCase()),
            substr:
                a.toLowerCase().includes(lowered) ||
                lowered.includes(a.toLowerCase()),
        }))
        .sort((x, y) => {
            if (x.substr !== y.substr) return x.substr ? -1 : 1;
            return x.d - y.d;
        })
        .filter(
            (x) =>
                x.substr || x.d <= Math.max(3, Math.floor(target.length / 2)),
        )
        .map((x) => x.a);

    // Aliases first (highest signal), then fuzzy matches, deduped.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of [...aliasMatches, ...fuzzy]) {
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
        if (out.length >= maxSuggestions) break;
    }
    return out;
}

// Iterative two-row Levenshtein distance.
export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prev = new Array(b.length + 1);
    let curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                curr[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + cost,
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}
