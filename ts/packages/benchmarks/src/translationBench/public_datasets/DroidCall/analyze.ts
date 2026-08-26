// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    classifyDroidCalls,
    hasDroidCallResultReference,
    parseDroidCallCode,
    type DroidCall,
    type DroidCallShape,
} from "../pythonLiteral.js";
import {
    DROIDCALL_SOURCE,
    downloadDroidCall,
    readDroidCallJsonl,
} from "../huggingFaceRows.js";

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
    for (const relativePath of DROIDCALL_SOURCE.files) {
        const path = join(rawDir, relativePath);
        const [contents, fileStat] = await Promise.all([
            readFile(path),
            stat(path),
        ]);
        const sha256 = createHash("sha256").update(contents).digest("hex");
        if (sha256 !== DROIDCALL_SOURCE_SHA256[relativePath]) {
            throw new Error(
                `${relativePath} does not match DroidCall revision ${DROIDCALL_SOURCE.revision}`,
            );
        }
        result[relativePath] = { bytes: fileStat.size, sha256 };
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
            return `## ${heading}\n\n${split.rows.toLocaleString()} rows contain ${split.calls.toLocaleString()} calls. ${multiCallRows.toLocaleString()} rows (${percent(multiCallRows, split.rows).toFixed(2)}%) have more than one call. Of those multi-call rows, ${nestedShareOfMultiCall.toFixed(2)}% pass a prior result into a later call.\n\n| Shape | Rows | Share of rows |\n| --- | ---: | ---: |\n${row("No call", split.buckets.noCall)}
${row("Single tool", split.buckets.singleTool)}\n${row("Multi-call, nested", split.buckets.multiCallNested)}\n${row("Multi-call, without nesting", split.buckets.multiCallWithoutNested)}\n\nRows by call count: ${distribution}.`;
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
    return `# DroidCall data analysis\n\nThe full DroidCall dataset has ${full.rows.toLocaleString()} rows and ${full.calls.toLocaleString()} gold calls. Single-tool requests account for ${full.buckets.singleTool.percent.toFixed(2)}% of rows. The other ${percent(fullMultiCallRows, full.rows).toFixed(2)}% are multi-call requests; ${percent(full.buckets.multiCallNested.rows, fullMultiCallRows).toFixed(2)}% of those pass a prior result into a later call.\n\nSource: [mllmTeam/DroidCall](https://huggingface.co/datasets/mllmTeam/DroidCall), revision \`${report.source.revision}\`. The local snapshot has ${Object.keys(report.source.files).length} files (${(snapshotBytes / 1024 / 1024).toFixed(2)} MiB). It includes every file listed by the HuggingFace repository at that revision.\n\n## Classification\n\nThe analysis reads the structured \`answers\` in \`DroidCall_train.jsonl\` and \`DroidCall_test.jsonl\`. The buckets are mutually exclusive:\n\n- No call: no gold calls.
- Single tool: exactly one gold call.\n- Multi-call, nested: at least two calls and an argument contains a \`#N\` result reference. The reference can occur inside an array or object.\n- Multi-call, without nesting: at least two calls and no argument contains a result reference.\n\n${sections}\n\n## Parser reuse and validation\n\nDroidCall's assistant output uses Python-like function calls. \`parseDroidCallCode()\` handles the assignment and call syntax, then delegates strings, numbers, booleans, nulls, arrays, and objects to Seal-Tools' existing \`parsePythonLiteral()\`. This keeps one literal parser for both datasets.\n\nThe code-format file covers the ${report.parserValidation.rows.toLocaleString()} training rows. Parsed calls exactly match the canonical structured answers for ${report.parserValidation.exactMatches.toLocaleString()} rows (${percent(report.parserValidation.exactMatches, report.parserValidation.rows).toFixed(2)}%). There are ${report.parserValidation.parseFailures} parse failures and ${report.parserValidation.mismatches} source mismatches. Source mismatches include values that the code syntax cannot reproduce, such as a sentence-like function name or an argument key with leading whitespace.\n`;
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

const DEFAULT_OUTPUT_DIR = join(
    process.cwd(),
    "src/translationBench/public_datasets/DroidCall",
);

async function main(): Promise<void> {
    const args = new Set(process.argv.slice(2));
    const outputArg = process.argv
        .slice(2)
        .find((arg) => !arg.startsWith("--"));
    const outputDir = outputArg ?? DEFAULT_OUTPUT_DIR;
    if (args.has("--download")) await downloadDroidCall(outputDir);
    const report = await analyzeDroidCall(outputDir);
    console.log(JSON.stringify(report.splits, null, 2));
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
