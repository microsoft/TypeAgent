// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import git from "isomorphic-git";
import { ViewHistory } from "../src/viewHistory.js";

const baselineRevision = "2ff659b94dd4309305306c71f2bc1efd9d08a669";

function representativeState(mebibytes: number) {
    const words = (
        "maintenance evidence records dated observation source citation topic " +
        "boundary explanation retained decision customer project architecture " +
        "meeting review deployment procedure failure recovery checkpoint " +
        "document owner investigation result policy schedule revision approval " +
        "reasoning summary alternative limitation recommendation measurement " +
        "component relationship context incident plan validation implementation " +
        "requirements contract query service storage reliable history operation"
    ).split(" ");
    const topicBody = (index: number) => {
        let seed = index + 1;
        const terms = [];
        for (let word = 0; word < 800; word++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            terms.push(words[(seed >>> 8) % words.length]);
        }
        return terms.join(" ");
    };
    const body = topicBody(0);
    const sample = { id: "topic-00000", body, sourceId: "synthetic-source" };
    const topics: Array<typeof sample> = [];
    let bytes = 0;
    const budget = (mebibytes * 1024 * 1024) / 2 - 1024;
    while (true) {
        const index = topics.length;
        const topic = {
            ...sample,
            id: `topic-${String(index).padStart(5, "0")}`,
            body: topicBody(index),
        };
        const size = Buffer.byteLength(JSON.stringify(topic)) + 1;
        if (bytes + size > budget) break;
        bytes += size;
        topics.push(topic);
    }
    return {
        receipt: { sequence: 0 },
        topics,
        builds: [
            {
                id: "build-input",
                snapshot: { topics },
                curation: { completedBatches: 0 },
            },
        ],
        views: { selected: [{ revision: 1 }] },
    };
}
type PerfState = ReturnType<typeof representativeState>;

async function originalHistory(directory: string): Promise<typeof ViewHistory> {
    // Compile the actual original implementation, including its record writer,
    // not a hand-written approximation of the baseline publication path.
    for (const name of ["viewHistory", "viewHistoryRecords"]) {
        let source = execFileSync(
            "git",
            [
                "show",
                `${baselineRevision}:ts/packages/memory/service/src/${name}.ts`,
            ],
            { encoding: "utf8" },
        );
        source = source.replace(
            /(["'])\.\/([^"']+)\.js\1/g,
            (_match, quote: string, dependency: string) =>
                `${quote}${
                    dependency === "viewHistoryRecords"
                        ? "./viewHistoryRecords.mjs"
                        : new URL(`../${dependency}.js`, import.meta.url).href
                }${quote}`,
        );
        await writeFile(
            path.join(directory, `${name}.mjs`),
            ts.transpileModule(source, {
                compilerOptions: {
                    target: ts.ScriptTarget.ES2021,
                    module: ts.ModuleKind.ES2022,
                },
            }).outputText,
        );
    }
    return (
        await import(
            pathToFileURL(path.join(directory, "viewHistory.mjs")).href
        )
    ).ViewHistory as typeof ViewHistory;
}

function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * fraction) - 1];
}

interface Measurement {
    elapsedMs: number;
    serializedBytes: number;
    blobBytes: number;
}

async function measure(
    history: ViewHistory<PerfState>,
    sequence: number,
): Promise<Measurement> {
    const stringify = JSON.stringify;
    const writeBlob = git.writeBlob;
    let serializedBytes = 0;
    let blobBytes = 0;
    const stringifySpy = import.meta.jest
        .spyOn(JSON, "stringify")
        .mockImplementation((value, replacer, space) => {
            const text = stringify(value, replacer, space);
            if (text) serializedBytes += Buffer.byteLength(text);
            return text;
        });
    const blobSpy = import.meta.jest
        .spyOn(git, "writeBlob")
        .mockImplementation(async (options) => {
            blobBytes += options.blob.byteLength;
            return writeBlob(options);
        });
    try {
        const started = performance.now();
        const snapshot = await history.read();
        snapshot.state.receipt.sequence = sequence;
        snapshot.state.builds[0].curation.completedBatches = sequence;
        await history.commit(
            snapshot.head,
            snapshot.state,
            {},
            "test",
            `Receipt ${sequence}`,
        );
        return {
            elapsedMs: performance.now() - started,
            serializedBytes,
            blobBytes,
        };
    } finally {
        stringifySpy.mockRestore();
        blobSpy.mockRestore();
    }
}

test.each([27, 52])(
    "%i MiB five paired original/incremental read-update-commit repetitions",
    async (mebibytes) => {
        const root = await mkdtemp(
            path.join(process.cwd(), ".history-payload-perf-"),
        );
        try {
            const generated = path.join(root, "baseline-code");
            await mkdir(generated);
            const Original = await originalHistory(generated);
            const state = representativeState(mebibytes);
            const stateBytes = Buffer.byteLength(JSON.stringify(state));
            const old = new Original<PerfState>(
                path.join(root, "original"),
                () => representativeState(0),
                undefined,
                (state) => state.views,
            );
            const next = new ViewHistory<PerfState>(
                path.join(root, "incremental"),
                () => representativeState(0),
                undefined,
                (state) => state.views,
            );
            await old.commit(null, state, {}, "test", "Initial");
            await next.commit(null, state, {}, "test", "Initial");
            const baseline: Measurement[] = [];
            const incremental: Measurement[] = [];
            for (let repetition = 1; repetition <= 5; repetition++) {
                if (repetition % 2) {
                    baseline.push(await measure(old, repetition));
                    incremental.push(await measure(next, repetition));
                } else {
                    incremental.push(await measure(next, repetition));
                    baseline.push(await measure(old, repetition));
                }
                expect((await next.read()).state).toEqual(
                    (await old.read()).state,
                );
            }
            const summary = (values: Measurement[]) => ({
                medianMs: percentile(
                    values.map((value) => value.elapsedMs),
                    0.5,
                ),
                p95Ms: percentile(
                    values.map((value) => value.elapsedMs),
                    0.95,
                ),
                medianSerializedBytes: percentile(
                    values.map((value) => value.serializedBytes),
                    0.5,
                ),
                medianBlobBytes: percentile(
                    values.map((value) => value.blobBytes),
                    0.5,
                ),
            });
            const before = summary(baseline);
            const after = summary(incremental);
            process.stdout.write(
                JSON.stringify({
                    fixture: "synthetic-topics-and-build-input-snapshot",
                    baselineRevision,
                    stateBytes,
                    pairedRepetitions: 5,
                    baseline,
                    incremental,
                    before,
                    after,
                    serializationReduction:
                        1 -
                        after.medianSerializedBytes /
                            before.medianSerializedBytes,
                    medianElapsedReduction:
                        1 - after.medianMs / before.medianMs,
                    noP95Regression: after.p95Ms <= before.p95Ms,
                }) + "\n",
            );
        } finally {
            import.meta.jest.restoreAllMocks();
            await rm(root, { recursive: true, force: true });
        }
    },
    180_000,
);
