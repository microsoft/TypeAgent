// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { createCompletionController } from "../../src/helpers/completion/index.js";
import { PartialCompletionSession } from "../../src/helpers/completion/session.js";
import {
    makeDispatcher,
    makeCompletionResult,
    MockDispatcher,
    flushPromises,
} from "./helpers.js";

describe("CompletionController", () => {
    let dispatcher: MockDispatcher;

    beforeEach(() => {
        dispatcher = makeDispatcher();
    });

    describe("basic lifecycle", () => {
        it("should create without options", () => {
            const controller = createCompletionController(dispatcher);
            expect(controller).toBeInstanceOf(PartialCompletionSession);
        });

        it("should return completions after update", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            controller.update("a");

            await flushPromises();

            const state = controller.getCompletionState();
            expect(state).toBeDefined();
            expect(state!.items.length).toBeGreaterThan(0);
            expect(state!.items.map((i) => i.selectedText)).toContain("alpha");
        });

        it("should call onUpdate callback on completion change", async () => {
            const onUpdate = jest.fn();
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher, {
                onUpdate,
            });
            controller.update("a");

            await flushPromises();

            expect(onUpdate).toHaveBeenCalled();
        });

        it("should clear state on accept", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            controller.update("a");
            await flushPromises();

            expect(controller.getCompletionState()).toBeDefined();

            controller.accept();
            expect(controller.getCompletionState()).toBeUndefined();
        });

        it("should return undefined state when idle", () => {
            const controller = createCompletionController(dispatcher);
            expect(controller.getCompletionState()).toBeUndefined();
        });

        it("should call dismiss for escape handling", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            controller.update("a", "forward");
            await flushPromises();

            // Dismiss should not throw
            controller.dismiss("a", "forward");
        });

        it("should hide without clearing session state", async () => {
            const onUpdate = jest.fn();
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher, {
                onUpdate,
            });
            controller.update("a", "forward");
            await flushPromises();

            onUpdate.mockClear();
            controller.hide();
            expect(onUpdate).toHaveBeenCalled();
        });
    });

    describe("show() reactivation after dismiss", () => {
        it("should reopen completions for the same input after dismiss (Ctrl+Space scenario)", async () => {
            // After dismiss, update() with the same anchor input is normally
            // suppressed via dismissAnchor. show() must clear that guard so
            // Ctrl+Space brings the menu back even with no typed change.
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            controller.update("a", "forward");
            await flushPromises();
            expect(controller.getCompletionState()).toBeDefined();

            // Dismiss with input that hasn't advanced past the anchor:
            // hide-only path, leaves anchor and dismissAnchor primed.
            controller.dismiss("a", "forward");
            expect(controller.getCompletionState()).toBeUndefined();

            // A plain update() with identical input would no-op (lastInput
            // matches and there's nothing pending); show() must force a
            // refresh that brings the menu back.
            controller.update("a", "forward");
            await flushPromises();
            expect(controller.getCompletionState()).toBeUndefined();

            controller.show("a", "forward");
            await flushPromises();
            const state = controller.getCompletionState();
            expect(state).toBeDefined();
            expect(state!.items.map((i) => i.selectedText)).toContain("alpha");
        });

        it("should refetch when dismissAnchor would otherwise suppress reopen", async () => {
            // Simulate a dismiss that triggers a refetch (input advanced past
            // the anchor with refetch policy). The follow-up fetch normally
            // suppresses reopen because dismissAnchor matches.  show()
            // should clear dismissAnchor so the next update() actually
            // re-issues a fetch and surfaces results.
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
                closedSet: false,
                afterWildcard: "all",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            controller.update("a", "forward");
            await flushPromises();
            expect(controller.getCompletionState()).toBeDefined();

            dispatcher.getCommandCompletion.mockClear();

            // show() should both clear dismissAnchor and dispatch a fresh
            // path even when input is unchanged since dismiss.
            controller.dismiss("a", "forward");
            controller.show("a", "forward");
            await flushPromises();

            expect(controller.getCompletionState()).toBeDefined();
        });
    });

    describe("setOnUpdate", () => {
        it("should replace the onUpdate callback", async () => {
            const onUpdate1 = jest.fn();
            const onUpdate2 = jest.fn();
            const result = makeCompletionResult(["alpha"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher, {
                onUpdate: onUpdate1,
            });
            controller.setOnUpdate(onUpdate2);
            controller.update("a");
            await flushPromises();

            expect(onUpdate1).not.toHaveBeenCalled();
            expect(onUpdate2).toHaveBeenCalled();
        });
    });
});
