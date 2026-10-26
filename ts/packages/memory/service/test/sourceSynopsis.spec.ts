// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { getRuntimeConfig, setRuntimeConfig } from "@typeagent/aiclient";
import { buildConfig, flatten } from "@typeagent/config";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    generateSourceSynopsis,
    configuredSourceSynopsisModel,
    sourceSynopsisRecipe,
    synopsisInputHash,
    type SourceSynopsisModel,
} from "../src/sourceSynopsis.js";
import type {
    MemorySource,
    SourceRevision,
    SourceSynopsis,
} from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { originalFixtureRoot } from "./wikiConsolidationFixtures.js";
import { TypedViewStore } from "../src/viewStore.js";

interface PromptEvidence {
    id: string;
    start: number;
    end: number;
    excerpt: string;
}

interface SynopsisPrompt {
    text: string;
    start: number;
    end: number;
    evidence: PromptEvidence[];
    summaries?: {
        overview: string;
        evidence: PromptEvidence[];
        qualifications: string[];
        contrasts: string[];
    }[];
}

function readPrompt(prompt: string): SynopsisPrompt {
    return JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
}

function selection(evidence: unknown): string {
    return JSON.stringify({
        preview: "Synthetic source navigation.",
        overview: "Synthetic source navigation, not independent evidence.",
        qualifications: [],
        contrasts: [],
        limitations: [],
        evidence,
    });
}

class DeterministicModel implements SourceSynopsisModel {
    identity = "offline-source-synopsis";
    calls: string[] = [];
    constructor(private readonly capacity = 100_000) {}
    fits(prompt: string): boolean {
        return Buffer.byteLength(prompt) <= this.capacity;
    }
    async complete(prompt: string): Promise<string> {
        this.calls.push(prompt);
        const input = readPrompt(prompt);
        if (input.summaries) {
            const selected =
                input.summaries.find((item) => item.qualifications.length) ??
                input.summaries[0];
            return JSON.stringify({
                preview: selected.overview.slice(0, 300),
                overview: selected.overview,
                evidence: selected.evidence.map(({ id }) => ({ id })),
                qualifications: selected.qualifications,
                contrasts: [],
                limitations: [],
            });
        }
        const text = input.text;
        const marker = text.indexOf("Governing tail exception:");
        const from = marker >= 0 ? marker : 0;
        const excerpt = text.slice(
            from,
            from + (marker >= 0 ? 822 : Math.min(80, text.length)),
        );
        return JSON.stringify({
            preview: excerpt.slice(0, 300),
            overview: excerpt,
            evidence: [
                {
                    id: (
                        input.evidence.find(
                            (item) =>
                                item.start <= input.start + from &&
                                item.end > input.start + from,
                        ) ?? input.evidence[0]
                    ).id,
                },
            ],
            qualifications: marker >= 0 ? [excerpt] : [],
            contrasts: [],
            limitations: [],
        });
    }
}

const source: MemorySource = {
    corpusId: "corpus",
    sourceId: "source",
    title: "Worksheet",
    sourceType: "markdown",
    activeRevisionId: "r1",
    revisions: [],
};
const revision: SourceRevision = {
    sourceId: "source",
    revisionId: "r1",
    contentHash: "hash",
    mimeType: "text/markdown",
    pipelineVersion: "1",
    state: "ready",
};

describe("source synopsis orchestration", () => {
    test("configured synopsis guides final response length without capping reasoning or returned content", async () => {
        const originalConfig = getRuntimeConfig();
        const originalFetch = globalThis.fetch;
        const content = "A retained governing qualification.";
        let calls = 0;
        try {
            setRuntimeConfig(
                buildConfig(
                    flatten({
                        modelProvider: "azure",
                        azureOpenAI: {
                            responseFormat: true,
                            deployments: {
                                synopsis_test: [
                                    {
                                        endpoint:
                                            "https://synthetic.invalid/synopsis",
                                        region: "eastus",
                                        auth: "synthetic-key",
                                    },
                                ],
                            },
                        },
                        modelRequestConstraints: {
                            "azure:chat:synopsis_test": {
                                contextTokens: 10000,
                                outputTokens: 4000,
                            },
                        },
                    }),
                ),
            );
            globalThis.fetch = async (_url, options) => {
                calls++;
                const body = JSON.parse(String(options?.body)) as {
                    messages: { content: string }[];
                };
                expect(body).not.toHaveProperty("max_completion_tokens");
                expect(body).not.toHaveProperty("max_tokens");
                expect(body).not.toHaveProperty("max_output_tokens");
                expect(body.messages[0].content).toContain(
                    "approximately 2000 tokens in the final JSON response, excluding reasoning",
                );
                const output = {
                    preview: content,
                    overview: content,
                    evidence: [
                        {
                            id: readPrompt(body.messages[0].content).evidence[0]
                                .id,
                        },
                    ],
                    qualifications: [],
                    contrasts: [],
                    limitations: [],
                };
                return new Response(
                    JSON.stringify({
                        choices: [
                            { message: { content: JSON.stringify(output) } },
                        ],
                    }),
                    { status: 200 },
                );
            };
            const model = configuredSourceSynopsisModel("azure:synopsis_test");
            expect(model.fits("x".repeat(6000))).toBe(false);
            const synopsis = await generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            );
            expect(synopsis.overview).toBe(content);
            expect(synopsis.evidence[0].excerpt).toBe(content);
            expect(calls).toBe(1);
        } finally {
            setRuntimeConfig(originalConfig);
            globalThis.fetch = originalFetch;
        }
    });

    test.each(["initial", "t1", "t2"])(
        "scans actual P0 %s worksheet completely and composes the governing tail without gold input",
        async (stage) => {
            const content = await readFile(
                path.join(originalFixtureRoot(), stage, "document-020.md"),
                "utf8",
            );
            const model = new DeterministicModel(7000);
            const output = await generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            );
            expect(content.length).toBeGreaterThan(24_000);
            expect(output.coverage.method).toBe("source-order-sections");
            expect(output.coverage.scannedChars).toBe(content.length);
            expect(output.overview).toContain(
                "Short command execution can still coexist with long held leases",
            );
            expect(output.overview).toContain("No universal pool maximum");
            const sections = model.calls
                .filter((prompt) => !prompt.includes('"summaries":'))
                .map(
                    (prompt) =>
                        JSON.parse(
                            prompt.slice(prompt.lastIndexOf("\n") + 1),
                        ) as { text: string; start: number; end: number },
                );
            expect(sections.map((section) => section.text).join("")).toBe(
                content,
            );
            expect(sections[0].start).toBe(0);
            expect(sections.at(-1)?.end).toBe(content.length);
            expect(model.calls.every((prompt) => model.fits(prompt))).toBe(
                true,
            );
            expect(
                model.calls.some((prompt) =>
                    /C1-C11|expected_distinctions|gold/.test(prompt),
                ),
            ).toBe(false);
            for (const evidence of output.evidence) {
                expect(evidence.coordinateSpace).toBe("retained-utf16");
                expect(content.slice(evidence.start, evidence.end)).toBe(
                    evidence.excerpt,
                );
            }
        },
    );

    test("configured capacity permits direct synthesis; CRLF/Unicode coordinates stay original", async () => {
        const content = "# Context\r\n\r\nA 😀 qualification and contrast.\r\n";
        const model = new DeterministicModel();
        const complete = model.complete.bind(model);
        model.complete = async (prompt) => {
            const output = JSON.parse(await complete(prompt));
            output.evidence = readPrompt(prompt).evidence.map(({ id }) => ({
                id,
            }));
            return JSON.stringify(output);
        };
        const output = await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
        );
        expect(output.coverage.method).toBe("direct");
        expect(model.calls).toHaveLength(1);
        expect(output.evidence.map(({ excerpt }) => excerpt).join("")).toBe(
            content,
        );
    });

    test.each(["\n", "\r\n"])(
        "host selects repeated text by ID and preserves whitespace and UTF-16 for %j",
        async (newline) => {
            const repeated = `  A\t😀  scoped statement. ${newline}`;
            const content = `# Synthetic 🧪${newline}${repeated}${repeated}\t  ${newline}`;
            const model = new DeterministicModel();
            let selected!: PromptEvidence;
            model.complete = async (prompt) => {
                const input = readPrompt(prompt);
                expect(
                    input.evidence.map(({ excerpt }) => excerpt).join(""),
                ).toBe(content);
                const matches = input.evidence.filter(
                    ({ excerpt }) => excerpt === repeated,
                );
                expect(matches).toHaveLength(2);
                expect(matches[0].id).not.toBe(matches[1].id);
                selected = matches[1];
                return selection([{ id: selected.id }]);
            };
            const output = await generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            );
            expect(output.evidence).toEqual([
                {
                    coordinateSpace: "retained-utf16",
                    start: content.lastIndexOf(repeated),
                    end: content.lastIndexOf(repeated) + repeated.length,
                    excerpt: repeated,
                },
            ]);
            expect(output.evidence[0]).not.toHaveProperty("id");
            expect(selected.start).toBe(content.lastIndexOf(repeated));
            model.complete = async () => selection([{ excerpt: repeated }]);
            await expect(
                generateSourceSynopsis(
                    source,
                    revision,
                    content,
                    model,
                    new AbortController().signal,
                ),
            ).rejects.toThrow("exact supplied retained evidence ID");
        },
    );

    test.each([
        "unknown",
        "shortened",
        "whitespace",
        "number",
        "null",
        "array",
        "quote-only",
        "offsets-only",
        "normalized-quote",
        "exact-quote",
        "extra-offsets",
    ])("rejects invalid evidence selection: %s", async (kind) => {
        const content = "Synthetic\t  evidence 😀.\r\n";
        const model = new DeterministicModel();
        model.complete = async (prompt) => {
            const item = readPrompt(prompt).evidence[0];
            const entries: Record<string, unknown> = {
                unknown: { id: "forged" },
                shortened: { id: item.id.slice(0, 20) },
                whitespace: { id: ` ${item.id}` },
                number: { id: 0 },
                null: null,
                array: [item.id],
                "quote-only": { excerpt: content },
                "offsets-only": { start: item.start, end: item.end },
                "normalized-quote": {
                    id: item.id,
                    excerpt: content.replace(/\s+/g, " "),
                },
                "exact-quote": { id: item.id, excerpt: content },
                "extra-offsets": {
                    id: item.id,
                    start: item.start,
                    end: item.end,
                },
            };
            return selection([entries[kind]]);
        };
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow(/synopsis evidence/i);
    });

    test.each(["source", "corpus", "revision", "hash", "content"])(
        "rejects a valid ID reused for a different %s",
        async (kind) => {
            const content = "Same synthetic text 😀.\r\n";
            const model = new DeterministicModel();
            let previousId!: string;
            model.complete = async (prompt) => {
                previousId = readPrompt(prompt).evidence[0].id;
                return selection([{ id: previousId }]);
            };
            await generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            );
            model.complete = async () => selection([{ id: previousId }]);
            await expect(
                generateSourceSynopsis(
                    {
                        ...source,
                        ...(kind === "source" ? { sourceId: "other" } : {}),
                        ...(kind === "corpus" ? { corpusId: "other" } : {}),
                    },
                    {
                        ...revision,
                        ...(kind === "source" ? { sourceId: "other" } : {}),
                        ...(kind === "revision" ? { revisionId: "r2" } : {}),
                        ...(kind === "hash" ? { contentHash: "other" } : {}),
                    },
                    kind === "content" ? content + "changed" : content,
                    model,
                    new AbortController().signal,
                ),
            ).rejects.toThrow("exact supplied retained evidence ID");
        },
    );

    test("rejects mismatched source/revision identity before requesting synthesis", async () => {
        const model = new DeterministicModel();
        await expect(
            generateSourceSynopsis(
                source,
                { ...revision, sourceId: "other" },
                "text",
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow("different source");
        expect(model.calls).toHaveLength(0);
    });

    test("an ID elsewhere in the source is not evidence for an unsupplied section", async () => {
        const content = `${"Earlier synthetic context. ".repeat(600)}\n\nFinal evidence only.`;
        const model = new DeterministicModel(7000);
        await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
        );
        const sections = model.calls.filter(
            (prompt) => !readPrompt(prompt).summaries,
        );
        const lastId = readPrompt(sections.at(-1)!).evidence.at(-1)!.id;
        model.complete = async () => selection([{ id: lastId }]);
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow("exact supplied retained evidence ID");
    });

    test("composition cannot introduce a valid original ID absent from supplied summary evidence", async () => {
        const content =
            "First synthetic line.\nNot selected in any summary.\n" +
            "Other context.\n".repeat(1000);
        const model = new DeterministicModel(7000);
        const complete = model.complete.bind(model);
        let unselectedId: string | undefined;
        model.complete = async (prompt) => {
            const input = readPrompt(prompt);
            if (!input.summaries && !unselectedId)
                unselectedId = input.evidence[1].id;
            const output = JSON.parse(await complete(prompt));
            if (input.summaries) output.evidence = [{ id: unselectedId }];
            return JSON.stringify(output);
        };
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow("exact supplied retained evidence ID");
    });

    test("fresh long synthetic source traverses every original span and preserves distant governing details", async () => {
        const qualification =
            "Governing tail exception: the 43-slot number is withdrawn; only local review is complete, not rollout. Hold time is not command execution time.";
        const content =
            "# Synthetic capacity\r\nProvisional value: 43 slots.\r\n\r\n" +
            "## Observations\r\nMetric | Value\r\n--- | ---\r\nSample | 😀\t  pending\r\n\r\n".repeat(
                600,
            ) +
            qualification +
            "\r\n";
        const model = new DeterministicModel(7000);
        const coverage: SourceSynopsis["coverage"][] = [];
        const output = await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
            (read) => coverage.push(read),
        );
        expect(output.coverage.method).toBe("source-order-sections");
        expect(output.coverage.scannedChars).toBe(content.length);
        expect(output.overview).toContain(qualification);
        expect(coverage.at(-1)?.scannedChars).toBe(content.length);
        const sections = model.calls
            .filter((prompt) => !readPrompt(prompt).summaries)
            .map(readPrompt);
        expect(sections.map(({ text }) => text).join("")).toBe(content);
        expect(sections.at(-1)?.end).toBe(content.length);
        expect(model.calls.every((prompt) => model.fits(prompt))).toBe(true);
        for (const section of sections) {
            expect(
                section.evidence.map(({ excerpt }) => excerpt).join(""),
            ).toBe(section.text);
            for (const evidence of section.evidence) {
                expect(content.slice(evidence.start, evidence.end)).toBe(
                    evidence.excerpt,
                );
                expect(/^[\uDC00-\uDFFF]/.test(evidence.excerpt)).toBe(false);
                expect(/[\uD800-\uDBFF]$/.test(evidence.excerpt)).toBe(false);
                expect(
                    content.slice(evidence.end - 1, evidence.end + 1),
                ).not.toBe("\r\n");
            }
        }
        for (const evidence of output.evidence)
            expect(content.slice(evidence.start, evidence.end)).toBe(
                evidence.excerpt,
            );
    });

    test("host inventory bounds long lines without splitting surrogate pairs or CRLF", async () => {
        const content =
            "x".repeat(999) +
            "😀" +
            " y".repeat(1000) +
            "\r\n" +
            "x".repeat(999) +
            "\r\n";
        const model = new DeterministicModel();
        model.complete = async (prompt) => {
            const input = readPrompt(prompt);
            expect(input.evidence.length).toBeGreaterThan(3);
            expect(input.evidence.map(({ excerpt }) => excerpt).join("")).toBe(
                content,
            );
            for (const item of input.evidence) {
                expect(item.end - item.start).toBeLessThanOrEqual(1000);
                expect(/^[\uDC00-\uDFFF]/.test(item.excerpt)).toBe(false);
                expect(/[\uD800-\uDBFF]$/.test(item.excerpt)).toBe(false);
                expect(content.slice(item.end - 1, item.end + 1)).not.toBe(
                    "\r\n",
                );
            }
            return selection(input.evidence.map(({ id }) => ({ id })));
        };
        const output = await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
        );
        expect(output.evidence.map(({ excerpt }) => excerpt).join("")).toBe(
            content,
        );
    });

    test.each(["qualifications", "contrasts"] as const)(
        "synthetic composition rejects dropped governing %s in arrays or overview",
        async (key) => {
            const detail =
                "Only the amber cohort is approved; the violet cohort is excluded.";
            const content =
                "# Provisional claim\n" +
                "Neutral observation.\n".repeat(900) +
                "\n" +
                detail;
            for (const drop of ["array", "overview"]) {
                const model = new DeterministicModel(7000);
                const complete = model.complete.bind(model);
                model.complete = async (prompt) => {
                    const input = readPrompt(prompt);
                    const output = JSON.parse(await complete(prompt));
                    if (!input.summaries && input.text.includes(detail)) {
                        output[key] = [detail];
                        output.overview = detail;
                    } else if (input.summaries) {
                        const distinctions = input.summaries.flatMap(
                            (summary) => summary[key],
                        );
                        output[key] = [...new Set(distinctions)];
                        output.overview =
                            output[key].join(" ") || "Synthetic overview.";
                        if (output[key].length) {
                            if (drop === "array") output[key] = [];
                            else output.overview = "All cohorts approved.";
                        }
                    }
                    return JSON.stringify(output);
                };
                await expect(
                    generateSourceSynopsis(
                        source,
                        revision,
                        content,
                        model,
                        new AbortController().signal,
                    ),
                ).rejects.toThrow(
                    "dropped a supplied governing qualification or contrast",
                );
            }
        },
    );

    test("non-leading-pipe tables retain repeated structural headers separately from original CRLF/Unicode ranges", async () => {
        const content =
            "# Scope\r\n\r\nMetric | Value\r\n--- | ---\r\nLease | " +
            "😀 held connection ".repeat(1000) +
            "\r\n";
        const model = new DeterministicModel(7000);
        await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
        );
        const sections = model.calls
            .filter((prompt) => !prompt.includes('"summaries":'))
            .map(
                (prompt) =>
                    JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)) as {
                        text: string;
                        start: number;
                        end: number;
                        context?: string;
                    },
            );
        expect(sections.map((section) => section.text).join("")).toBe(content);
        expect(
            sections.some((section) => section.context?.includes("Metric")),
        ).toBe(true);
        for (const section of sections) {
            expect(content.slice(section.start, section.end)).toBe(
                section.text,
            );
            expect(/^[\uDC00-\uDFFF]/.test(section.text)).toBe(false);
            expect(/[\uD800-\uDBFF]$/.test(section.text)).toBe(false);
        }
    });

    test("composition rejects actual prose that drops a distant governing qualification even if evidence and the side list survive", async () => {
        const content = await readFile(
            path.join(originalFixtureRoot(), "t2", "document-020.md"),
            "utf8",
        );
        const model = new DeterministicModel(7000);
        const complete = model.complete.bind(model);
        model.complete = async (prompt) => {
            const output = JSON.parse(await complete(prompt));
            if (prompt.includes('"summaries":') && output.qualifications.length)
                output.overview =
                    "The local sample remains valid with no exclusions.";
            return JSON.stringify(output);
        };
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow(
            "dropped a supplied governing qualification or contrast",
        );
    });

    test("rejects fabricated indexed locators, out-of-section evidence and uncomposable output", async () => {
        const model = new DeterministicModel();
        model.complete = async () =>
            JSON.stringify({
                preview: "bad",
                overview: "bad",
                qualifications: [],
                contrasts: [],
                limitations: [],
                evidence: [{ start: 0, end: 3, excerpt: "not" }],
            });
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                "original",
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow("exact supplied retained");
        const tiny = new DeterministicModel(100);
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                "original",
                tiny,
                new AbortController().signal,
            ),
        ).rejects.toThrow("capacity");
    });

    test("one semantic fingerprint ignores index timestamps/generations but includes recipe, role, title and eligibility", () => {
        expect(sourceSynopsisRecipe).toBe("source-synopsis-v4");
        const hash = synopsisInputHash(source, revision, "model", true);
        const legacyV3Hash = createHash("sha256")
            .update(
                JSON.stringify([
                    "source-synopsis-v3",
                    "model",
                    true,
                    source.sourceId,
                    revision.revisionId,
                    revision.contentHash,
                    source.sourceType,
                    source.title,
                    source.canonicalUri,
                    source.tags,
                    revision.mimeType,
                    revision.capturedAt,
                    revision.sourceModifiedAt,
                    revision.pipelineVersion,
                ]),
            )
            .digest("hex");
        expect(hash).not.toBe(legacyV3Hash);
        expect(
            synopsisInputHash(
                source,
                { ...revision, indexedAt: "later" },
                "model",
                true,
            ),
        ).toBe(hash);
        for (const changed of [
            synopsisInputHash(
                { ...source, title: "renamed" },
                revision,
                "model",
                true,
            ),
            synopsisInputHash(source, revision, "different-model", true),
            synopsisInputHash(source, revision, "model", false),
            synopsisInputHash(
                { ...source, corpusId: "other" },
                revision,
                "model",
                true,
            ),
            synopsisInputHash(
                source,
                { ...revision, revisionId: "r2" },
                "model",
                true,
            ),
            synopsisInputHash(
                source,
                { ...revision, contentHash: "changed" },
                "model",
                true,
            ),
        ])
            expect(changed).not.toBe(hash);
    });
});

describe("inline synopsis production lifecycle", () => {
    let root: string;
    let service: FileMemoryService;
    let model: DeterministicModel;
    function open() {
        return new FileMemoryService(root, {
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: true,
            sourceSynopsisModel: model,
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
    }
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "source-synopsis-"));
        model = new DeterministicModel();
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function ingest(
        corpusId: string,
        content: string,
        expected?: string,
    ) {
        const result = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "worksheet",
                sourceType: "markdown",
                title: "Worksheet",
                markdown: content,
            },
            pipeline: {
                updatePolicy: "retainRevisionHistory",
                ...(expected ? { expectedActiveRevisionId: expected } : {}),
            },
        });
        for (let i = 0; i < 1000; i++) {
            const job = await service.getJob(result.jobId);
            if (job?.state === "complete") return result;
            if (job?.state === "failed") throw new Error(job.error);
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Offline ingestion did not complete");
    }
    async function synopsis(
        corpusId: string,
        status: SourceSynopsis["status"] = "ready",
    ) {
        for (let i = 0; i < 1000; i++) {
            const result = await service.getSourceSynopsis({
                corpusId,
                sourceId: "worksheet",
            });
            if (result.status === status) return result;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Synopsis did not reach ${status}`);
    }
    test("nested foreground scopes defer synopses across corpora and drain the latest revisions", async () => {
        const release = service.deferMaintenance();
        const nested = service.deferMaintenance();
        try {
            const first = await service.createCorpus("Earlier conversation");
            const second = await service.createCorpus("Later conversation");
            await ingest(
                first.corpusId,
                "# Preferences\n\nMira prefers tea before meetings.",
            );
            await ingest(
                second.corpusId,
                "# Deployment\n\nThe worker restarts after reconciliation.",
            );
            await new Promise((resolve) => setTimeout(resolve, 350));
            expect(model.calls).toEqual([]);
            expect(
                service
                    .getMaintenanceStatus()
                    .pending.filter((key) => key.endsWith(":synopsis")),
            ).toHaveLength(2);
            release();
            expect((await service.drainMaintenance()).reason).toBe("paused");
            nested();
            const settled = await service.drainMaintenance(5000);
            expect(settled.settled).toBe(true);
            expect((await synopsis(first.corpusId)).status).toBe("ready");
            expect((await synopsis(second.corpusId)).status).toBe("ready");
            expect(model.calls.length).toBeGreaterThanOrEqual(2);
        } finally {
            release();
            nested();
        }
    });
    test("actual temporal revisions persist inline with exact current identity, public previews and restart/reindex no-op", async () => {
        const corpus = await service.createCorpus("temporal");
        let previous: string | undefined;
        for (const stage of ["initial", "t1", "t2"]) {
            const content = await readFile(
                path.join(originalFixtureRoot(), stage, "document-020.md"),
                "utf8",
            );
            const result = await ingest(corpus.corpusId, content, previous);
            const detail = await synopsis(corpus.corpusId);
            expect(detail.revisionId).toBe(result.revisionId);
            expect(detail.generatedVersion).toBe(1);
            expect(detail.influenceSources).toEqual([
                { sourceId: "worksheet", revisionId: result.revisionId },
            ]);
            const listed = (
                await service.listSourcesPage({ corpusId: corpus.corpusId })
            ).items[0];
            const preview = listed.revisions.find(
                (r) => r.revisionId === result.revisionId,
            )?.synopsis;
            expect(preview?.preview).toBe(detail.preview);
            expect(preview).not.toHaveProperty("overview");
            expect(preview).not.toHaveProperty("evidence");
            if (previous)
                expect(
                    listed.revisions.find((r) => r.revisionId === previous)
                        ?.synopsis?.freshness,
                ).toBe("stale");
            const manifest = JSON.parse(
                await readFile(
                    path.join(root, corpus.corpusId, "manifest.json"),
                    "utf8",
                ),
            );
            expect(
                manifest.sources[0].revisions.find(
                    (r: SourceRevision) => r.revisionId === result.revisionId,
                ).synopsis.overview,
            ).toBe(detail.overview);
            previous = result.revisionId;
        }
        const calls = model.calls.length;
        await service.reindexCorpus(corpus.corpusId);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await service.close();
        service = open();
        await service.initialize();
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect((await synopsis(corpus.corpusId)).generatedVersion).toBe(1);
        expect(model.calls).toHaveLength(calls);
        expect(
            (
                await service.search({
                    corpusId: corpus.corpusId,
                    query: "withdrawn",
                    maxResponseChars: 100_000,
                })
            ).matches[0]?.synopsis?.status,
        ).toBe("ready");
    });

    test("failed synopsis remains explicit without blocking source search; one retry then parked across restart", async () => {
        model.complete = async (prompt) => {
            model.calls.push(prompt);
            throw new Error("offline provider failure");
        };
        const corpus = await service.createCorpus("fail");
        await ingest(corpus.corpusId, "Original searchable evidence.");
        expect((await synopsis(corpus.corpusId, "failed")).reason).toContain(
            "offline provider failure",
        );
        expect(
            (
                await service.search({
                    corpusId: corpus.corpusId,
                    query: "searchable",
                })
            ).matches,
        ).toHaveLength(1);
        await service.close();
        service = open();
        await service.initialize();
        await synopsis(corpus.corpusId, "failed");
        await new Promise((resolve) => setTimeout(resolve, 400));
        await service.close();
        service = open();
        await service.initialize();
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(model.calls).toHaveLength(2);
    });

    test("replacement rejects a late old-revision synopsis and restarts only the new semantic input", async () => {
        const originalComplete = model.complete.bind(model);
        let finish: (() => void) | undefined;
        let start: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            start = resolve;
        });
        model.complete = async (prompt) => {
            const output = await originalComplete(prompt);
            start?.();
            return new Promise<string>((resolve) => {
                finish = () => resolve(output);
            });
        };
        const corpus = await service.createCorpus("replace");
        const old = await ingest(
            corpus.corpusId,
            "Obsolete local median 38 ms.",
        );
        await started;
        await ingest(
            corpus.corpusId,
            "Current sample withdrawn after duplicated tracing.",
            old.revisionId,
        );
        model.complete = originalComplete;
        finish?.();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const current = await service.getSource(corpus.corpusId, "worksheet");
        expect(
            current?.revisions.find((r) => r.revisionId === old.revisionId)
                ?.synopsis?.status,
        ).not.toBe("ready");
        await service.close();
        service = open();
        await service.initialize();
        const output = await synopsis(corpus.corpusId);
        expect(output.overview).toContain("withdrawn");
        expect(output.overview).not.toContain("38 ms");
        expect(output.revisionId).not.toBe(old.revisionId);
    });

    test("authorized purge recovery discards an in-flight synopsis without failing shutdown", async () => {
        const complete = model.complete.bind(model);
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        model.complete = async (prompt) => {
            entered();
            await pending;
            return complete(prompt);
        };
        const corpus = await service.createCorpus("Pending purge synopsis");
        await ingest(corpus.corpusId, "Private source awaiting synopsis.");
        await started;
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            "worksheet",
        );
        const fault = import.meta.jest
            .spyOn(TypedViewStore.prototype, "markSourceRevisionStale")
            .mockRejectedValueOnce(new Error("Injected purge interruption"));
        try {
            await expect(
                service.forgetSource({
                    corpusId: corpus.corpusId,
                    sourceId: "worksheet",
                    confirmationToken: preview.confirmationToken,
                }),
            ).rejects.toThrow("Injected purge interruption");
            release();
            await expect(
                service.getSource(corpus.corpusId, "worksheet"),
            ).rejects.toThrow("pending purge recovery");
            await expect(service.close()).resolves.toBeUndefined();
        } finally {
            release();
            fault.mockRestore();
        }
        service = open();
        await expect(
            service.getSource(corpus.corpusId, "worksheet"),
        ).resolves.toBeUndefined();
    });

    test("restart recovers interrupted inline work without a new retained revision", async () => {
        const originalComplete = model.complete.bind(model);
        let start: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            start = resolve;
        });
        model.complete = async () => {
            start?.();
            return new Promise<string>(() => {});
        };
        const corpus = await service.createCorpus("restart");
        const original = await ingest(
            corpus.corpusId,
            "Original evidence retained unchanged.",
        );
        await started;
        await service.close();
        model.complete = originalComplete;
        service = open();
        await service.initialize();
        const output = await synopsis(corpus.corpusId);
        expect(output.revisionId).toBe(original.revisionId);
        expect(output.generatedVersion).toBe(1);
        expect(
            (await service.getSource(corpus.corpusId, "worksheet"))?.revisions,
        ).toHaveLength(1);
    });

    test("replacement and authorized forget reject late provider output, including read-but-not-cited influence", async () => {
        let release: ((value: string) => void) | undefined;
        let started: (() => void) | undefined;
        const waiting = new Promise<void>((resolve) => {
            started = resolve;
        });
        const originalComplete = model.complete.bind(model);
        model.complete = async (prompt) => {
            const result = await originalComplete(prompt);
            started?.();
            return new Promise<string>((resolve) => {
                release = () => resolve(result);
            });
        };
        const corpus = await service.createCorpus("forget");
        await ingest(
            corpus.corpusId,
            "Private routing exception not independently cited.",
        );
        await waiting;
        const preview = await service.previewForgetSource(
            corpus.corpusId,
            "worksheet",
        );
        await service.forgetSource({
            corpusId: corpus.corpusId,
            sourceId: "worksheet",
            confirmationToken: preview.confirmationToken,
        });
        release?.("");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(
            await service.getSource(corpus.corpusId, "worksheet"),
        ).toBeUndefined();
        await expect(
            service.getSourceSynopsis({
                corpusId: corpus.corpusId,
                sourceId: "worksheet",
            }),
        ).rejects.toThrow("Unknown retained");
        expect(
            await readFile(
                path.join(root, corpus.corpusId, "manifest.json"),
                "utf8",
            ),
        ).not.toContain("Private routing");
    });
});
