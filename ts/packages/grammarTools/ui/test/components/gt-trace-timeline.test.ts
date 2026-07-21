// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fixture, html, expect, waitUntil } from "@open-wc/testing";
import type { SourceLocation } from "grammar-tools-core";
import type { GtTraceTimeline } from "../../src/gt-trace-timeline.js";
import { FixtureBackend } from "../fixture/fixtureBackend.js";

// Import to register element
import "../../src/gt-trace-timeline.js";

describe("gt-trace-timeline", () => {
    let backend: FixtureBackend;

    beforeEach(() => {
        backend = new FixtureBackend({ delayMs: 0 });
    });

    it("renders input and trace button", async () => {
        const el = await fixture<GtTraceTimeline>(
            html`<gt-trace-timeline></gt-trace-timeline>`,
        );
        const input = el.shadowRoot!.querySelector("input");
        const button = el.shadowRoot!.querySelector("button");
        expect(input).to.exist;
        expect(button).to.exist;
        expect(button!.textContent).to.include("Trace");
    });

    it("shows empty state initially", async () => {
        const el = await fixture<GtTraceTimeline>(
            html`<gt-trace-timeline></gt-trace-timeline>`,
        );
        const emptyState = el.shadowRoot!.querySelector(".empty-state");
        expect(emptyState).to.exist;
        expect(emptyState!.textContent).to.include("Enter input");
    });

    it("renders trace table after running trace", async () => {
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtTraceTimeline>(
            html`<gt-trace-timeline
                .backend=${backend}
                .grammar=${result.grammar}
                initial-input="play songs by the beatles"
            ></gt-trace-timeline>`,
        );

        // Click the Trace button
        const button = el.shadowRoot!.querySelector("button")!;
        button.click();

        await waitUntil(
            () => el.shadowRoot!.querySelector("table") !== null,
            "trace table to appear",
            { timeout: 2000 },
        );

        const rows = el.shadowRoot!.querySelectorAll("tbody tr");
        expect(rows.length).to.be.greaterThan(0);
    });

    it("renders summary bar with event counts", async () => {
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtTraceTimeline>(
            html`<gt-trace-timeline
                .backend=${backend}
                .grammar=${result.grammar}
                initial-input="test"
            ></gt-trace-timeline>`,
        );

        const button = el.shadowRoot!.querySelector("button")!;
        button.click();

        await waitUntil(
            () => el.shadowRoot!.querySelector(".summary-bar") !== null,
            "summary bar to appear",
            { timeout: 2000 },
        );

        const summary = el.shadowRoot!.querySelector(".summary-bar");
        expect(summary).to.exist;
        expect(summary!.textContent).to.include("events");
        expect(summary!.textContent).to.include("result:");
    });

    it("shows filter buttons for event kinds", async () => {
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtTraceTimeline>(
            html`<gt-trace-timeline
                .backend=${backend}
                .grammar=${result.grammar}
                initial-input="test"
            ></gt-trace-timeline>`,
        );

        const button = el.shadowRoot!.querySelector("button")!;
        button.click();

        await waitUntil(
            () => el.shadowRoot!.querySelector(".filter-bar") !== null,
            "filter bar to appear",
            { timeout: 2000 },
        );

        const filterBtns = el.shadowRoot!.querySelectorAll(".filter-btn");
        expect(filterBtns.length).to.be.greaterThan(0);
    });

    describe("display-only mode", () => {
        it("renders a stored trace with no backend and hides live controls", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");
            const trace = await backend.traceMatch(
                result.grammar,
                "play songs by the beatles",
            );

            const el = await fixture<GtTraceTimeline>(
                html`<gt-trace-timeline
                    .displayTrace=${trace}
                    .displayDebugInfo=${result.grammar.debugInfo}
                ></gt-trace-timeline>`,
            );

            // Live-mode controls are hidden.
            expect(el.shadowRoot!.querySelector("input")).to.not.exist;
            expect(el.shadowRoot!.querySelector(".options-panel")).to.not.exist;
            expect(el.shadowRoot!.querySelector(".input-row")).to.not.exist;

            // The table and summary render immediately, without clicking Trace.
            expect(el.shadowRoot!.querySelector("table")).to.exist;
            expect(el.shadowRoot!.querySelector(".summary-bar")).to.exist;
            const rows = el.shadowRoot!.querySelectorAll("tbody tr");
            expect(rows.length).to.be.greaterThan(0);
        });

        it("colors event icons via class, never inline style", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");
            const trace = await backend.traceMatch(
                result.grammar,
                "play songs by the beatles",
            );

            const el = await fixture<GtTraceTimeline>(
                html`<gt-trace-timeline
                    .displayTrace=${trace}
                    .displayDebugInfo=${result.grammar.debugInfo}
                ></gt-trace-timeline>`,
            );

            const icons =
                el.shadowRoot!.querySelectorAll<HTMLElement>(".event-icon");
            expect(icons.length).to.be.greaterThan(0);
            Array.from(icons).forEach((icon) => {
                expect(icon.getAttribute("style")).to.not.exist;
                const classes = Array.from(icon.classList) as string[];
                expect(classes.some((c) => c.startsWith("evk-"))).to.equal(
                    true,
                );
            });
        });

        it("invokes onSourceClick from a rule link in display-only mode", async () => {
            const result = await backend.loadGrammarFromFile("test.agr");
            if (!result.ok) throw new Error("load failed");
            const trace = await backend.traceMatch(
                result.grammar,
                "play songs by the beatles",
            );

            let clicked: SourceLocation | undefined;
            const el = await fixture<GtTraceTimeline>(
                html`<gt-trace-timeline
                    .displayTrace=${trace}
                    .displayDebugInfo=${result.grammar.debugInfo}
                    .onSourceClick=${(loc: SourceLocation) => {
                        clicked = loc;
                    }}
                ></gt-trace-timeline>`,
            );

            const link =
                el.shadowRoot!.querySelector<HTMLElement>(".rule-link");
            expect(link, "a rule link should render").to.exist;
            link!.click();
            expect(clicked).to.exist;
        });
    });
});
