// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DecorationRangeBehavior,
    MarkdownString,
    Range,
    TextEditor,
    TextEditorDecorationType,
    window,
} from "vscode";
import type {
    CoverageReport,
    RuleCoverage,
    PartCoverage,
} from "grammar-tools-core";

// Decoration types for hit / zero-hit ranges
let hitDecoration: TextEditorDecorationType | undefined;
let zeroDecoration: TextEditorDecorationType | undefined;

function ensureDecorationTypes(): {
    hit: TextEditorDecorationType;
    zero: TextEditorDecorationType;
} {
    if (!hitDecoration) {
        hitDecoration = window.createTextEditorDecorationType({
            rangeBehavior: DecorationRangeBehavior.ClosedClosed,
            backgroundColor: "rgba(78, 201, 176, 0.12)",
            overviewRulerColor: "#4ec9b0",
            overviewRulerLane: 1, // Left
        });
    }
    if (!zeroDecoration) {
        zeroDecoration = window.createTextEditorDecorationType({
            rangeBehavior: DecorationRangeBehavior.ClosedClosed,
            backgroundColor: "rgba(244, 135, 113, 0.12)",
            overviewRulerColor: "#f48771",
            overviewRulerLane: 1,
        });
    }
    return { hit: hitDecoration, zero: zeroDecoration };
}

function toRange(loc: {
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}): Range {
    return new Range(
        loc.range.start.line,
        loc.range.start.character,
        loc.range.end.line,
        loc.range.end.character,
    );
}

function hitsMessage(hits: number, kind: string, id: string): MarkdownString {
    const md = new MarkdownString();
    if (hits === 0) {
        md.appendMarkdown(`**${kind} \`${id}\`**: no hits`);
    } else {
        md.appendMarkdown(
            `**${kind} \`${id}\`**: ${hits} hit${hits !== 1 ? "s" : ""}`,
        );
    }
    return md;
}

/**
 * Apply coverage decorations to the given editor using the report.
 * Rules and parts with hits > 0 get a green background; zero-hit
 * ranges get red.
 */
export function applyCoverageDecorations(
    editor: TextEditor,
    report: CoverageReport,
): void {
    const types = ensureDecorationTypes();

    const hitRanges: { range: Range; hoverMessage: MarkdownString }[] = [];
    const zeroRanges: { range: Range; hoverMessage: MarkdownString }[] = [];

    for (const rule of report.perRule) {
        addEntry(rule.hits, "Rule", rule.id, rule, hitRanges, zeroRanges);
        for (const part of rule.parts) {
            addEntry(
                part.hits,
                "Part",
                `${rule.id}[${part.id}]`,
                part,
                hitRanges,
                zeroRanges,
            );
        }
    }

    editor.setDecorations(types.hit, hitRanges);
    editor.setDecorations(types.zero, zeroRanges);
}

function addEntry(
    hits: number,
    kind: string,
    id: string,
    entry: RuleCoverage | PartCoverage,
    hitRanges: { range: Range; hoverMessage: MarkdownString }[],
    zeroRanges: { range: Range; hoverMessage: MarkdownString }[],
): void {
    if (!entry.location) return;
    const range = toRange(entry.location);
    const hover = hitsMessage(hits, kind, id);
    if (hits > 0) {
        hitRanges.push({ range, hoverMessage: hover });
    } else {
        zeroRanges.push({ range, hoverMessage: hover });
    }
}

/**
 * Clear all coverage decorations from the given editor.
 */
export function clearCoverageDecorations(editor: TextEditor): void {
    if (hitDecoration) editor.setDecorations(hitDecoration, []);
    if (zeroDecoration) editor.setDecorations(zeroDecoration, []);
}

/**
 * Dispose the decoration types (call on extension deactivation).
 */
export function disposeCoverageDecorations(): void {
    hitDecoration?.dispose();
    zeroDecoration?.dispose();
    hitDecoration = undefined;
    zeroDecoration = undefined;
}
