// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
    MemoryCenterCorpusStatus,
    MemoryCenterSource,
} from "@typeagent/browser-control-rpc/serviceTypes";
import type { SourceSynopsis } from "@typeagent/memory-service";
import { mountMemoryManagement } from "./memoryManagement";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
jest.mock("./utils/mermaidView", () => ({
    renderMermaidIn: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./utils/mathView", () => ({
    renderMathIn: jest.fn().mockResolvedValue(undefined),
}));

const invoke = invokeMemory as jest.Mock;
const corpus: MemoryCenterCorpusStatus = {
    corpusId: "offline",
    name: "Offline",
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
    status: "ready",
    documentCount: 1,
    sourceCount: 1,
    revisionCount: 1,
    readyRevisionCount: 1,
    failedRevisionCount: 0,
    activeJobCount: 0,
    indexVersion: "test",
};
const original = "Original evidence. No deployment approval.";
const synopsis: SourceSynopsis = {
    corpusId: corpus.corpusId,
    sourceId: "source",
    revisionId: "r3",
    status: "ready",
    freshness: "fresh",
    preview: "<img src=x> Local review only.",
    overview: "<script>Generated navigation only.</script>",
    generatedVersion: 7,
    recipe: "source-synopsis-v1",
    inputHash: "semantic",
    evidence: [
        {
            coordinateSpace: "retained-utf16",
            start: 0,
            end: original.length,
            excerpt: original,
        },
    ],
    influenceSources: [{ sourceId: "source", revisionId: "r3" }],
    coverage: {
        method: "source-order-sections",
        scannedChars: original.length,
        totalChars: original.length,
        sectionCount: 2,
    },
    limitations: ["Full scan does not establish exhaustive semantic fidelity."],
};
let source: MemoryCenterSource;
let mounted: ReturnType<typeof mountMemoryManagement>;

beforeEach(() => {
    document.body.innerHTML = readFileSync(
        join(
            process.cwd(),
            "src",
            "views",
            "client",
            "library",
            "memoryManagement.html",
        ),
        "utf8",
    );
    source = {
        corpusId: corpus.corpusId,
        sourceId: "source",
        sourceType: "text",
        title: "Worksheet",
        activeRevisionId: "r3",
        revisions: [
            {
                sourceId: "source",
                revisionId: "r3",
                contentHash: "original",
                mimeType: "text/plain",
                pipelineVersion: "test",
                state: "ready",
                synopsis,
            },
        ],
    };
    invoke.mockReset();
    invoke.mockImplementation(async (method: string) => {
        switch (method) {
            case "memoryGetCorpus":
                return corpus;
            case "memoryGetSource":
                return source;
            case "memoryGetSourceContent":
                return {
                    corpusId: corpus.corpusId,
                    sourceId: "source",
                    revisionId: "r3",
                    mimeType: "text/plain",
                    offset: 0,
                    content: original,
                    totalChars: original.length,
                    truncated: false,
                };
            case "memoryGetSourceSynopsis":
                return synopsis;
            case "memoryListJobs":
            case "memoryListActivity":
                return { items: [], total: 0 };
            default:
                throw new Error(`Unexpected memory operation: ${method}`);
        }
    });
    mounted = mountMemoryManagement({
        scope: () => corpus.corpusId,
        sources: async () => ({ items: [source], total: 1 }),
        changed: async () => {},
        openSource: jest.fn(),
    });
});

afterEach(() => document.body.replaceChildren());

test("source list/detail retain original evidence and distinguish generated identity, scan and coordinates", async () => {
    await mounted.selectCorpus(corpus.corpusId);
    expect(document.getElementById("sourceList")!.textContent).toContain(
        "Local review only.",
    );
    expect(document.querySelector("img")).toBeNull();
    await mounted.selectSource("source");
    expect(invoke).toHaveBeenLastCalledWith("memoryGetSourceSynopsis", {
        corpusId: corpus.corpusId,
        sourceId: "source",
        revisionId: "r3",
    });
    const metadata = document.getElementById("sourceMetadata")!.textContent!;
    expect(metadata).toContain(synopsis.overview);
    expect(metadata).toContain("Retained revision r3; generated v7");
    expect(metadata).toContain(`scanned ${original.length}/${original.length}`);
    expect(metadata).toContain("not indexed locator");
    expect(metadata).toContain(synopsis.limitations[0]);
    expect(document.querySelector("script")).toBeNull();
    expect(
        (document.getElementById("contentEditor") as HTMLTextAreaElement).value,
    ).toBe(original);
});

test("unsupported synopsis detail is explicit and does not block original source text", async () => {
    await mounted.selectCorpus(corpus.corpusId);
    invoke.mockImplementationOnce(async () => source);
    invoke.mockImplementationOnce(async () => ({
        content: original,
        offset: 0,
        totalChars: original.length,
    }));
    invoke.mockRejectedValueOnce(
        new Error("Source synopses are not supported"),
    );
    await mounted.selectSource("source");
    expect(document.getElementById("sourceMetadata")!.textContent).toContain(
        "Synopsis unavailableSource synopses are not supported",
    );
    expect(
        (document.getElementById("contentEditor") as HTMLTextAreaElement).value,
    ).toBe(original);
});

test("stale synopsis prose is never shown as the current overview or source-list preview", async () => {
    const stale: SourceSynopsis = { ...synopsis, freshness: "stale" };
    source.revisions[0].synopsis = stale;
    invoke.mockImplementation(async (method: string) => {
        if (method === "memoryGetSourceSynopsis") return stale;
        if (method === "memoryGetCorpus") return corpus;
        if (method === "memoryGetSource") return source;
        if (method === "memoryGetSourceContent")
            return {
                content: original,
                offset: 0,
                totalChars: original.length,
            };
        if (method === "memoryListJobs" || method === "memoryListActivity")
            return { items: [], total: 0 };
        throw new Error(`Unexpected memory operation: ${method}`);
    });
    await mounted.selectCorpus(corpus.corpusId);
    expect(document.getElementById("sourceList")!.textContent).toContain(
        "Synopsis ready",
    );
    expect(document.getElementById("sourceList")!.textContent).not.toContain(
        synopsis.preview,
    );
    await mounted.selectSource("source");
    expect(
        document.getElementById("sourceMetadata")!.textContent,
    ).not.toContain(synopsis.overview);
});
