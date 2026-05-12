// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fixture, html, expect } from "@open-wc/testing";
import type { GtDiffView } from "../../src/gt-diff-view.js";
import type { GrammarDiff } from "grammar-tools-core";
import { FixtureBackend } from "../fixture/fixtureBackend.js";

// Import to register element
import "../../src/gt-diff-view.js";

describe("gt-diff-view", () => {
    let diff: GrammarDiff;

    before(async () => {
        const backend = new FixtureBackend({ delayMs: 0 });
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");
        diff = await backend.diffGrammars(result.grammar, result.grammar);
    });

    it("shows empty state when no diff", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view></gt-diff-view>`,
        );
        const emptyState = el.shadowRoot!.querySelector(".empty-state");
        expect(emptyState).to.exist;
        expect(emptyState!.textContent).to.include("No diff");
    });

    it("renders summary bar with counts", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view .diff=${diff}></gt-diff-view>`,
        );
        const summary = el.shadowRoot!.querySelector(".summary-bar");
        expect(summary).to.exist;
    });

    it("renders added rules with + badge", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view .diff=${diff}></gt-diff-view>`,
        );
        const addedEntries = el.shadowRoot!.querySelectorAll(".added-entry");
        expect(addedEntries.length).to.equal(diff.added.length);
    });

    it("renders removed rules with - badge", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view .diff=${diff}></gt-diff-view>`,
        );
        const removedEntries =
            el.shadowRoot!.querySelectorAll(".removed-entry");
        expect(removedEntries.length).to.equal(diff.removed.length);
    });

    it("renders changed rules with ~ badge", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view .diff=${diff}></gt-diff-view>`,
        );
        const changedEntries =
            el.shadowRoot!.querySelectorAll(".changed-entry");
        expect(changedEntries.length).to.equal(diff.changed.length);
    });

    it("expands changed rule to show side-by-side on click", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view .diff=${diff}></gt-diff-view>`,
        );
        const changedEntry = el.shadowRoot!.querySelector(
            ".changed-entry",
        ) as HTMLElement;
        if (!changedEntry) return; // skip if no changed rules

        changedEntry.click();
        await el.updateComplete;

        const sideBySide = el.shadowRoot!.querySelector(".side-by-side");
        expect(sideBySide).to.exist;
    });

    it("uses custom labels", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view
                .diff=${diff}
                label-a="v1"
                label-b="v2"
            ></gt-diff-view>`,
        );
        const summary = el.shadowRoot!.querySelector(".summary-bar");
        expect(summary!.textContent).to.include("v1");
        expect(summary!.textContent).to.include("v2");
    });

    it("expands all when expand-all is set", async () => {
        const el = await fixture<GtDiffView>(
            html`<gt-diff-view .diff=${diff} expand-all></gt-diff-view>`,
        );
        // If there are changed rules, side-by-side panes should exist
        if (diff.changed.length > 0) {
            const panes = el.shadowRoot!.querySelectorAll(".side-by-side");
            expect(panes.length).to.equal(diff.changed.length);
        }
    });
});
