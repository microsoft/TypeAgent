// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
    classifyDroidCalls,
    hasDroidCallResultReference,
    parseDroidCallCode,
    type DroidCall,
    type DroidCallShape,
} from "./droidCallParser.js";
import { DROIDCALL_HF, readDroidCallJsonl } from "./get-dataset.js";

interface CanonicalRow {
    query: string;
    answers: DroidCall[];
    tools: unknown[];
}

interface ChatRow {
    messages: { role: string; content: string }[];
}

interface Bucket {
    rows: number;
    percent: number;
}

interface SplitAnalysis {
    rows: number;
    calls: number;
    buckets: Record<DroidCallShape, Bucket>;
    callCountDistribution: Record<string, number>;
    nestedConsumerTools: Record<string, number>;
}

interface SourceFileInfo {
    bytes: number;
    sha256: string;
}

const percent = (part: number, total: number): number =>
    Number(((part * 100) / total).toFixed(2));

function analyzeSplit(rows: CanonicalRow[]): SplitAnalysis {
    const bucketCounts: Record<DroidCallShape, number> = {
        singleTool: 0,
        multiCallNested: 0,
        multiCallWithoutNested: 0,
    };
    const distribution = new Map<number, number>();
    const nestedConsumers = new Map<string, number>();
    let calls = 0;
    for (const row of rows) {
        calls += row.answers.length;
        bucketCounts[classifyDroidCalls(row.answers)]++;
        distribution.set(
            row.answers.length,
            (distribution.get(row.answers.length) ?? 0) + 1,
        );
        for (const call of row.answers) {
            if (hasDroidCallResultReference(call.arguments)) {
                nestedConsumers.set(
                    call.name,
                    (nestedConsumers.get(call.name) ?? 0) + 1,
                );
            }
        }
    }
    return {
        rows: rows.length,
        calls,
        buckets: Object.fromEntries(
            Object.entries(bucketCounts).map(([key, count]) => [
                key,
                { rows: count, percent: percent(count, rows.length) },
            ]),
        ) as Record<DroidCallShape, Bucket>,
        callCountDistribution: Object.fromEntries(
            [...distribution].sort(([left], [right]) => left - right),
        ),
        nestedConsumerTools: Object.fromEntries(
            [...nestedConsumers].sort((left, right) => right[1] - left[1]),
        ),
    };
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)]),
        );
    }
    return value;
}

function sameCalls(left: DroidCall[], right: DroidCall[]): boolean {
    return (
        JSON.stringify(canonicalize(left)) ===
        JSON.stringify(canonicalize(right))
    );
}

async function sourceFileInfo(
    rawDir: string,
): Promise<Record<string, SourceFileInfo>> {
    const result: Record<string, SourceFileInfo> = {};
    for (const relativePath of DROIDCALL_HF.files) {
        const path = join(rawDir, relativePath);
        const [contents, fileStat] = await Promise.all([
            readFile(path),
            stat(path),
        ]);
        result[relativePath] = {
            bytes: fileStat.size,
            sha256: createHash("sha256").update(contents).digest("hex"),
        };
    }
    return result;
}

function markdown(report: DroidCallAnalysis): string {
    const row = (name: string, bucket: Bucket) =>
        `| ${name} | ${bucket.rows.toLocaleString()} | ${bucket.percent.toFixed(2)}% |`;
    const sections = Object.entries(report.splits)
        .map(([name, split]) => {
            const heading =
                name === "full"
                    ? "Full dataset"
                    : name === "train"
                      ? "Training split"
                      : "Test split";
            const multiCallRows =
                split.buckets.multiCallNested.rows +
                split.buckets.multiCallWithoutNested.rows;
            const nestedShareOfMultiCall = percent(
                split.buckets.multiCallNested.rows,
                multiCallRows,
            );
            const distribution = Object.entries(split.callCountDistribution)
                .map(([calls, rows]) => `${calls}: ${rows.toLocaleString()}`)
                .join(", ");
            return `## ${heading}\n\n${split.rows.toLocaleString()} rows contain ${split.calls.toLocaleString()} calls. ${multiCallRows.toLocaleString()} rows (${percent(multiCallRows, split.rows).toFixed(2)}%) have more than one call. Of those multi-call rows, ${nestedShareOfMultiCall.toFixed(2)}% pass a prior result into a later call.\n\n| Shape | Rows | Share of rows |\n| --- | ---: | ---: |\n${row("Single tool", split.buckets.singleTool)}\n${row("Multi-call, nested", split.buckets.multiCallNested)}\n${row("Multi-call, without nesting", split.buckets.multiCallWithoutNested)}\n\nRows by call count: ${distribution}.`;
        })
        .join("\n\n");
    const snapshotBytes = Object.values(report.source.files).reduce(
        (sum, file) => sum + file.bytes,
        0,
    );
    const full = report.splits.full!;
    const fullMultiCallRows =
        full.buckets.multiCallNested.rows +
        full.buckets.multiCallWithoutNested.rows;
    return `# DroidCall data analysis\n\nThe full DroidCall dataset has ${full.rows.toLocaleString()} rows and ${full.calls.toLocaleString()} gold calls. Single-tool requests account for ${full.buckets.singleTool.percent.toFixed(2)}% of rows. The other ${percent(fullMultiCallRows, full.rows).toFixed(2)}% are multi-call requests; ${percent(full.buckets.multiCallNested.rows, fullMultiCallRows).toFixed(2)}% of those pass a prior result into a later call.\n\nSource: [mllmTeam/DroidCall](https://huggingface.co/datasets/mllmTeam/DroidCall), revision \`${report.source.revision}\`. The local snapshot has ${Object.keys(report.source.files).length} files (${(snapshotBytes / 1024 / 1024).toFixed(2)} MiB). It includes every file listed by the HuggingFace repository at that revision.\n\n## Classification\n\nThe analysis reads the structured \`answers\` in \`DroidCall_train.jsonl\` and \`DroidCall_test.jsonl\`. The buckets are mutually exclusive:\n\n- Single tool: exactly one gold call.\n- Multi-call, nested: at least two calls and an argument contains a \`#N\` result reference. The reference can be the whole value or part of a larger string, and it can occur inside an array or object.\n- Multi-call, without nesting: at least two calls and no argument contains a result reference.\n\n${sections}\n\n## Parser reuse and validation\n\nDroidCall's assistant output uses Python-like function calls. \`parseDroidCallCode()\` handles the assignment and call syntax, then delegates strings, numbers, booleans, nulls, arrays, and objects to Seal-Tools' existing \`parsePythonLiteral()\`. This keeps one literal parser for both datasets.\n\nThe code-format file covers the ${report.parserValidation.rows.toLocaleString()} training rows. Parsed calls exactly match the canonical structured answers for ${report.parserValidation.exactMatches.toLocaleString()} rows (${percent(report.parserValidation.exactMatches, report.parserValidation.rows).toFixed(2)}%). There are ${report.parserValidation.parseFailures} parse failures and ${report.parserValidation.mismatches} source mismatches. The two mismatches are source anomalies: one gold function name is a sentence-like value that is not a valid function identifier, and one gold argument key starts with a space that the code syntax cannot preserve.\n`;
}

export interface DroidCallAnalysis {
    source: {
        dataset: string;
        revision: string;
        files: Record<string, SourceFileInfo>;
    };
    splits: Record<string, SplitAnalysis>;
    parserValidation: {
        rows: number;
        exactMatches: number;
        parseFailures: number;
        mismatches: number;
    };
}

export async function analyzeDroidCall(
    outputDir: string,
): Promise<DroidCallAnalysis> {
    const rawDir = join(outputDir, "raw");
    const [train, test, chat] = await Promise.all([
        readDroidCallJsonl<CanonicalRow>(join(rawDir, "DroidCall_train.jsonl")),
        readDroidCallJsonl<CanonicalRow>(join(rawDir, "DroidCall_test.jsonl")),
        readDroidCallJsonl<ChatRow>(join(rawDir, "DroidCall_code_short.jsonl")),
    ]);
    let exactMatches = 0;
    let parseFailures = 0;
    let mismatches = 0;
    for (let index = 0; index < chat.length; index++) {
        const assistant = [...chat[index]!.messages]
            .reverse()
            .find((message) => message.role === "assistant");
        if (assistant === undefined) {
            parseFailures++;
            continue;
        }
        try {
            const parsed = parseDroidCallCode(assistant.content);
            if (sameCalls(parsed, train[index]!.answers)) exactMatches++;
            else mismatches++;
        } catch {
            parseFailures++;
        }
    }
    const report: DroidCallAnalysis = {
        source: {
            dataset: DROIDCALL_HF.dataset,
            revision: DROIDCALL_HF.revision,
            files: await sourceFileInfo(rawDir),
        },
        splits: {
            full: analyzeSplit([...train, ...test]),
            train: analyzeSplit(train),
            test: analyzeSplit(test),
        },
        parserValidation: {
            rows: chat.length,
            exactMatches,
            parseFailures,
            mismatches,
        },
    };
    const docsDir = join(outputDir, "docs");
    await mkdir(docsDir, { recursive: true });
    await Promise.all([
        writeFile(
            join(outputDir, "analysis.json"),
            JSON.stringify(report, null, 2) + "\n",
        ),
        writeFile(join(docsDir, "DroidCall.md"), markdown(report)),
    ]);
    return report;
}
