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
async function settle() {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}

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

test("direct source details load no inventories and original text does not wait for the synopsis", async () => {
    const originalInvoke = invoke.getMockImplementation()!;
    let resolveSource!: (value: unknown) => void;
    let resolveSynopsis!: (value: unknown) => void;
    invoke.mockImplementation((method, params) => {
        if (method === "memoryGetSource")
            return new Promise((resolve) => {
                resolveSource = resolve;
            });
        if (method === "memoryGetSourceSynopsis")
            return new Promise((resolve) => {
                resolveSynopsis = resolve;
            });
        return originalInvoke(method, params);
    });
    const pending = mounted.selectSource("source", corpus.corpusId);
    expect(document.getElementById("sourceList")?.textContent).toContain(
        "Source list not loaded",
    );
    expect(document.getElementById("sourceTitle")?.textContent).toBe(
        "Loading source...",
    );
    expect(document.getElementById("contentPreview")?.textContent).toContain(
        "Loading source details...",
    );
    expect(
        (document.getElementById("replaceSourceButton") as HTMLButtonElement)
            .disabled,
    ).toBe(true);
    resolveSource(source);
    await pending;
    expect(
        (document.getElementById("contentEditor") as HTMLTextAreaElement).value,
    ).toBe(original);
    expect(invoke.mock.calls.map(([method]) => method)).toEqual([
        "memoryGetCorpus",
        "memoryGetSource",
        "memoryGetSourceContent",
        "memoryGetSourceSynopsis",
    ]);
    expect(
        document.getElementById("sourceMetadata")?.textContent,
    ).not.toContain(synopsis.overview);
    resolveSynopsis(synopsis);
    await settle();
    expect(document.getElementById("sourceMetadata")?.textContent).toContain(
        synopsis.overview,
    );
});
test("a late source response cannot overwrite a newer source selection", async () => {
    await mounted.selectCorpus(corpus.corpusId);
    const originalInvoke = invoke.getMockImplementation()!;
    let resolveOld!: (value: unknown) => void;
    invoke.mockImplementation((method, params) => {
        if (method === "memoryGetSource")
            return params.sourceId === "source"
                ? new Promise((resolve) => {
                      resolveOld = resolve;
                  })
                : Promise.resolve({
                      ...source,
                      sourceId: "new",
                      title: "New worksheet",
                  });
        return originalInvoke(method, params);
    });
    const old = mounted.selectSource("source");
    await mounted.selectSource("new");
    resolveOld(source);
    await old;
    await settle();
    expect(document.getElementById("sourceTitle")?.textContent).toBe(
        "New worksheet",
    );
    expect(
        invoke.mock.calls
            .filter(([method]) => method === "memoryGetSourceContent")
            .map(([, params]) => params.sourceId),
    ).toEqual(["new"]);
});
test("a late original-content response cannot replace the newer source text", async () => {
    await mounted.selectCorpus(corpus.corpusId);
    const originalInvoke = invoke.getMockImplementation()!;
    let resolveContent!: (value: unknown) => void;
    invoke.mockImplementation((method, params) => {
        if (method === "memoryGetSource")
            return Promise.resolve({
                ...source,
                sourceId: params.sourceId,
                title: params.sourceId,
            });
        if (method === "memoryGetSourceContent")
            return params.sourceId === "source"
                ? new Promise((resolve) => {
                      resolveContent = resolve;
                  })
                : Promise.resolve({
                      content: "New original",
                      offset: 0,
                      totalChars: 12,
                  });
        return originalInvoke(method, params);
    });
    const old = mounted.selectSource("source");
    await settle();
    await mounted.selectSource("new");
    resolveContent({ content: "Old original", offset: 0, totalChars: 12 });
    await old;
    expect(
        (document.getElementById("contentEditor") as HTMLTextAreaElement).value,
    ).toBe("New original");
    expect(document.getElementById("sourceTitle")?.textContent).toBe("new");
});
test("leaving source details cancels late rendering and failures leave edits disabled", async () => {
    let resolveOld!: (value: unknown) => void;
    const originalInvoke = invoke.getMockImplementation()!;
    invoke.mockImplementation((method, params) =>
        method === "memoryGetSource"
            ? new Promise((resolve) => {
                  resolveOld = resolve;
              })
            : originalInvoke(method, params),
    );
    const old = mounted.selectSource("source", corpus.corpusId);
    mounted.cancelSourceSelection();
    resolveOld(source);
    await old;
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "memoryGetSourceContent",
        ),
    ).toBe(false);
    invoke.mockImplementation((method, params) =>
        method === "memoryGetSource"
            ? Promise.reject(new Error("Source unavailable"))
            : originalInvoke(method, params),
    );
    await expect(
        mounted.selectSource("source", corpus.corpusId),
    ).rejects.toThrow("Source unavailable");
    expect(document.getElementById("contentPreview")?.textContent).toContain(
        "Source details unavailable: Source unavailable",
    );
    expect(
        (document.getElementById("replaceSourceButton") as HTMLButtonElement)
            .disabled,
    ).toBe(true);
});

test("source list/detail retain original evidence and distinguish generated identity, scan and coordinates", async () => {
    await mounted.selectCorpus(corpus.corpusId);
    expect(document.getElementById("sourceList")!.textContent).toContain(
        "Local review only.",
    );
    expect(document.querySelector("img")).toBeNull();
    await mounted.selectSource("source");
    await settle();
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
    await settle();
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
