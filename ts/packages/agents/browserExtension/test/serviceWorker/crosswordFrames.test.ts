// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { routeCrosswordFrameAction } from "../../src/extension/serviceWorker/crosswordFrames";
import {
    forwardCrosswordDecisionRpc,
    cancelCrosswordDecisionRpc,
    getCrosswordRpcOrigin,
} from "../../src/extension/serviceWorker/crosswordDecisionRpc";
import {
    getCrosswordMode,
    getCrosswordDecisionStrategy,
} from "../../src/extension/serviceWorker/storage";
import {
    CROSSWORD_DECISION_LIMITS as limits,
    type CrosswordSnapshot,
    type ResolveCrosswordClueRequest,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";

jest.mock("../../src/extension/serviceWorker/crosswordDecisionRpc", () => ({
    forwardCrosswordDecisionRpc: jest.fn(),
    cancelCrosswordDecisionRpc: jest.fn(),
    getCrosswordRpcOrigin: jest.fn(),
}));
jest.mock("../../src/extension/serviceWorker/storage", () => ({
    getCrosswordMode: jest.fn(),
    getCrosswordDecisionStrategy: jest.fn(),
}));

const origin = { tabId: 7, frameId: 0, documentId: "top-document" };
const sender = {} as chrome.runtime.MessageSender;
const read = {
    type: "crosswordFrameAction",
    method: "readClue",
    params: { clueNumber: 1, clueDirection: "across" },
};
const enter = {
    ...read,
    method: "enterText",
    params: { ...read.params, value: "ANSWER" },
};
let frames: { frameId: number; documentId: string; url: string }[];
let snapshots: Map<number, CrosswordSnapshot>;
let committed: (event: { tabId: number; frameId: number }) => void;
let changed: () => void;
let config: string;
let requests: ResolveCrosswordClueRequest[];
let resolve: (request: ResolveCrosswordClueRequest) => Promise<unknown>;
let executed: { frameId: number; message: any; documentId?: string }[];

function snapshot(frame: number, texts: string[]): CrosswordSnapshot {
    return {
        snapshotId: `snapshot-${frame}`,
        documentToken: `document-${frame}`,
        puzzleId: `puzzle-${frame}`,
        revision: 0,
        modeGeneration: 1,
        createdAt: Date.now(),
        collectorVersion: 2,
        complete: true,
        candidates: texts.map((text, i) => ({
            id: `c${i}`,
            text,
            context: "Across",
            regionId: "region",
            scopeId: "scope",
        })),
    };
}

function accepted(request: ResolveCrosswordClueRequest) {
    return {
        snapshotId: request.snapshot.snapshotId,
        documentToken: request.snapshot.documentToken,
        puzzleId: request.snapshot.puzzleId,
        revision: request.snapshot.revision,
        modeGeneration: request.snapshot.modeGeneration,
        configGeneration: config,
        status: "resolved",
        candidateId:
            request.snapshot.candidates.find((candidate) =>
                candidate.text.startsWith(`${request.clueNumber}. `),
            )?.id ?? request.snapshot.candidates.at(-1)?.id,
    };
}

beforeAll(() => {
    Object.assign(chrome, {
        permissions: { contains: jest.fn() },
        webNavigation: {
            getAllFrames: jest.fn(),
            onCommitted: {
                addListener: jest.fn((listener) => {
                    committed = listener;
                }),
            },
        },
    });
    (chrome.tabs.onRemoved.addListener as jest.Mock).mockImplementation(
        () => {},
    );
    (chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
        (listener) => {
            changed = listener;
        },
    );
    Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: require("node:crypto").randomUUID,
    });
});

beforeEach(() => {
    committed?.({ tabId: origin.tabId, frameId: 0 });
    jest.clearAllMocks();
    frames = [
        {
            frameId: 0,
            documentId: origin.documentId,
            url: "https://news.example/story",
        },
        {
            frameId: 4,
            documentId: "child-document",
            url: "https://puzzle.example/embed",
        },
    ];
    snapshots = new Map([
        [0, snapshot(0, [])],
        [4, snapshot(4, ["1. A clue in the embedded puzzle"])],
    ]);
    config = "config-1";
    requests = [];
    executed = [];
    resolve = async (request) => accepted(request);
    (getCrosswordRpcOrigin as jest.Mock).mockResolvedValue(origin);
    (getCrosswordMode as jest.Mock).mockResolvedValue("decision");
    (getCrosswordDecisionStrategy as jest.Mock).mockResolvedValue("hybrid");
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);
    (chrome.webNavigation.getAllFrames as jest.Mock).mockImplementation(
        async () => structuredFrames(),
    );
    (forwardCrosswordDecisionRpc as jest.Mock).mockImplementation(
        async (method: string, request: ResolveCrosswordClueRequest) => {
            if (method === "getCrosswordDecisionCapabilities")
                return { available: true, configGeneration: config };
            requests.push(request);
            return resolve(request);
        },
    );
    (chrome.tabs.sendMessage as jest.Mock).mockImplementation(
        async (_tabId, message, options) => {
            if (
                options.documentId !==
                frames.find((frame) => frame.frameId === options.frameId)
                    ?.documentId
            )
                throw new Error("stale: owning frame document changed");
            if (message.type === "crosswordFrameCapture")
                return {
                    snapshot: JSON.parse(
                        JSON.stringify(snapshots.get(options.frameId)),
                    ),
                };
            if (
                message.params.snapshotId !==
                snapshots.get(options.frameId)?.snapshotId
            )
                return { error: "stale: captured crossword target changed" };
            executed.push({ ...options, message });
            return {
                result:
                    message.type === "crosswordFrameRead"
                        ? { text: "child clue" }
                        : { entered: true },
            };
        },
    );
});

function structuredFrames() {
    return frames.map((frame) => ({ ...frame }));
}

test("unrelated parent plus clue child routes selected read/entry to owning document only", async () => {
    expect(await routeCrosswordFrameAction(read, sender)).toEqual({
        result: { text: "child clue" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].snapshot.candidates).toHaveLength(1);
    expect(requests[0].snapshot).toMatchObject({
        complete: true,
        collectorVersion: 2,
    });
    expect(executed).toEqual([
        expect.objectContaining({
            frameId: 4,
            documentId: "child-document",
            message: {
                type: "crosswordFrameRead",
                params: {
                    ...read.params,
                    snapshotId: "snapshot-4",
                    candidateId: "c0",
                    configGeneration: config,
                },
            },
        }),
    ]);
    await routeCrosswordFrameAction(enter, sender);
    expect(requests).toHaveLength(1);
    expect(executed[1].message.type).toBe("crosswordFrameEnter");
    expect(executed[1].message.params.value).toBe("ANSWER");
});

test("warm accepted inventory cache preserves inference, not a stale target or entry replay", async () => {
    await routeCrosswordFrameAction(read, sender);
    await routeCrosswordFrameAction(read, sender);
    expect(requests).toHaveLength(1);
    expect(executed).toHaveLength(2);
    expect(
        (chrome.tabs.sendMessage as jest.Mock).mock.calls.filter(
            ([, message]) => message.type === "crosswordFrameCapture",
        ),
    ).toHaveLength(4);
    snapshots.get(4)!.revision++;
    snapshots.get(4)!.snapshotId = "updated";
    await routeCrosswordFrameAction(read, sender);
    expect(requests).toHaveLength(2);
});

test("Hybrid2 reuses the same merged snapshot for different read and entry targets", async () => {
    (getCrosswordDecisionStrategy as jest.Mock).mockResolvedValue("hybrid2");
    snapshots.set(
        4,
        snapshot(4, ["1. First clue", "2. Second clue", "3. Third clue"]),
    );
    await routeCrosswordFrameAction(read, sender);
    await routeCrosswordFrameAction(
        {
            ...enter,
            params: { ...enter.params, clueNumber: 2 },
        },
        sender,
    );
    await routeCrosswordFrameAction(
        {
            ...read,
            params: { ...read.params, clueNumber: 3 },
        },
        sender,
    );
    expect(requests).toHaveLength(3);
    expect(
        new Set(requests.map((request) => request.snapshot.snapshotId)).size,
    ).toBe(1);
    expect(requests.every((request) => request.strategy === "hybrid2")).toBe(
        true,
    );
    expect(executed.map((entry) => entry.message.type)).toEqual([
        "crosswordFrameRead",
        "crosswordFrameEnter",
        "crosswordFrameRead",
    ]);
    expect(executed[1].message.params.candidateId).toBe("c1");
    snapshots.get(4)!.revision++;
    await routeCrosswordFrameAction(read, sender);
    expect(requests[3].snapshot.snapshotId).not.toBe(
        requests[0].snapshot.snapshotId,
    );
});

test("Hybrid2 merged discovery context is discarded after settings and document changes", async () => {
    (getCrosswordDecisionStrategy as jest.Mock).mockResolvedValue("hybrid2");
    await routeCrosswordFrameAction(read, sender);
    changed();
    await routeCrosswordFrameAction(read, sender);
    expect(requests[1].snapshot.snapshotId).not.toBe(
        requests[0].snapshot.snapshotId,
    );
    frames[1].documentId = "new-child-document";
    await routeCrosswordFrameAction(read, sender);
    expect(requests[2].snapshot.snapshotId).not.toBe(
        requests[1].snapshot.snapshotId,
    );
    (getCrosswordDecisionStrategy as jest.Mock).mockResolvedValue("hybrid");
    await routeCrosswordFrameAction(read, sender);
    expect(requests[3].strategy).toBe("hybrid");
    expect(requests[3].snapshot.snapshotId).not.toBe(
        requests[2].snapshot.snapshotId,
    );
});

test("identical local scope IDs in separate frames remain distinct; ambiguity never types", async () => {
    snapshots.set(0, snapshot(0, ["1. Parent puzzle clue"]));
    resolve = async (request) => ({
        ...accepted(request),
        status: "ambiguous",
        message: "requested clue identity exists in multiple puzzles",
    });
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "ambiguous",
    );
    const candidates = requests[0].snapshot.candidates;
    expect(candidates[0].scopeId).not.toBe(candidates[1].scopeId);
    expect(candidates[0].regionId).not.toBe(candidates[1].regionId);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(2);
    expect(executed).toHaveLength(0);
});

test("the coordinator routes an issued model choice without a second semantic puzzle veto", async () => {
    snapshots.set(0, snapshot(0, ["1. A clue in the embedded puzzle"]));
    await routeCrosswordFrameAction(read, sender);
    expect(requests[0].snapshot.candidates).toHaveLength(2);
    expect(executed).toHaveLength(1);
    expect(executed[0].frameId).toBe(0);
});

test("the coordinator trusts model semantics even when labels are not parsed by the host", async () => {
    snapshots.get(4)!.candidates[0].text = "2. Wrong requested identity";
    await routeCrosswordFrameAction(read, sender);
    expect(executed).toHaveLength(1);
});

test("missing frame context is explicitly incomplete, not no_fit or a partial resolve", async () => {
    (chrome.tabs.sendMessage as jest.Mock).mockImplementation(
        async (_tab, _message, { frameId }) => {
            if (frameId === 4) throw new Error("Receiving end does not exist");
            return { snapshot: snapshots.get(0) };
        },
    );
    await expect(routeCrosswordFrameAction(read, sender)).rejects.toThrow(
        "incomplete",
    );
    expect(requests).toHaveLength(0);
    expect(executed).toHaveLength(0);
});

test("inaccessible frame is incomplete without expanding permissions or injecting", async () => {
    (chrome.permissions.contains as jest.Mock).mockImplementation(
        async ({ origins }) => !origins[0].includes("puzzle.example"),
    );
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "inaccessible frame",
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(executed).toHaveLength(0);
});

test("frame navigation during inference discards late accepted result", async () => {
    resolve = async (request) => {
        frames[1].documentId = "replacement-document";
        return accepted(request);
    };
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "stale",
    );
    expect(executed).toHaveLength(0);
});

test("top navigation cancellation cancels the original snapshot and ignores late resolve", async () => {
    resolve = async (request) => {
        committed({ tabId: origin.tabId, frameId: 0 });
        return accepted(request);
    };
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "cancelled",
    );
    expect(cancelCrosswordDecisionRpc).toHaveBeenCalledWith(
        origin,
        requests[0].snapshot.snapshotId,
    );
    expect(executed).toHaveLength(0);
});

test("owning host rejects a sentinel-invalidated snapshot before execution", async () => {
    resolve = async (request) => {
        snapshots.get(4)!.revision++;
        snapshots.get(4)!.snapshotId = "sentinel-invalidated";
        return accepted(request);
    };
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "stale",
    );
    expect(executed).toHaveLength(0);
});

test("unrelated frame insertion and child navigation do not veto an issued target", async () => {
    resolve = async (request) => {
        frames.push({
            frameId: 8,
            documentId: "publisher-widget",
            url: "https://news.example/widget",
        });
        committed({ tabId: origin.tabId, frameId: 8 });
        return accepted(request);
    };
    await expect(routeCrosswordFrameAction(read, sender)).resolves.toEqual({
        result: { text: "child clue" },
    });
    expect(requests).toHaveLength(1);
    expect(executed).toHaveLength(1);
    expect(executed[0].documentId).toBe("child-document");
    expect(cancelCrosswordDecisionRpc).not.toHaveBeenCalled();
});

test("config changes and mode changes discard late results and warm cache", async () => {
    await routeCrosswordFrameAction(read, sender);
    changed();
    await routeCrosswordFrameAction(read, sender);
    expect(requests).toHaveLength(2);
    config = "config-2";
    await routeCrosswordFrameAction(read, sender);
    expect(requests).toHaveLength(3);
    snapshots.set(
        4,
        snapshot(4, ["1. A clue in the embedded puzzle", "2. Another clue"]),
    );
    resolve = async (request) => {
        config = "config-3";
        return { ...accepted(request), configGeneration: "config-2" };
    };
    await expect(
        routeCrosswordFrameAction(
            { ...read, params: { ...read.params, clueNumber: 2 } },
            sender,
        ),
    ).rejects.toThrow("configuration changed");
    (getCrosswordMode as jest.Mock).mockResolvedValue("generative");
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "decision mode",
    );
});

test("foreign ID, wrong snapshot or non-resolved status never executes", async () => {
    for (const override of [
        { status: "ambiguous" },
        { candidateId: "foreign" },
        { snapshotId: "foreign" },
    ]) {
        resolve = async (request) => ({ ...accepted(request), ...override });
        await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
            override.status ?? "unsupported",
        );
    }
    resolve = async (request) => ({
        ...accepted(request),
        status: "unsupported",
        message: "full-evidence decision call budget exceeded",
    });
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "unsupported: full-evidence decision call budget exceeded",
    );
    expect(executed).toHaveLength(0);
});

test("failed entry response is explicit and never retried or replayed", async () => {
    const original = (
        chrome.tabs.sendMessage as jest.Mock
    ).getMockImplementation()!;
    (chrome.tabs.sendMessage as jest.Mock).mockImplementation(
        async (...args) => {
            const [, message] = args;
            if (message.type === "crosswordFrameEnter") {
                executed.push({ frameId: 4, message });
                throw new Error("reply lost after write");
            }
            return original(...args);
        },
    );
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "reply lost",
    );
    expect(executed).toHaveLength(1);
    expect(requests).toHaveLength(1);
});

test("one overall timeout cancels the pending snapshot without a late entry", async () => {
    jest.useFakeTimers();
    let finish!: (value: unknown) => void;
    resolve = () =>
        new Promise((resolve) => {
            finish = resolve;
        });
    const pending = routeCrosswordFrameAction(enter, sender);
    const assertion = expect(pending).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(limits.timeoutMs);
    await assertion;
    expect(cancelCrosswordDecisionRpc).toHaveBeenCalledWith(
        origin,
        requests[0].snapshot.snapshotId,
    );
    finish(accepted(requests[0]));
    await jest.advanceTimersByTimeAsync(0);
    expect(executed).toHaveLength(0);
    jest.useRealTimers();
});

test("only trusted top frames and strictly bounded high-level identities can route", async () => {
    (getCrosswordRpcOrigin as jest.Mock).mockResolvedValue({
        ...origin,
        frameId: 4,
    });
    await expect(routeCrosswordFrameAction(read, sender)).rejects.toThrow(
        "trusted top",
    );
    (getCrosswordRpcOrigin as jest.Mock).mockResolvedValue(undefined);
    await expect(routeCrosswordFrameAction(read, sender)).rejects.toThrow(
        "trusted top",
    );
    (getCrosswordRpcOrigin as jest.Mock).mockResolvedValue(origin);
    for (const params of [
        { ...read.params, frameId: 4 },
        { ...read.params, clueNumber: 0 },
        { ...read.params, clueNumber: 10000 },
        { ...read.params, clueDirection: "ACROSS" },
    ])
        await expect(
            routeCrosswordFrameAction({ ...read, params }, sender),
        ).rejects.toThrow("parameters");
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

test("more than sixteen frames and aggregate candidate overflow reject complete discovery", async () => {
    frames = Array.from({ length: 17 }, (_, frameId) => ({
        frameId,
        documentId: frameId === 0 ? origin.documentId : `doc-${frameId}`,
        url: "https://puzzle.example/embed",
    }));
    await expect(routeCrosswordFrameAction(read, sender)).rejects.toThrow(
        "frame bound",
    );
    frames = frames.slice(0, 2);
    snapshots = new Map([
        [0, snapshot(0, Array(1025).fill("1. clue"))],
        [1, snapshot(1, Array(1025).fill("1. clue"))],
    ]);
    await expect(routeCrosswordFrameAction(read, sender)).rejects.toThrow(
        "evidence bound",
    );
    expect(requests).toHaveLength(0);
});

test("aggregate UTF-8 evidence byte overflow is incomplete, never truncated", async () => {
    for (const frame of [0, 4]) {
        const item = snapshot(frame, Array(1024).fill("界".repeat(180)));
        item.candidates.forEach((candidate) => {
            candidate.text = "界".repeat(170);
            candidate.context = "界".repeat(170);
        });
        snapshots.set(frame, item);
    }
    await expect(routeCrosswordFrameAction(enter, sender)).rejects.toThrow(
        "evidence bound",
    );
    expect(requests).toHaveLength(0);
    expect(executed).toHaveLength(0);
});

test("warm binding cache evicts beyond its 128 accepted identity bound", async () => {
    snapshots.set(
        4,
        snapshot(
            4,
            Array.from({ length: 129 }, (_, i) => `${i + 1}. Clue ${i + 1}`),
        ),
    );
    for (let clueNumber = 1; clueNumber <= 129; clueNumber++)
        await routeCrosswordFrameAction(
            { ...read, params: { ...read.params, clueNumber } },
            sender,
        );
    expect(requests).toHaveLength(129);
    await routeCrosswordFrameAction(read, sender);
    expect(requests).toHaveLength(130);
});
