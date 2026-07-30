// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Source-map style side-car for compiled grammars. Like a `.js.map`, it is
// emitted next to `<name>.ag.json` (as `<name>.ag.map.json`) and lets a host
// recover the original `.agr` source text of the rule that matched a request -
// without shipping/re-parsing the `.agr` source (the runtime only has the
// compiled grammar). The compiler already collects everything needed in a
// `DebugInfoCollector`; this module serializes it and reads it back.

import { DebugInfoCollector } from "./grammarCompiler.js";
import { Grammar } from "./grammarTypes.js";
import { matchGrammar } from "./grammarMatcher.js";
import { TraceEvent } from "./traceEvents.js";

export type GrammarRuleRange = {
    fileId: string;
    start: number;
    end: number;
};

export type GrammarSourceMap = {
    version: 1;
    // fileId (displayPath) -> original `.agr` source text.
    files: Record<string, string>;
    // ruleId -> its source span [start, end) in the owning file.
    rules: Record<string, GrammarRuleRange>;
    // partId -> owning ruleId, for parts that carry a source position (skips
    // synthetic/spanless parts introduced by optimization).
    parts: Record<number, string>;
};

// One phrase word/run and the category it maps to (the `<Rule>` a captured
// value references, e.g. "TrackPhrase"); empty category = literal keyword.
export type MatchedPhraseSegment = { text: string; category: string };

export type MatchedGrammarRule = {
    // The matched rule's `.agr` source text.
    text: string;
    // The request broken into colored segments matching the rule's markers.
    segments: MatchedPhraseSegment[];
};

/**
 * Build the side-car payload from the debug info the compiler collected. The
 * collector records each rule's start offset only, so a rule's end is taken as
 * the next rule's start in the same file (trailing whitespace is trimmed when
 * the text is later sliced).
 */
export function buildGrammarSourceMap(
    collector: DebugInfoCollector,
): GrammarSourceMap {
    const files: Record<string, string> = {};
    for (const [fileId, text] of collector.fileContents) {
        files[fileId] = text;
    }

    const startsByFile = new Map<
        string,
        { ruleId: string; offset: number }[]
    >();
    for (const [ruleId, pos] of collector.rulePositions) {
        const arr = startsByFile.get(pos.fileId) ?? [];
        arr.push({ ruleId, offset: pos.offset });
        startsByFile.set(pos.fileId, arr);
    }

    const rules: Record<string, GrammarRuleRange> = {};
    for (const [fileId, arr] of startsByFile) {
        arr.sort((a, b) => a.offset - b.offset);
        const fileLength = files[fileId]?.length ?? 0;
        for (let i = 0; i < arr.length; i++) {
            const end = i + 1 < arr.length ? arr[i + 1].offset : fileLength;
            rules[arr[i].ruleId] = { fileId, start: arr[i].offset, end };
        }
    }

    const parts: Record<number, string> = {};
    for (const [partId, ruleId] of collector.partRules) {
        if (collector.partPositions.has(partId)) {
            parts[partId] = ruleId;
        }
    }

    return { version: 1, files, rules, parts };
}

/**
 * Recover the matched rule's `.agr` source text plus the request broken into
 * per-category colored segments (so the phrase can be colored to match the
 * rule's markers). Runs the matcher once with a trace hook: the winning rule is
 * found by walking back the matched parts (preferring the rule that emits
 * `actionName`), and phrase segments are built from the captured values, each
 * colored by the `<Rule>` its capture references. Returns undefined when the
 * request doesn't match or the rule can't be pinpointed.
 */
export function findMatchedRule(
    sourceMap: GrammarSourceMap,
    grammar: Grammar,
    request: string,
    actionName?: string,
): MatchedGrammarRule | undefined {
    const events: TraceEvent[] = [];
    const results = matchGrammar(grammar, request, {
        trace: (event) => events.push(event),
    });
    if (results.length === 0) {
        return undefined;
    }
    const text = recoverRuleText(events, sourceMap, actionName);
    if (text === undefined) {
        return undefined;
    }
    return {
        text,
        segments: buildPhraseSegments(results[0]?.match, request, text),
    };
}

function recoverRuleText(
    events: TraceEvent[],
    sourceMap: GrammarSourceMap,
    actionName: string | undefined,
): string | undefined {
    let fallback: string | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.kind !== "partMatched") {
            continue;
        }
        const ruleId = sourceMap.parts[event.part];
        if (ruleId === undefined) {
            continue;
        }
        const range = sourceMap.rules[ruleId];
        const source = range && sourceMap.files[range.fileId];
        if (source === undefined) {
            continue;
        }
        const text = source.slice(range.start, range.end).trimEnd();
        if (actionName === undefined || emitsAction(text, actionName)) {
            return text;
        }
        // Remember the last matched part's rule in case no rule on the parse
        // explicitly emits the action (e.g. dispatched via a sub-rule).
        fallback ??= text;
    }
    return fallback;
}

function emitsAction(ruleText: string, actionName: string): boolean {
    return new RegExp(`actionName:\\s*"${escapeRegExp(actionName)}"`).test(
        ruleText,
    );
}

// Collect a matched action value's leaf string values with the parameter name
// each sits under, e.g. { target: { trackName: "x", artists: ["y"] } } ->
// [{ name: "trackName", value: "x" }, { name: "artists", value: "y" }].
function collectLeafValues(
    value: unknown,
    name: string,
    leaves: { name: string; value: string }[],
) {
    if (typeof value === "string") {
        leaves.push({ name, value });
    } else if (Array.isArray(value)) {
        for (const entry of value) collectLeafValues(entry, name, leaves);
    } else if (value !== null && typeof value === "object") {
        for (const [key, val] of Object.entries(value)) {
            collectLeafValues(val, key, leaves);
        }
    }
}

// Break `request` into colored segments: each captured value that references a
// `<Rule>` in the matched rule becomes a segment with that category; the rest
// are literal keywords. The capture variables come from the rule's `$(var:<Rule>)`
// markers and are linked to the matched action's leaf values by name (tolerating
// simple singular/plural, e.g. capture `artist` -> action param `artists`).
function buildPhraseSegments(
    matchValue: unknown,
    request: string,
    ruleText: string,
): MatchedPhraseSegment[] {
    const captureRe = /\$\(\s*(\w+)\s*:\s*<([^>]+)>/g;
    const varCategory = new Map<string, string>();
    let capture: RegExpExecArray | null;
    while ((capture = captureRe.exec(ruleText)) !== null) {
        if (!varCategory.has(capture[1])) {
            varCategory.set(capture[1], capture[2]);
        }
    }
    if (varCategory.size === 0) {
        return [];
    }

    const leaves: { name: string; value: string }[] = [];
    collectLeafValues(matchValue, "", leaves);

    const lower = request.toLowerCase();
    const spans: { start: number; end: number; category: string }[] = [];
    const usedValues = new Set<string>();
    for (const [variable, category] of varCategory) {
        const leaf = leaves.find(
            (candidate) =>
                !usedValues.has(candidate.value.toLowerCase()) &&
                (candidate.name === variable ||
                    candidate.name === `${variable}s` ||
                    `${candidate.name}s` === variable),
        );
        if (leaf === undefined) {
            continue;
        }
        const key = leaf.value.toLowerCase();
        const start = lower.indexOf(key);
        if (start === -1) {
            continue;
        }
        usedValues.add(key);
        spans.push({ start, end: start + leaf.value.length, category });
    }
    if (spans.length === 0) {
        return [];
    }
    spans.sort((a, b) => a.start - b.start);

    const segments: MatchedPhraseSegment[] = [];
    const pushLiteral = (text: string) => {
        const trimmed = text.trim();
        if (trimmed.length > 0) {
            segments.push({ text: trimmed, category: "" });
        }
    };
    let pos = 0;
    for (const span of spans) {
        if (span.start < pos) {
            continue; // overlapping capture; keep the earlier one
        }
        pushLiteral(request.slice(pos, span.start));
        segments.push({
            text: request.slice(span.start, span.end),
            category: span.category,
        });
        pos = span.end;
    }
    pushLiteral(request.slice(pos));
    return segments;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
