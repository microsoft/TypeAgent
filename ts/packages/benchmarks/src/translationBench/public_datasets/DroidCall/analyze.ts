// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    parseDroidCallCode,
    type DroidCall,
    type DroidCallShape,
} from "../pythonLiteral.js";
import { DROIDCALL_SOURCE, downloadDroidCall } from "../huggingFaceRows.js";

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

const DROIDCALL_SOURCE_SHA256 = {
    "DroidCall_code_short.jsonl":
        "263e79dbc060fa5c228dbeb835b89e04087c0a723904b5704a82c86001feb7b1",
    "DroidCall_train.jsonl":
        "4cb2d5691c1b95b0908c59efcb361c8a9c9b12f0a4d182acfc2df0ccc92e6d3b",
    "DroidCall_test.jsonl":
        "d7e40ce794c98984befb872d2d71ee28511938c0baef881b14098575cda151f2",
    "annotated_api.jsonl":
        "29c4791f7a496e587af74b1a1398864bd6c6de9db767cb97606525d62ec05951",
    "README.md":
        "08a6c5cfa655e1ecd774a41a9a815e845ad0afd47b289378bc1d6ee66c81dda9",
    ".gitattributes":
        "74a8a09003e5506f7f0d9f5571d9ec05fba960e14e08f8eeb20aab0c429d2303",
    "figures/data_generation.png":
        "a126a0caebabfb48b80815a81e2d23ccc80a82c13adba62d23ab339ba5061313",
    "figures/intent.png":
        "8d67eb492ed2c05498581fb9a6842ed899155530f25c18ddf8f5929bc63e157b",
} satisfies Record<(typeof DROIDCALL_SOURCE.files)[number], string>;

const percent = (part: number, total: number): number =>
    total === 0 ? 0 : Number(((part * 100) / total).toFixed(2));

const RESULT_REFERENCE = /#(\d+)\b/g;
const DOWNLOAD_OPTION = "--download";

function hasPriorResultReference(
    value: unknown,
    priorResultIds: ReadonlySet<number>,
): boolean {
    if (typeof value === "string") {
        return [...value.matchAll(RESULT_REFERENCE)].some((match) =>
            priorResultIds.has(Number(match[1])),
        );
    }
    if (Array.isArray(value)) {
        return value.some((item) =>
            hasPriorResultReference(item, priorResultIds),
        );
    }
    if (typeof value === "object" && value !== null) {
        return Object.values(value).some((item) =>
            hasPriorResultReference(item, priorResultIds),
        );
    }
    return false;
}

function nestedConsumerNames(calls: readonly DroidCall[]): string[] {
    const priorResultIds = new Set<number>();
    const names: string[] = [];
    for (const call of calls) {
        if (hasPriorResultReference(call.arguments, priorResultIds)) {
            names.push(call.name);
        }
        priorResultIds.add(call.id);
    }
    return names;
}

function classifyCalls(calls: readonly DroidCall[]): DroidCallShape {
    if (calls.length === 0) return "noCall";
    if (calls.length === 1) return "singleTool";
    return nestedConsumerNames(calls).length > 0
        ? "multiCallNested"
        : "multiCallWithoutNested";
}

function analyzeSplit(rows: CanonicalRow[]): SplitAnalysis {
    const bucketCounts: Record<DroidCallShape, number> = {
        noCall: 0,
        singleTool: 0,
        multiCallNested: 0,
        multiCallWithoutNested: 0,
    };
    const distribution = new Map<number, number>();
    const nestedConsumers = new Map<string, number>();
    let calls = 0;
    for (const row of rows) {
        calls += row.answers.length;
        bucketCounts[classifyCalls(row.answers)]++;
        distribution.set(
            row.answers.length,
            (distribution.get(row.answers.length) ?? 0) + 1,
        );
        for (const name of nestedConsumerNames(row.answers)) {
            nestedConsumers.set(name, (nestedConsumers.get(name) ?? 0) + 1);
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

type SourceFileName = (typeof DROIDCALL_SOURCE.files)[number];

interface SourceSnapshot {
    files: Record<string, SourceFileInfo>;
    contents: Map<SourceFileName, Buffer>;
}

async function readSourceSnapshot(rawDir: string): Promise<SourceSnapshot> {
    const files: Record<string, SourceFileInfo> = {};
    const contents = new Map<SourceFileName, Buffer>();
    for (const relativePath of DROIDCALL_SOURCE.files) {
        const content = await readFile(join(rawDir, relativePath));
        const sha256 = createHash("sha256").update(content).digest("hex");
        if (sha256 !== DROIDCALL_SOURCE_SHA256[relativePath]) {
            throw new Error(
                `${relativePath} does not match DroidCall revision ${DROIDCALL_SOURCE.revision}`,
            );
        }
        files[relativePath] = { bytes: content.byteLength, sha256 };
        contents.set(relativePath, content);
    }
    return { files, contents };
}

function parseJsonl<T>(fileName: SourceFileName, contents: Buffer): T[] {
    const rows: T[] = [];
    for (const [index, line] of contents
        .toString("utf8")
        .split("\n")
        .entries()) {
        if (line.trim().length === 0) continue;
        try {
            rows.push(JSON.parse(line) as T);
        } catch (error) {
            throw new Error(`${fileName}:${index + 1}: ${String(error)}`);
        }
    }
    return rows;
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
    const source = await readSourceSnapshot(join(outputDir, "raw"));
    const train = parseJsonl<CanonicalRow>(
        "DroidCall_train.jsonl",
        source.contents.get("DroidCall_train.jsonl")!,
    );
    const test = parseJsonl<CanonicalRow>(
        "DroidCall_test.jsonl",
        source.contents.get("DroidCall_test.jsonl")!,
    );
    const chat = parseJsonl<ChatRow>(
        "DroidCall_code_short.jsonl",
        source.contents.get("DroidCall_code_short.jsonl")!,
    );
    if (chat.length !== train.length) {
        throw new Error(
            `DroidCall code and train row counts differ: ${chat.length} !== ${train.length}`,
        );
    }
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
            dataset: DROIDCALL_SOURCE.dataset,
            revision: DROIDCALL_SOURCE.revision,
            files: source.files,
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
    await writeFile(
        join(outputDir, "analysis.json"),
        JSON.stringify(report, null, 2) + "\n",
    );
    return report;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const outputArgs = args.filter((arg) => !arg.startsWith("--"));
    const unknownOptions = args.filter(
        (arg) => arg.startsWith("--") && arg !== DOWNLOAD_OPTION,
    );
    if (outputArgs.length !== 1 || unknownOptions.length > 0) {
        throw new Error(
            `Usage: analyzeDroidCall [${DOWNLOAD_OPTION}] <output-dir>`,
        );
    }
    const outputDir = outputArgs[0]!;
    if (args.includes(DOWNLOAD_OPTION)) await downloadDroidCall(outputDir);
    const report = await analyzeDroidCall(outputDir);
    process.stdout.write(`${JSON.stringify(report.splits, null, 2)}\n`);
}

if (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
