// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
    CompletionController,
    createCompletionController,
} from "../../src/helpers/completion/index.js";
import {
    TestSearchMenu,
    makeDispatcher,
    makeCompletionResult,
    MockDispatcher,
} from "./helpers.js";

// Create a TestSearchMenu using the controller as data provider.
// This mirrors the Shell pattern: Shell's SearchMenu wraps the controller.
function makeControllerMenu(controller: CompletionController): TestSearchMenu {
    return new TestSearchMenu(controller as any);
}

describe("CompletionController", () => {
    let menu: TestSearchMenu;
    let dispatcher: MockDispatcher;

    beforeEach(() => {
        dispatcher = makeDispatcher();
    });

    describe("with internal menu (CLI path)", () => {
        it("should create without a custom menu", () => {
            const controller = createCompletionController(dispatcher);
            expect(controller).toBeInstanceOf(CompletionController);
        });

        it("should return completions after update", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            controller.update("a");

            // Wait for the async completion fetch
            await flushPromises();

            const state = controller.getCompletionState("a");
            expect(state).toBeDefined();
            expect(state!.items.length).toBeGreaterThan(0);
            expect(state!.items.map((i) => i.selectedText)).toContain("alpha");
        });

        it("should call onUpdate callback on completion show", async () => {
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

            expect(controller.getCompletionState("a")).toBeDefined();

            controller.accept();
            expect(controller.getCompletionState("a")).toBeUndefined();
        });

        it("should return undefined state when idle", () => {
            const controller = createCompletionController(dispatcher);
            expect(controller.getCompletionState("hello")).toBeUndefined();
        });
    });

    describe("with custom menu (Shell path)", () => {
        it("should use the provided menu", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            menu = makeControllerMenu(controller);
            controller.setMenu(menu);
            controller.update("a", "forward");

            await flushPromises();

            // The custom menu should have received setChoices
            expect(menu.invalidate).toHaveBeenCalled();
        });

        it("should call dismiss for escape handling", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            menu = makeControllerMenu(controller);
            controller.setMenu(menu);
            controller.update("a", "forward");
            await flushPromises();

            // Dismiss should not throw
            controller.dismiss("a", "forward");
        });

        it("should hide without clearing session state", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            menu = makeControllerMenu(controller);
            controller.setMenu(menu);
            controller.update("a", "forward");
            await flushPromises();

            controller.hide();
            expect(menu.hide).toHaveBeenCalled();
        });
    });

    describe("getCompletionPrefix", () => {
        it("should return prefix after update", async () => {
            const result = makeCompletionResult(["alpha", "beta"], 0, {
                separatorMode: "none",
            });
            dispatcher.getCommandCompletion.mockResolvedValue(result);

            const controller = createCompletionController(dispatcher);
            menu = makeControllerMenu(controller);
            controller.setMenu(menu);
            controller.update("a", "forward");
            await flushPromises();

            const prefix = controller.getCompletionPrefix("a");
            expect(prefix).toBeDefined();
        });

        it("should return undefined when idle", () => {
            const controller = createCompletionController(dispatcher);
            menu = makeControllerMenu(controller);
            controller.setMenu(menu);
            expect(controller.getCompletionPrefix("hello")).toBeUndefined();
        });
    });
});

function flushPromises(): Promise<void> {
    // The session's completion chain has .then() handlers after
    // the dispatcher promise resolves. Multiple microtask flushes
    // ensure they all settle.
    return Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => Promise.resolve());
}
