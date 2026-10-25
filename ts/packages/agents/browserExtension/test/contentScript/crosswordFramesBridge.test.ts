// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { initializeCrosswordBridge } from "../../src/extension/contentScript/crossword/bridge";
import { CrosswordDecisionHost } from "../../src/extension/contentScript/crossword/decisionHost";

jest.mock("../../src/extension/contentScript/crossword/decisionHost", () => ({
    CrosswordDecisionHost: jest.fn(),
}));

let dispose: () => void;
let host: Record<string, jest.Mock>;
let listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: unknown) => void,
) => unknown;
beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(chrome.runtime, "id", {
        configurable: true,
        value: "extension",
    });
    (chrome.runtime.getURL as jest.Mock).mockImplementation(
        (path) => `chrome-extension://extension/${path}`,
    );
    host = {
        getMode: jest.fn(async () => ({ mode: "decision" })),
        status: jest.fn(),
        capture: jest.fn(async () => ({ snapshotId: "local" })),
        executeCaptured: jest.fn(async () => ({ text: "clue" })),
        changeMode: jest.fn(),
        invalidate: jest.fn(),
        dispose: jest.fn(),
    };
    (CrosswordDecisionHost as jest.Mock).mockImplementation(() => host);
    dispose = initializeCrosswordBridge();
    listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock
        .calls[1][0];
});
afterEach(() => {
    dispose();
    jest.restoreAllMocks();
});

test("extension-only frame capture and execution stay in the owning local host", async () => {
    const respond = jest.fn();
    expect(
        listener(
            { type: "crosswordFrameCapture" },
            { id: "extension" },
            respond,
        ),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(respond).toHaveBeenLastCalledWith({
        snapshot: { snapshotId: "local" },
    });
    const params = {
        snapshotId: "local",
        candidateId: "c0",
        configGeneration: "config",
        clueNumber: 1,
        clueDirection: "across",
    };
    listener(
        { type: "crosswordFrameRead", params },
        { id: "extension", url: "chrome-extension://extension/background.js" },
        respond,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.executeCaptured).toHaveBeenCalledWith("readClue", params);
    expect(respond).toHaveBeenLastCalledWith({ result: { text: "clue" } });
    host.executeCaptured.mockRejectedValue(new Error("stale: changed"));
    listener(
        { type: "crosswordFrameEnter", params },
        { id: "extension" },
        respond,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(respond).toHaveBeenLastCalledWith({ error: "stale: changed" });
    listener(
        { type: "crosswordFrameEnter", params: "not captured parameters" },
        { id: "extension" },
        respond,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(respond).toHaveBeenLastCalledWith({
        error: "unsupported: invalid captured crossword parameters",
    });
    expect(host.executeCaptured).toHaveBeenCalledTimes(2);
});

test("foreign extensions, page senders and other content scripts cannot invoke frame methods", () => {
    for (const sender of [
        { id: "foreign" },
        { id: "extension", tab: { id: 1 } },
        { id: "extension", url: "https://page.example/" },
    ]) {
        const respond = jest.fn();
        expect(
            listener(
                { type: "crosswordFrameCapture" },
                sender as chrome.runtime.MessageSender,
                respond,
            ),
        ).toBe(false);
        expect(respond).toHaveBeenCalledWith({
            error: expect.stringContaining("untrusted"),
        });
    }
    expect(host.capture).not.toHaveBeenCalled();
    expect(listener({ type: "unrelated" }, {}, jest.fn())).toBeUndefined();
});

test("page requests send only high-level intent and propagate coordinator errors", async () => {
    const post = jest.spyOn(window, "postMessage").mockImplementation(() => {});
    (chrome.runtime.sendMessage as jest.Mock).mockResolvedValue({
        error: "ambiguous: multiple puzzles",
    });
    window.dispatchEvent(
        new MessageEvent("message", {
            source: window,
            origin: location.origin,
            data: {
                type: "typeagent-crossword-request",
                requestId: "read",
                method: "readClue",
                params: {
                    clueNumber: 1,
                    clueDirection: "across",
                    frameId: 99,
                    selector: "body",
                    snapshotId: "spoof",
                },
            },
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "crosswordFrameAction",
        method: "readClue",
        params: { clueNumber: 1, clueDirection: "across" },
    });
    expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
            requestId: "read",
            error: "ambiguous: multiple puzzles",
        }),
        location.origin,
    );
    expect(host.capture).not.toHaveBeenCalled();
});

test("generative mode never routes, and disposal removes both runtime listeners", async () => {
    host.getMode.mockResolvedValue({ mode: "generative" });
    const post = jest.spyOn(window, "postMessage").mockImplementation(() => {});
    window.dispatchEvent(
        new MessageEvent("message", {
            source: window,
            origin: location.origin,
            data: {
                type: "typeagent-crossword-request",
                requestId: "mode",
                method: "enterText",
                params: {
                    clueNumber: 1,
                    clueDirection: "across",
                    value: "ANSWER",
                },
            },
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
            requestId: "mode",
            error: expect.stringContaining("decision mode is not selected"),
        }),
        location.origin,
    );
    dispose();
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(
        listener,
    );
});
