// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    makeDispatcher,
    makeCompletionResult,
    createCompletionController,
} from "./helpers.js";
import type { CompletionController } from "./helpers.js";
import type { SearchMenuItem } from "agent-dispatcher/helpers/completion";

// ── Mock SearchMenu ───────────────────────────────────────────────────────────
// Minimal mock that records render() vs updatePosition() calls.

class MockSearchMenu {
    public renderCalls: { prefix: string; items: SearchMenuItem[] }[] = [];
    public updatePositionCalls: string[] = [];
    public hideCalls = 0;

    render(prefix: string, items: SearchMenuItem[]): void {
        this.renderCalls.push({ prefix, items });
    }
    updatePosition(prefix: string): void {
        this.updatePositionCalls.push(prefix);
    }
    hide(): void {
        this.hideCalls++;
    }
}

// ── Wire up the onUpdate callback the same way PartialCompletion does ─────────

function wireController(
    controller: CompletionController,
    menu: MockSearchMenu,
): { getLastGeneration: () => number; getLastPrefix: () => string } {
    let lastGeneration = -1;
    let lastPrefix = "";

    controller.setOnUpdate(() => {
        const state = controller.getCompletionState();
        if (state) {
            if (
                state.generation !== lastGeneration ||
                state.prefix !== lastPrefix
            ) {
                lastGeneration = state.generation;
                lastPrefix = state.prefix;
                menu.render(state.prefix, state.items);
            } else {
                menu.updatePosition(state.prefix);
            }
        } else {
            menu.hide();
        }
    });

    return {
        getLastGeneration: () => lastGeneration,
        getLastPrefix: () => lastPrefix,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("render vs updatePosition dispatch", () => {
    test("first update calls render", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new MockSearchMenu();
        wireController(controller, menu);

        controller.update("play", "forward");
        await Promise.resolve();

        expect(menu.renderCalls.length).toBe(1);
        expect(menu.updatePositionCalls.length).toBe(0);
    });

    test("same generation + same prefix calls updatePosition", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new MockSearchMenu();
        wireController(controller, menu);

        controller.update("play", "forward");
        await Promise.resolve();

        const rendersBefore = menu.renderCalls.length;

        // Same input — same generation, same prefix.
        controller.update("play", "forward");

        expect(menu.renderCalls.length).toBe(rendersBefore);
        expect(menu.updatePositionCalls.length).toBe(1);
    });

    test("prefix change calls render (not updatePosition)", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new MockSearchMenu();
        wireController(controller, menu);

        controller.update("play", "forward");
        await Promise.resolve();

        const rendersBefore = menu.renderCalls.length;

        // Type "s" → prefix changes from "" to "s".
        controller.update("plays", "forward");

        expect(menu.renderCalls.length).toBe(rendersBefore + 1);
        expect(menu.renderCalls[menu.renderCalls.length - 1].prefix).toBe("s");
    });

    test("sep-level transition calls render (same prefix, different generation)", async () => {
        // optionalSpace items at L0 and space items only at L1.
        const result: ReturnType<typeof makeCompletionResult> = {
            startIndex: 4,
            completions: [
                {
                    name: "opt",
                    completions: ["alpha"],
                    separatorMode: "optionalSpace",
                },
                {
                    name: "spc",
                    completions: ["beta"],
                    separatorMode: "space",
                },
            ],
            closedSet: true,
            directionSensitive: false,
            afterWildcard: "none",
        };
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new MockSearchMenu();
        wireController(controller, menu);

        controller.update("play", "forward");
        await Promise.resolve();

        // L0: prefix="", shows "alpha".
        const rendersBefore = menu.renderCalls.length;

        // Type space → D1 consume → level 0→1, generation bumps.
        // Prefix is still "" but items changed.
        controller.update("play ", "forward");

        expect(menu.renderCalls.length).toBe(rendersBefore + 1);
        const lastRender = menu.renderCalls[menu.renderCalls.length - 1];
        expect(lastRender.prefix).toBe("");
        // L1 has both optionalSpace + space items.
        const texts = lastRender.items.map((i) => i.matchText);
        expect(texts).toContain("alpha");
        expect(texts).toContain("beta");
    });

    test("hide called when completionState transitions to undefined", async () => {
        const result = makeCompletionResult(["song", "shuffle"], 4, {
            separatorMode: "optionalSpace",
        });
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new MockSearchMenu();
        wireController(controller, menu);

        // First update shows completions (optionalSpace → visible at L0).
        controller.update("play", "forward");
        await Promise.resolve();
        expect(menu.renderCalls.length).toBeGreaterThan(0);

        const hidesBefore = menu.hideCalls;

        // Diverge from anchor → re-fetch clears state → hide.
        controller.update("stop", "forward");
        expect(menu.hideCalls).toBeGreaterThan(hidesBefore);
    });

    test("no redundant hide when state is already undefined", async () => {
        const result = makeCompletionResult(["song"], 4, {
            separatorMode: "space",
        });
        const dispatcher = makeDispatcher(result);
        const controller = createCompletionController(dispatcher);
        const menu = new MockSearchMenu();
        wireController(controller, menu);

        controller.update("play", "forward");
        await Promise.resolve();

        // "play" with separatorMode "space" → deferred (state undefined).
        // State was never non-undefined, so onUpdate should not fire
        // redundantly — no hide calls.
        expect(menu.hideCalls).toBe(0);
    });
});
