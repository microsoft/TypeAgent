// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fixture, html, expect } from "@open-wc/testing";
import type { GtCoverageHeatmap } from "../../src/gt-coverage-heatmap.js";
import type { CoverageReport } from "grammar-tools-core";
import { FixtureBackend } from "../../src/fixture/fixtureBackend.js";

// Import to register element
import "../../src/gt-coverage-heatmap.js";

describe("gt-coverage-heatmap", () => {
    let report: CoverageReport;

    before(async () => {
        const backend = new FixtureBackend({ delayMs: 0 });
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");
        report = await backend.computeCoverage(result.grammar, []);
    });

    it("shows empty state when no report", async () => {
        const el = await fixture<GtCoverageHeatmap>(
            html`<gt-coverage-heatmap></gt-coverage-heatmap>`,
        );
        const emptyState = el.shadowRoot!.querySelector(".empty-state");
        expect(emptyState).to.exist;
        expect(emptyState!.textContent).to.include("No coverage report");
    });

    it("renders summary bar with totals", async () => {
        const el = await fixture<GtCoverageHeatmap>(
            html`<gt-coverage-heatmap .report=${report}></gt-coverage-heatmap>`,
        );
        const summary = el.shadowRoot!.querySelector(".summary-bar");
        expect(summary).to.exist;
        expect(summary!.textContent).to.include("rules");
        expect(summary!.textContent).to.include("parts");
    });

    it("renders a table with rule rows", async () => {
        const el = await fixture<GtCoverageHeatmap>(
            html`<gt-coverage-heatmap .report=${report}></gt-coverage-heatmap>`,
        );
        const rows = el.shadowRoot!.querySelectorAll(".rule-row");
        expect(rows.length).to.equal(report.perRule.length);
    });

    it("marks zero-hit rules with zero-hits class", async () => {
        const el = await fixture<GtCoverageHeatmap>(
            html`<gt-coverage-heatmap .report=${report}></gt-coverage-heatmap>`,
        );
        const zeroRows = el.shadowRoot!.querySelectorAll(".zero-hits");
        const zeroRules = report.perRule.filter((r) => r.hits === 0);
        expect(zeroRows.length).to.equal(zeroRules.length);
    });

    it("renders unmatched inputs section", async () => {
        const el = await fixture<GtCoverageHeatmap>(
            html`<gt-coverage-heatmap .report=${report}></gt-coverage-heatmap>`,
        );
        const section = el.shadowRoot!.querySelector(".unmatched-section");
        expect(section).to.exist;
        const items = el.shadowRoot!.querySelectorAll(".unmatched-item");
        expect(items.length).to.equal(report.unmatchedInputs.length);
    });

    it("expands rule to show parts on click", async () => {
        const el = await fixture<GtCoverageHeatmap>(
            html`<gt-coverage-heatmap .report=${report}></gt-coverage-heatmap>`,
        );
        const firstRow = el.shadowRoot!.querySelector(
            ".rule-row",
        ) as HTMLElement;
        firstRow.click();
        await el.updateComplete;

        const partRows = el.shadowRoot!.querySelectorAll(".part-row");
        expect(partRows.length).to.be.greaterThan(0);
    });

    it("sorts by column when header clicked", async () => {
        const el = await fixture<GtCoverageHeatmap>(
            html`<gt-coverage-heatmap .report=${report}></gt-coverage-heatmap>`,
        );

        // Click the "Rule" header (sort by name)
        const headers = el.shadowRoot!.querySelectorAll("th");
        const nameHeader = headers[1] as HTMLElement; // second column
        nameHeader.click();
        await el.updateComplete;

        expect(nameHeader.classList.contains("sorted")).to.be.true;
    });
});
