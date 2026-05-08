// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fixture, html, expect, waitUntil } from "@open-wc/testing";
import type { GtCompletionPanel } from "../../src/gt-completion-panel.js";
import { FixtureBackend } from "../../src/fixture/fixtureBackend.js";

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
});
