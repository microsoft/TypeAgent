// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    cancelCrosswordDecisionRpc,
    forwardCrosswordDecisionRpc,
    getCrosswordRpcOrigin,
} from "../../src/extension/serviceWorker/crosswordDecisionRpc";
import { getWebSocket } from "../../src/extension/serviceWorker/websocket";
import type {
    CrosswordRpcOrigin,
    ResolveCrosswordClueRequest,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";

jest.mock("../../src/extension/serviceWorker/websocket", () => ({
    getWebSocket: jest.fn(),
}));

class Socket extends EventTarget {
    readyState = 1;
    sent: {
        source: string;
        method: string;
        params: {
            id: string;
            method: string;
            params: ResolveCrosswordClueRequest;
        };
    }[] = [];
    send(data: string) {
        this.sent.push(JSON.parse(data));
    }
    reply(id: string, result: unknown) {
        this.dispatchEvent(
            new MessageEvent("message", {
                data: JSON.stringify({
                    source: "dispatcher",
                    method: "crosswordDecision/response",
                    type: "builtInRpcResponse",
                    id,
                    result,
                }),
            }),
        );
    }
}

const origin: CrosswordRpcOrigin = {
    tabId: 7,
    frameId: 0,
    documentId: "document",
};
function request(): ResolveCrosswordClueRequest {
    return {
        origin: { tabId: 999, frameId: 999, documentId: "spoofed" },
        clueNumber: 1,
        clueDirection: "across",
        snapshot: {
            snapshotId: "s1",
            documentToken: "token",
            puzzleId: "puzzle",
            revision: 0,
            modeGeneration: 0,
            createdAt: Date.now(),
            complete: true,
            collectorVersion: 1,
            candidates: [{ id: "c1", text: "1. Clue", context: "Across" }],
        },
    };
}

function response(params: ResolveCrosswordClueRequest, candidateId = "c1") {
    const s = params.snapshot;
    return {
        snapshotId: s.snapshotId,
        documentToken: s.documentToken,
        puzzleId: s.puzzleId,
        revision: s.revision,
        modeGeneration: s.modeGeneration,
        configGeneration: "1",
        status: "resolved",
        candidateId,
    };
}

let socket: Socket;
beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.defineProperty(chrome.runtime, "id", {
        configurable: true,
        value: "test-extension",
    });
    let sequence = 0;
    Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: () => `rpc-${++sequence}`,
    });
    socket = new Socket();
    (getWebSocket as jest.Mock).mockReturnValue(socket);
});
afterEach(() => {
    socket.dispatchEvent(new Event("close"));
    jest.useRealTimers();
});

test("actual socket correlation isolates simultaneous frames/documents and overwrites spoofed origin", async () => {
    const params = request();
    const frameOrigin = {
        ...origin,
        frameId: 2,
        documentId: "iframe-document",
    };
    const first = forwardCrosswordDecisionRpc(
        "resolveCrosswordClue",
        params,
        origin,
    );
    const second = forwardCrosswordDecisionRpc(
        "resolveCrosswordClue",
        params,
        frameOrigin,
    );
    expect(socket.sent[0].params.params.origin).toEqual(origin);
    expect(socket.sent[1].params.params.origin).toEqual(frameOrigin);
    expect(socket.sent[0].source).toBe("webAgent");
    expect(socket.sent[0].params.method).toBe("resolveCrosswordClue");
    const delivered = jest.fn();
    void first.then(delivered);
    socket.reply("unrelated", response(params));
    socket.reply(socket.sent[1].params.id, response(params));
    expect((await second).candidateId).toBe("c1");
    await Promise.resolve();
    expect(delivered).not.toHaveBeenCalled();
    socket.reply(socket.sent[0].params.id, response(params));
    expect((await first).candidateId).toBe("c1");
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
});

test("stale identity, malformed replies and invented candidates cannot authorize a result", async () => {
    for (const result of [
        { ...response(request()), revision: 8 },
        { ...response(request()), documentToken: "different" },
        response(request(), "invented"),
        { ...response(request()), status: "made-up" },
        undefined,
    ]) {
        const params = request();
        const pending = forwardCrosswordDecisionRpc(
            "resolveCrosswordClue",
            params,
            origin,
        );
        socket.reply(socket.sent.at(-1)!.params.id, result);
        expect((await pending).status).not.toBe("resolved");
    }
});

test("missing origin, unavailable connection and oversized evidence do not send", async () => {
    expect(
        (await forwardCrosswordDecisionRpc("resolveCrosswordClue", request()))
            .status,
    ).toBe("unsupported");
    const oversized = request();
    oversized.snapshot.candidates[0].text = "x".repeat(65_537);
    expect(
        (
            await forwardCrosswordDecisionRpc(
                "resolveCrosswordClue",
                oversized,
                origin,
            )
        ).status,
    ).toBe("unsupported");
    (getWebSocket as jest.Mock).mockReturnValue(undefined);
    expect(
        (await forwardCrosswordDecisionRpc("getCrosswordDecisionCapabilities"))
            .available,
    ).toBe(false);
    expect(socket.sent).toHaveLength(0);
});

test("cancellation is scoped to originating document, deadline cleans listeners and late replies are discarded", async () => {
    const params = request();
    const remove = jest.spyOn(socket, "removeEventListener");
    const first = forwardCrosswordDecisionRpc(
        "resolveCrosswordClue",
        params,
        origin,
    );
    const secondOrigin = {
        ...origin,
        frameId: 2,
        documentId: "other-document",
    };
    const second = forwardCrosswordDecisionRpc(
        "resolveCrosswordClue",
        params,
        secondOrigin,
    );
    cancelCrosswordDecisionRpc({ ...origin, documentId: "spoofed" });
    expect(socket.sent).toHaveLength(2);
    cancelCrosswordDecisionRpc(origin, "s1");
    expect((await first).status).toBe("cancelled");
    expect(socket.sent.at(-1)!.params.method).toBe("cancelCrosswordDecision");
    socket.reply(socket.sent[0].params.id, response(params));
    jest.advanceTimersByTime(60_000);
    expect((await second).status).toBe("cancelled");
    expect(remove).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
});

test("socket disconnect settles pending requests without waiting for deadline", async () => {
    const pending = forwardCrosswordDecisionRpc(
        "resolveCrosswordClue",
        request(),
        origin,
    );
    socket.dispatchEvent(new Event("close"));
    expect((await pending).status).toBe("unavailable");
    expect(jest.getTimerCount()).toBe(0);
});

test("capabilities are correlated without inference requests and strip arbitrary server fields", async () => {
    const pending = forwardCrosswordDecisionRpc(
        "getCrosswordDecisionCapabilities",
    );
    expect(socket.sent[0].params.method).toBe(
        "getCrosswordDecisionCapabilities",
    );
    socket.reply(socket.sent[0].params.id, {
        available: true,
        provider: "azure",
        model: "native-decision",
        configGeneration: "1",
        arbitraryUrl: "https://example.com",
        answer: "ignored",
    });
    expect(await pending).toEqual({
        available: true,
        provider: "azure",
        model: "native-decision",
        configGeneration: "1",
    });
});

test("trusted origin requires sender document/frame identity and existing host permissions", async () => {
    Object.defineProperty(chrome, "permissions", {
        configurable: true,
        value: { contains: jest.fn() },
    });
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(true);
    const sender = {
        id: chrome.runtime.id,
        tab: { id: 7 },
        frameId: 2,
        documentId: "iframe-document",
        url: "https://crossword.example/puzzle",
    } as chrome.runtime.MessageSender;
    expect(await getCrosswordRpcOrigin(sender)).toEqual({
        tabId: 7,
        frameId: 2,
        documentId: "iframe-document",
    });
    expect(chrome.permissions.contains).toHaveBeenCalledWith({
        origins: ["https://crossword.example/*"],
    });
    for (const invalid of [
        { ...sender, id: "different-extension" },
        { ...sender, documentId: undefined },
        { ...sender, frameId: undefined },
        { ...sender, documentLifecycle: "cached" },
        { ...sender, url: "about:blank" },
    ]) {
        expect(await getCrosswordRpcOrigin(invalid)).toBeUndefined();
    }
    (chrome.permissions.contains as jest.Mock).mockResolvedValue(false);
    expect(await getCrosswordRpcOrigin(sender)).toBeUndefined();
});
