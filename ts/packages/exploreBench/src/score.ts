// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type {
    SwebenchCitation,
    SwebenchMetricScore,
    SwebenchScore,
} from "./types.js";

const fileTypes = [
    ".py",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".go",
    ".java",
    ".js",
    ".ts",
    ".tsx",
    ".php",
    ".rb",
    ".rs",
];

interface PatchEdit {
    path: string;
    startLine: number;
    endLine: number;
}

interface LineInterval {
    startLine: number;
    endLine: number;
}

export function scoreSwebench(
    finalAnswer: string,
    patch: string,
    workspace?: string,
): SwebenchScore {
    const parsed = parseFinalAnswer(finalAnswer, workspace);
    const patchFiles = parsePatch(patch);
    const file = calculateFileScore(patchFiles, parsed.citations);
    const line = calculateLineScore(patchFiles, parsed.citations);
    return {
        kind: "swebench",
        validFinalAnswer: parsed.valid,
        citations: parsed.citations,
        patchFiles,
        file,
        line,
        nBrokenLines: parsed.nBrokenLines,
        nOverlapLineCitation: lineRangeOverlap(parsed.citations),
    };
}

export function parseFinalAnswer(
    text: string,
    workspace?: string,
): {
    valid: boolean;
    citations: SwebenchCitation[];
    nBrokenLines: number;
} {
    const citations: SwebenchCitation[] = [];
    const match = /<final_answer>(.*?)<\/final_answer>/s.exec(text ?? "");
    if (!match) {
        return { valid: false, citations, nBrokenLines: 0 };
    }

    let nBrokenLines = 0;
    for (const raw of match[1].trim().split(/\r?\n/).filter(Boolean)) {
        const citation = /^(.+?):(\d+(?:-\d+)?)\s*(.*)$/.exec(raw.trim());
        if (!citation) {
            nBrokenLines += 1;
            continue;
        }
        const [startRaw, endRaw] = citation[2].includes("-")
            ? citation[2].split("-")
            : [citation[2], citation[2]];
        const startLine = Number(startRaw);
        const endLine = Number(endRaw);
        if (
            !Number.isSafeInteger(startLine) ||
            !Number.isSafeInteger(endLine) ||
            startLine < 1 ||
            endLine < startLine
        ) {
            nBrokenLines += 1;
            continue;
        }
        citations.push({
            path: normalizeCitationPath(citation[1].trim(), workspace),
            lineRange: citation[2],
            startLine,
            endLine,
            explanation: citation[3]?.trim() ?? "",
        });
    }
    return { valid: true, citations, nBrokenLines };
}

export function parsePatch(text: string): PatchEdit[] {
    const edits: PatchEdit[] = [];
    const sections = text.split(/(?=^diff --git a\/)/m).filter(Boolean);
    for (const section of sections) {
        const fileMatch = /^diff --git a\/(.+) b\/(.+)$/m.exec(section);
        if (
            !fileMatch ||
            !fileTypes.some((suffix) => fileMatch[1].endsWith(suffix))
        ) {
            continue;
        }
        for (const hunk of section.matchAll(
            /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm,
        )) {
            const startLine = Number(hunk[1]);
            const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
            const endLine = startLine + count - 1;
            if (
                !Number.isSafeInteger(startLine) ||
                !Number.isSafeInteger(count) ||
                count < 0 ||
                !Number.isSafeInteger(endLine)
            ) {
                continue;
            }
            if (startLine === 0 && count === 0) {
                continue;
            }
            edits.push({
                path: fileMatch[1],
                startLine,
                endLine,
            });
        }
    }
    return edits;
}

export function overallRecall(score: SwebenchScore): number {
    return 0.5 * score.file.recall + 0.5 * score.line.recall;
}

function calculateFileScore(
    trueEdits: PatchEdit[],
    predicted: SwebenchCitation[],
): SwebenchMetricScore {
    const truth = new Set(trueEdits.map((edit) => edit.path));
    const citations = new Set(predicted.map((citation) => citation.path));
    return calculateMetric(truth, citations);
}

function calculateLineScore(
    trueEdits: PatchEdit[],
    predicted: SwebenchCitation[],
): SwebenchMetricScore {
    const truth = unionIntervalsByPath(trueEdits);
    const citations = unionIntervalsByPath(predicted);
    const nPatch = intervalCount(truth);
    const nCitation = intervalCount(citations);
    const overlap = intervalIntersectionCount(truth, citations);
    return calculateMetricCounts(overlap, nCitation, nPatch);
}

function calculateMetric<T>(
    truth: Set<T>,
    citations: Set<T>,
): SwebenchMetricScore {
    let overlap = 0;
    for (const value of truth) {
        if (citations.has(value)) {
            overlap += 1;
        }
    }
    return calculateMetricCounts(
        BigInt(overlap),
        BigInt(citations.size),
        BigInt(truth.size),
    );
}

function calculateMetricCounts(
    overlapCount: bigint,
    citationCount: bigint,
    patchCount: bigint,
): SwebenchMetricScore {
    const overlap = Number(overlapCount);
    const nCitation = Number(citationCount);
    const nPatch = Number(patchCount);
    const precision = nCitation > 0 ? overlap / nCitation : 0;
    const recall = nPatch > 0 ? overlap / nPatch : 0;
    const f1 =
        precision + recall > 0
            ? (2 * precision * recall) / (precision + recall)
            : 0;
    return {
        score: calculateExploreScore(precision, recall, nCitation, nPatch),
        precision,
        recall,
        f1,
        nCitation,
        nPatch,
    };
}

function unionIntervalsByPath<T extends { path: string } & LineInterval>(
    values: T[],
): Map<string, LineInterval[]> {
    const byPath = new Map<string, LineInterval[]>();
    for (const value of values) {
        if (value.endLine < value.startLine) {
            continue;
        }
        const intervals = byPath.get(value.path) ?? [];
        intervals.push({
            startLine: value.startLine,
            endLine: value.endLine,
        });
        byPath.set(value.path, intervals);
    }
    for (const [file, intervals] of byPath) {
        intervals.sort(
            (left, right) =>
                left.startLine - right.startLine ||
                left.endLine - right.endLine,
        );
        const union: LineInterval[] = [];
        for (const interval of intervals) {
            const previous = union[union.length - 1];
            const adjacent =
                previous &&
                previous.endLine < Number.MAX_SAFE_INTEGER &&
                interval.startLine === previous.endLine + 1;
            if (
                previous &&
                (interval.startLine <= previous.endLine || adjacent)
            ) {
                previous.endLine = Math.max(previous.endLine, interval.endLine);
            } else {
                union.push({ ...interval });
            }
        }
        byPath.set(file, union);
    }
    return byPath;
}

function intervalCount(byPath: Map<string, LineInterval[]>): bigint {
    let count = 0n;
    for (const intervals of byPath.values()) {
        for (const interval of intervals) {
            count += BigInt(interval.endLine - interval.startLine) + 1n;
        }
    }
    return count;
}

function intervalIntersectionCount(
    leftByPath: Map<string, LineInterval[]>,
    rightByPath: Map<string, LineInterval[]>,
): bigint {
    let count = 0n;
    for (const [file, left] of leftByPath) {
        const right = rightByPath.get(file);
        if (!right) {
            continue;
        }
        let leftIndex = 0;
        let rightIndex = 0;
        while (leftIndex < left.length && rightIndex < right.length) {
            const leftInterval = left[leftIndex];
            const rightInterval = right[rightIndex];
            const startLine = Math.max(
                leftInterval.startLine,
                rightInterval.startLine,
            );
            const endLine = Math.min(
                leftInterval.endLine,
                rightInterval.endLine,
            );
            if (startLine <= endLine) {
                count += BigInt(endLine - startLine) + 1n;
            }
            if (leftInterval.endLine <= rightInterval.endLine) {
                leftIndex += 1;
            } else {
                rightIndex += 1;
            }
        }
    }
    return count;
}

function calculateExploreScore(
    precision: number,
    recall: number,
    nCitation: number,
    nLabel: number,
    beta = 0.5,
    lambda = 0.1,
): number {
    const fBeta =
        precision + recall === 0
            ? 0
            : ((1 + beta ** 2) * precision * recall) /
              (beta ** 2 * precision + recall);
    const penalty =
        lambda *
        Math.max(0, (nCitation - Math.max(1, nLabel)) / Math.max(1, nLabel));
    return fBeta - penalty;
}

function lineRangeOverlap(citations: SwebenchCitation[]): number {
    const byFile = new Map<string, Array<[number, number]>>();
    for (const citation of citations) {
        const ranges = byFile.get(citation.path) ?? [];
        ranges.push([citation.startLine, citation.endLine]);
        byFile.set(citation.path, ranges);
    }
    let overlap = 0;
    for (const ranges of byFile.values()) {
        ranges.sort((left, right) => left[0] - right[0]);
        for (let index = 1; index < ranges.length; index += 1) {
            if (ranges[index][0] < ranges[index - 1][1]) {
                overlap += 1;
            }
        }
    }
    return overlap;
}

function normalizeCitationPath(input: string, workspace?: string): string {
    let value = input.replace(/\\/g, "/").trim();
    value = value.replace(/^(?:[-*+•]|\d+[.)])\s+/, "");
    if (workspace) {
        const normalizedWorkspace = path.resolve(workspace).replace(/\\/g, "/");
        if (value.startsWith(`${normalizedWorkspace}/`)) {
            value = path.posix.relative(normalizedWorkspace, value);
        }
    }
    for (const prefix of [
        "/testbed/",
        "testbed/",
        "/workspace/",
        "workspace/",
        "./",
        "a/",
        "b/",
    ]) {
        if (value.startsWith(prefix)) {
            value = value.slice(prefix.length);
        }
    }
    return value.replace(/^\/+/, "");
}
