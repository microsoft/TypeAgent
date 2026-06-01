// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fixture, html, expect, waitUntil } from "@open-wc/testing";
import type { GtCompletionPanel } from "../../src/gt-completion-panel.js";
import { FixtureBackend } from "../fixture/fixtureBackend.js";

// Import to register element
import "../../src/gt-completion-panel.js";

describe("gt-completion-panel", () => {
    let backend: FixtureBackend;

    beforeEach(() => {
        backend = new FixtureBackend({ delayMs: 0 });
    });

    it("renders an input element", async () => {
        const el = await fixture<GtCompletionPanel>(
            html`<gt-completion-panel></gt-completion-panel>`,
        );
        const input = el.shadowRoot!.querySelector("input");
        expect(input).to.exist;
        expect(input!.placeholder).to.include("Type");
    });

    it("shows empty state when no input", async () => {
        const el = await fixture<GtCompletionPanel>(
            html`<gt-completion-panel></gt-completion-panel>`,
        );
        const emptyState = el.shadowRoot!.querySelector(".empty-state");
        expect(emptyState).to.exist;
        expect(emptyState!.textContent).to.include("Type to see completions");
    });

    it("shows completions after setting backend and grammar", async () => {
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtCompletionPanel>(
            html`<gt-completion-panel
                .backend=${backend}
                .grammar=${result.grammar}
                initial-input="play "
            ></gt-completion-panel>`,
        );

        // Wait for the async completion query to resolve
        await waitUntil(
            () =>
                el.shadowRoot!.querySelector(".groups") !== null ||
                el.shadowRoot!.querySelector(".completion-item") !== null,
            "completion items to appear",
            { timeout: 2000 },
        );

        const items = el.shadowRoot!.querySelectorAll(".completion-item");
        expect(items.length).to.be.greaterThan(0);
    });

    it("shows status bar with matched prefix length", async () => {
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtCompletionPanel>(
            html`<gt-completion-panel
                .backend=${backend}
                .grammar=${result.grammar}
                initial-input="play "
            ></gt-completion-panel>`,
        );

        await waitUntil(
            () => el.shadowRoot!.querySelector(".status-bar") !== null,
            "status bar to appear",
            { timeout: 2000 },
        );

        const statusBar = el.shadowRoot!.querySelector(".status-bar");
        expect(statusBar).to.exist;
        expect(statusBar!.textContent).to.include("Matched");
    });

    it("groups completions by separator mode", async () => {
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtCompletionPanel>(
            html`<gt-completion-panel
                .backend=${backend}
                .grammar=${result.grammar}
                initial-input="play songs by the beat"
            ></gt-completion-panel>`,
        );

        await waitUntil(
            () => el.shadowRoot!.querySelector(".group-header") !== null,
            "group headers to appear",
            { timeout: 2000 },
        );

        const headers = el.shadowRoot!.querySelectorAll(".group-header");
        expect(headers.length).to.be.greaterThan(0);
    });

    it("renders colored overlay behind input with matched/unmatched spans", async () => {
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtCompletionPanel>(
            html`<gt-completion-panel
                .backend=${backend}
                .grammar=${result.grammar}
                initial-input="play hello"
            ></gt-completion-panel>`,
        );

        await waitUntil(
            () => el.shadowRoot!.querySelector(".input-colors") !== null,
            "input-colors overlay to appear",
            { timeout: 2000 },
        );

        const stack = el.shadowRoot!.querySelector(".input-stack")!;
        const input = stack.querySelector("input")!;
        const colors = stack.querySelector(".input-colors")!;

        // Input should come first, colors div second (overlay behind)
        const children = Array.from(stack.children);
        expect(children.indexOf(input)).to.be.lessThan(
            children.indexOf(colors),
        );

        // Colors div should have matched span
        const matched = colors.querySelector(".matched");
        expect(matched).to.exist;
        expect(matched!.textContent!.length).to.be.greaterThan(0);

        // Input should have transparent text color (colored overlay shows through)
        const inputStyle = getComputedStyle(input);
        expect(inputStyle.color).to.satisfy(
            (c: string) =>
                c.includes("transparent") ||
                c === "rgba(0, 0, 0, 0)" ||
                c === "rgba(0,0,0,0)",
        );

        // Colors div should be absolutely positioned
        const colorsStyle = getComputedStyle(colors);
        expect(colorsStyle.position).to.equal("absolute");
        expect(colorsStyle.pointerEvents).to.equal("none");

        // The stack (position:relative) should have non-zero dimensions
        const stackRect = (stack as HTMLElement).getBoundingClientRect();
        expect(stackRect.height).to.be.greaterThan(0);
        expect(stackRect.width).to.be.greaterThan(0);

        // The colors div should have the same bounding rect as the stack
        const colorsRect = (colors as HTMLElement).getBoundingClientRect();
        expect(colorsRect.height).to.be.greaterThan(0);
        expect(colorsRect.width).to.be.greaterThan(0);

        // Input background must be transparent so colors show through
        expect(inputStyle.backgroundColor).to.satisfy(
            (c: string) =>
                c.includes("transparent") ||
                c === "rgba(0, 0, 0, 0)" ||
                c === "rgba(0,0,0,0)",
        );

        // Colors div z-index should be less than input z-index
        // (or input z-index should be positive to stack above)
        const inputZ = parseInt(inputStyle.zIndex) || 0;
        const colorsZ = parseInt(colorsStyle.zIndex) || 0;
        expect(inputZ).to.be.greaterThan(colorsZ);
    });
});
