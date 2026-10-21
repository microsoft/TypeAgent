// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getRuntimeConfig, setRuntimeConfig } from "@typeagent/aiclient";
import { buildConfig, flatten } from "@typeagent/config";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    generateSourceSynopsis,
    configuredSourceSynopsisModel,
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

class DeterministicModel implements SourceSynopsisModel {
    identity = "offline-source-synopsis";
    calls: string[] = [];
    constructor(private readonly capacity = 100_000) {}
    fits(prompt: string): boolean {
        return Buffer.byteLength(prompt) <= this.capacity;
    }
    async complete(prompt: string): Promise<string> {
        this.calls.push(prompt);
        const input = JSON.parse(
            prompt.slice(prompt.lastIndexOf("\n") + 1),
        ) as {
            text?: string;
            start: number;
            end: number;
            summaries?: {
                overview: string;
                evidence: SourceSynopsis["evidence"];
                qualifications: string[];
            }[];
        };
        if (input.summaries) {
            const selected =
                input.summaries.find((item) => item.qualifications.length) ??
                input.summaries[0];
            return JSON.stringify({
                preview: selected.overview.slice(0, 300),
                overview: selected.overview,
                evidence: selected.evidence,
                qualifications: selected.qualifications,
                contrasts: [],
                limitations: [],
            });
        }
        const text = input.text!;
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
                    start: input.start + from,
                    end: input.start + from + excerpt.length,
                    excerpt,
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
        const output = {
            preview: content,
            overview: content,
            evidence: [{ start: 0, end: content.length, excerpt: content }],
            qualifications: [],
            contrasts: [],
            limitations: [],
        };
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
        const output = await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
        );
        expect(output.coverage.method).toBe("direct");
        expect(model.calls).toHaveLength(1);
        expect(output.evidence[0].excerpt).toBe(content);
    });

    test("captured live exact quote survives incorrect model arithmetic without changing original CRLF coordinates", async () => {
        const content = (
            await readFile(
                new URL(
                    "../../test/fixtures/memoryDemo/memory-import-second-brain/content-only/baseline/document-001.md",
                    import.meta.url,
                ),
                "utf8",
            )
        )
            .replace(/\r?\n/g, "\r\n")
            .slice(0, 1024);
        const excerpt =
            "Explain checkout latency, preserve the investigation trajectory across analyst\r\nhandoffs, and establish evidence requirements for safe future diagnosis.";
        expect(content.indexOf(excerpt)).toBe(290);
        expect(content.slice(290, 443)).not.toBe(excerpt);
        const model = new DeterministicModel();
        model.complete = async () =>
            JSON.stringify({
                preview: "Retained project purpose.",
                overview: excerpt,
                qualifications: [],
                contrasts: [],
                limitations: [],
                evidence: [{ start: 290, end: 443, excerpt }],
            });
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
                start: 290,
                end: 442,
                excerpt,
            },
        ]);
    });

    test("host resolves an exact unique Unicode quote without model-generated offsets", async () => {
        const excerpt = "A 😀 qualification.";
        const content = `# Context\r\n\r\n${excerpt}\r\n`;
        const model = new DeterministicModel();
        model.complete = async () =>
            JSON.stringify({
                preview: excerpt,
                overview: excerpt,
                qualifications: [],
                contrasts: [],
                limitations: [],
                evidence: [{ excerpt }],
            });
        const output = await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
        );
        const evidence = output.evidence[0];
        expect(evidence.start).toBe(content.indexOf(excerpt));
        expect(evidence.end).toBe(evidence.start + excerpt.length);
        expect(content.slice(evidence.start, evidence.end)).toBe(excerpt);
    });

    test("ambiguous quotes require exact disambiguating original ranges", async () => {
        const excerpt = "Repeated evidence.";
        const content = `${excerpt}\r\n${excerpt}`;
        const model = new DeterministicModel();
        let evidence: Array<{ excerpt: string; start?: number; end?: number }> =
            [{ excerpt }];
        model.complete = async () =>
            JSON.stringify({
                preview: excerpt,
                overview: excerpt,
                qualifications: [],
                contrasts: [],
                limitations: [],
                evidence,
            });
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow("ambiguous");
        const start = content.lastIndexOf(excerpt);
        evidence = [{ excerpt, start, end: start + excerpt.length }];
        const output = await generateSourceSynopsis(
            source,
            revision,
            content,
            model,
            new AbortController().signal,
        );
        expect(output.evidence[0].start).toBe(start);
    });

    test("an exact quote elsewhere in the source is not evidence for an unsupplied section", async () => {
        const excerpt = "Evidence from the final section only.";
        const content = `${"Earlier context. ".repeat(600)}\n\n${excerpt}`;
        const model = new DeterministicModel(7000);
        model.complete = async () =>
            JSON.stringify({
                preview: excerpt,
                overview: excerpt,
                qualifications: [],
                contrasts: [],
                limitations: [],
                evidence: [{ excerpt }],
            });
        await expect(
            generateSourceSynopsis(
                source,
                revision,
                content,
                model,
                new AbortController().signal,
            ),
        ).rejects.toThrow("exact supplied retained");
    });

    test("composition cannot introduce an original quote absent from supplied summary evidence", async () => {
        const excerpt = "Original but not selected in any summary.";
        const content = `${"a ".repeat(500)}${excerpt}${" b".repeat(7000)}`;
        const model = new DeterministicModel(7000);
        const complete = model.complete.bind(model);
        model.complete = async (prompt) => {
            const output = JSON.parse(await complete(prompt));
            if (prompt.includes('"summaries":'))
                output.evidence = [{ excerpt }];
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
        ).rejects.toThrow("exact supplied retained");
    });

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
        const hash = synopsisInputHash(source, revision, "model", true);
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
