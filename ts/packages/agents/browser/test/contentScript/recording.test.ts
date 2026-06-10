// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference path="../types/jest-chrome-extensions.d.ts" />

// Mock collaborators so we can observe listener wiring without dragging in
// the real action handlers (which call chrome.runtime + take screenshots).
jest.mock("../../src/extension/contentScript/recording/actions", () => ({
    recordClick: jest.fn(),
    recordInput: jest.fn(),
    recordTextEntry: jest.fn(),
    recordNavigation: jest.fn(),
}));

jest.mock("../../src/extension/contentScript/recording/capture", () => ({
    captureUIState: jest.fn().mockResolvedValue(undefined),
    captureAnnotatedScreenshot: jest.fn().mockResolvedValue(""),
}));

jest.mock("../../src/extension/contentScript/domUtils", () => ({
    setIdsOnAllElements: jest.fn(),
}));

jest.mock("../../src/extension/contentScript/htmlUtils", () => ({
    getPageHTML: jest.fn().mockReturnValue(""),
    CompressionMode: { Automation: "automation" },
}));

let recordingModule: any;
let actionsMock: {
    recordClick: jest.Mock;
    recordInput: jest.Mock;
    recordTextEntry: jest.Mock;
    recordNavigation: jest.Mock;
};
let domUtilsMock: { setIdsOnAllElements: jest.Mock };

describe("Recording lifecycle — listener attach/detach", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        chrome.runtime.sendMessage.mockImplementation(() => Promise.resolve());

        // Reload module to reset internal state (recording flag, listener
        // attachment guard) between tests.
        jest.isolateModules(() => {
            recordingModule = require("../../src/extension/contentScript/recording");
            actionsMock = require("../../src/extension/contentScript/recording/actions");
            domUtilsMock = require("../../src/extension/contentScript/domUtils");
        });
    });

    describe("startRecording", () => {
        it("attaches click/input/keyup listeners on document", async () => {
            await recordingModule.startRecording();

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            document.dispatchEvent(new Event("input", { bubbles: true }));
            document.dispatchEvent(
                new KeyboardEvent("keyup", { bubbles: true }),
            );

            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
            expect(actionsMock.recordInput).toHaveBeenCalledTimes(1);
            expect(actionsMock.recordTextEntry).toHaveBeenCalledTimes(1);
        });

        it("stamps element IDs when recording starts", async () => {
            await recordingModule.startRecording();
            expect(domUtilsMock.setIdsOnAllElements).toHaveBeenCalledWith(0);
        });

        it("is idempotent — calling twice does not double-bind", async () => {
            await recordingModule.startRecording();
            await recordingModule.startRecording();

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
        });
    });

    describe("stopRecording", () => {
        it("detaches click/input/keyup listeners", async () => {
            await recordingModule.startRecording();
            await recordingModule.stopRecording();

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            document.dispatchEvent(new Event("input", { bubbles: true }));
            document.dispatchEvent(
                new KeyboardEvent("keyup", { bubbles: true }),
            );

            expect(actionsMock.recordClick).not.toHaveBeenCalled();
            expect(actionsMock.recordInput).not.toHaveBeenCalled();
            expect(actionsMock.recordTextEntry).not.toHaveBeenCalled();
        });

        it("detaches window navigation listeners using capture phase", async () => {
            // The pre-patch bug: window listeners were attached without a
            // capture flag (defaulting to bubble) but removed with capture:true,
            // so removeEventListener was a silent no-op. Verify the round-trip
            // now actually detaches by checking that hashchange/popstate after
            // stop do not fire recordNavigation.
            await recordingModule.startRecording();
            await recordingModule.stopRecording();

            window.dispatchEvent(new HashChangeEvent("hashchange"));
            window.dispatchEvent(new PopStateEvent("popstate"));

            expect(actionsMock.recordNavigation).not.toHaveBeenCalled();
        });
    });

    describe("restoreRecordingState — cross-page navigation path", () => {
        it("reattaches listeners when restored state has isCurrentlyRecording=true", () => {
            // Simulate fresh content script on destination page after a
            // cross-page navigation: no prior startRecording call, but the
            // service worker had persisted an active recording.
            recordingModule.restoreRecordingState({
                recordedActions: [{ id: 1, type: "click", timestamp: 0 }],
                actionIndex: 1,
                isCurrentlyRecording: true,
            });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            document.dispatchEvent(new Event("input", { bubbles: true }));

            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
            expect(actionsMock.recordInput).toHaveBeenCalledTimes(1);
        });

        it("re-stamps element IDs on the restored page", () => {
            recordingModule.restoreRecordingState({
                isCurrentlyRecording: true,
            });
            expect(domUtilsMock.setIdsOnAllElements).toHaveBeenCalledWith(0);
        });

        it("does NOT attach listeners when isCurrentlyRecording=false", () => {
            recordingModule.restoreRecordingState({
                recordedActions: [],
                actionIndex: 0,
                isCurrentlyRecording: false,
            });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(actionsMock.recordClick).not.toHaveBeenCalled();
            expect(domUtilsMock.setIdsOnAllElements).not.toHaveBeenCalled();
        });

        it("does NOT double-bind when start was already called in the same context", async () => {
            // Edge case: same content script lifetime has both startRecording
            // and a restore call (e.g. SPA route change race). The guard
            // should keep the listener count at one.
            await recordingModule.startRecording();
            recordingModule.restoreRecordingState({
                isCurrentlyRecording: true,
            });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
        });

        it("does nothing when restoredData is falsy", () => {
            expect(() =>
                recordingModule.restoreRecordingState(undefined),
            ).not.toThrow();
            expect(() =>
                recordingModule.restoreRecordingState(null),
            ).not.toThrow();

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(actionsMock.recordClick).not.toHaveBeenCalled();
        });
    });

    describe("start → stop → restore cycle", () => {
        it("supports restore after a clean stop without leaking listeners", async () => {
            await recordingModule.startRecording();
            await recordingModule.stopRecording();

            recordingModule.restoreRecordingState({
                isCurrentlyRecording: true,
            });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            // Exactly once — listeners from the stop call were detached, and
            // restore reattached a single set.
            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
        });
    });

    describe("top-frame guard (review fix — iframe leak)", () => {
        // The content script is registered with "all_frames": true, so it
        // runs in every iframe. The service worker scopes start/stop to
        // { frameId: 0 } so listener wiring must also be limited to the
        // top frame. We simulate an iframe by making window.top !== window.
        it("does NOT attach listeners in iframes when restoring an active recording", () => {
            const realTop = window.top;
            Object.defineProperty(window, "top", {
                value: {} as Window,
                configurable: true,
            });
            try {
                recordingModule.restoreRecordingState({
                    recordedActions: [],
                    actionIndex: 0,
                    isCurrentlyRecording: true,
                });

                document.dispatchEvent(
                    new MouseEvent("click", { bubbles: true }),
                );
                document.dispatchEvent(new Event("input", { bubbles: true }));

                expect(actionsMock.recordClick).not.toHaveBeenCalled();
                expect(actionsMock.recordInput).not.toHaveBeenCalled();
                // Element IDs must not be stamped in iframes either —
                // would cause id collisions across frames at frameId=0.
                expect(domUtilsMock.setIdsOnAllElements).not.toHaveBeenCalled();
            } finally {
                Object.defineProperty(window, "top", {
                    value: realTop,
                    configurable: true,
                });
            }
        });

        it("preserves the recording flag in iframes (matches pre-patch behavior)", () => {
            // Pre-patch, iframes still populated the flag from storage;
            // they just did not attach listeners. We keep that behavior so
            // any read of the flag from iframe code paths is unchanged.
            const realTop = window.top;
            Object.defineProperty(window, "top", {
                value: {} as Window,
                configurable: true,
            });
            try {
                recordingModule.restoreRecordingState({
                    recordedActions: [],
                    actionIndex: 0,
                    isCurrentlyRecording: true,
                });

                expect(recordingModule.getRecordingState().recording).toBe(
                    true,
                );
            } finally {
                Object.defineProperty(window, "top", {
                    value: realTop,
                    configurable: true,
                });
            }
        });
    });

    describe("symmetric restore (review fix — Issue 2)", () => {
        it("detaches listeners when restored state flips recording to false", async () => {
            // First, get into a state with listeners attached.
            await recordingModule.startRecording();
            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);

            // Now restore with isCurrentlyRecording=false. The previous
            // implementation would leave the listeners attached and the
            // recording flag false, so subsequent events would still fire
            // the recorders. The symmetric fix must detach.
            recordingModule.restoreRecordingState({
                recordedActions: [],
                actionIndex: 0,
                isCurrentlyRecording: false,
            });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            // Total recordClick count is still 1 — the post-restore click
            // must NOT have fired a recorder.
            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
        });
    });

    describe("setRecordingState (review fix — Issue 3)", () => {
        it("attaches listeners when flipping recording from false to true", () => {
            recordingModule.setRecordingState({ recording: true });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
        });

        it("detaches listeners when flipping recording from true to false", async () => {
            await recordingModule.startRecording();
            recordingModule.setRecordingState({ recording: false });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(actionsMock.recordClick).not.toHaveBeenCalled();
        });

        it("does not touch listeners when recording is unchanged", async () => {
            await recordingModule.startRecording();
            recordingModule.setRecordingState({ recording: true });
            recordingModule.setRecordingState({ actionIndex: 5 });

            document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            // Still exactly one binding — no double-bind from the redundant
            // setRecordingState(true) call, and no detach from the
            // unrelated actionIndex update.
            expect(actionsMock.recordClick).toHaveBeenCalledTimes(1);
        });

        it("does NOT attach listeners in iframes", () => {
            const realTop = window.top;
            Object.defineProperty(window, "top", {
                value: {} as Window,
                configurable: true,
            });
            try {
                recordingModule.setRecordingState({ recording: true });

                document.dispatchEvent(
                    new MouseEvent("click", { bubbles: true }),
                );

                expect(actionsMock.recordClick).not.toHaveBeenCalled();
            } finally {
                Object.defineProperty(window, "top", {
                    value: realTop,
                    configurable: true,
                });
            }
        });
    });
});
