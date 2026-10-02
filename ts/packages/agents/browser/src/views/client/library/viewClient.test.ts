// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    invokeMemory,
    invokeView,
    onViewEvent,
    connectViewEvents,
} from "./viewClient";
import { ViewService } from "./knowledgeUtilities";

class FakeEventSource extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    static current: FakeEventSource;
    close = jest.fn();
    constructor(public url: string) {
        super();
        FakeEventSource.current = this;
    }
}

const fetchMock = jest.fn();
function respond(data: unknown): void {
    fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data }),
    });
}

beforeEach(() => {
    Object.assign(globalThis, {
        fetch: fetchMock,
        EventSource: FakeEventSource,
    });
    fetchMock.mockReset();
});

afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    document.body.innerHTML = "";
});

test("HTTP invokes use direct typed parameters and unwrap the view envelope", async () => {
    respond({ items: [], total: 0 });
    await expect(
        invokeMemory("memoryListSources", { corpusId: "corpus" }),
    ).resolves.toEqual({ items: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
        "/api/views/invoke",
        expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
                method: "memoryListSources",
                params: { corpusId: "corpus" },
            }),
        }),
    );
});

test("HTTP and transport errors are explicit", async () => {
    fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
            success: false,
            error: "View agent disconnected",
        }),
    });
    await expect(invokeView("getLibraryStats")).rejects.toThrow(
        "View agent disconnected",
    );
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(invokeView("getLibraryStats")).rejects.toThrow(
        "Browser view service is unavailable",
    );
});

test("automation operations use the HTTP API with typed parameters", async () => {
    respond({ items: [], providers: [] });
    await expect(invokeView("listAutomations")).resolves.toEqual({
        items: [],
        providers: [],
    });
    respond({ success: true });
    await invokeView("deleteAutomation", { id: "toolMacro:m1" });
    expect(fetchMock.mock.calls[1][1].body).toBe(
        JSON.stringify({
            method: "deleteAutomation",
            params: { id: "toolMacro:m1" },
        }),
    );
});

test("search adapts agent results without losing filters, scores or enhancements", async () => {
    const service = new ViewService();
    respond({
        websites: [
            {
                url: "https://example.org",
                title: "Example",
                domain: "example.org",
                source: "history",
                relevanceScore: 0.9,
            },
        ],
        answer: "Found it",
        answerSources: [],
        relatedEntities: [],
        topTopics: ["topic"],
        answerEnhancement: { marker: true },
    });
    const filters = { domain: "example.org", dateFrom: "2026-01-01" };
    const result = await service.searchWebMemories("example", filters);
    expect(result.summary.text).toBe("Found it");
    expect(result.websites[0].score).toBe(0.9);
    expect(result.answerEnhancement).toEqual({ marker: true });
    expect(result.filters).toEqual(filters);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).params.domain).toBe(
        "example.org",
    );
});

test("SSE import progress is normalized, filtered and removed on cleanup", async () => {
    const service = new ViewService();
    const callback = jest.fn();
    service.onImportProgress("mine", callback);
    FakeEventSource.current.dispatchEvent(new Event("open"));
    await connectViewEvents();
    const progress = {
        importId: "mine",
        phase: "processing",
        current: 2,
        total: 4,
        description: "Reading",
    };
    FakeEventSource.current.dispatchEvent(
        new MessageEvent("message", {
            data: JSON.stringify({ type: "importProgress", data: progress }),
        }),
    );
    expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
            processedItems: 2,
            totalItems: 4,
            importId: "mine",
        }),
    );
    service.removeImportProgress("mine");
    FakeEventSource.current.dispatchEvent(
        new MessageEvent("message", {
            data: JSON.stringify({ type: "importProgress", data: progress }),
        }),
    );
    expect(callback).toHaveBeenCalledTimes(1);
});

test("knowledge extraction events use the same SSE transport", async () => {
    const callback = jest.fn();
    const remove = onViewEvent("knowledgeExtractionProgress", callback);
    FakeEventSource.current.dispatchEvent(new Event("open"));
    await connectViewEvents();
    FakeEventSource.current.dispatchEvent(
        new MessageEvent("message", {
            data: JSON.stringify({
                type: "knowledgeExtractionProgress",
                data: { extractionId: "extract", phase: "complete" },
            }),
        }),
    );
    expect(callback).toHaveBeenCalledWith({
        extractionId: "extract",
        phase: "complete",
    });

    remove();
});

test("SSE readiness recovers after both startup and later disconnections", async () => {
    const pending = connectViewEvents();
    const source = FakeEventSource.current;
    source.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow(/reconnect automatically/);
    const reconnected = connectViewEvents();
    expect(FakeEventSource.current).toBe(source);
    source.dispatchEvent(new Event("open"));
    await reconnected;
    source.dispatchEvent(new Event("error"));
    const restarted = connectViewEvents();
    source.dispatchEvent(new Event("open"));
    await expect(restarted).resolves.toBeUndefined();
});

test("folder imports subscribe before invoking and send nested typed options", async () => {
    const service = new ViewService();
    respond({ success: true, itemCount: 1 });
    const pending = service.importHtmlFolder(
        "C:\\library",
        { folderPath: "C:\\library", mode: "content", recursive: true },
        "import-1",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    FakeEventSource.current.dispatchEvent(new Event("open"));
    await pending;
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        method: "importHtmlFolder",
        params: {
            folderPath: "C:\\library",
            importId: "import-1",
            options: { mode: "content", recursive: true },
        },
    });
});

test("unsupported cancellation fails visibly rather than reporting success", async () => {
    respond({
        success: false,
        cancelled: false,
        error: "Cancellation unavailable",
    });
    await expect(new ViewService().cancelImport("import-1")).rejects.toThrow(
        "Cancellation unavailable",
    );
});
