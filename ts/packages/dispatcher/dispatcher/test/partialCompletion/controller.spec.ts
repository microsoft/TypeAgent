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
