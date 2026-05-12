// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fixture, html, expect } from "@open-wc/testing";
import type { GtRuleList } from "../../src/gt-rule-list.js";
import { FixtureBackend } from "../../src/fixture/fixtureBackend.js";

// Import to register element
import "../../src/gt-rule-list.js";

describe("gt-rule-list", () => {
    it("shows empty state when no grammar", async () => {
        const el = await fixture<GtRuleList>(
            html`<gt-rule-list></gt-rule-list>`,
        );
        const emptyState = el.shadowRoot!.querySelector(".empty-state");
        expect(emptyState).to.exist;
        expect(emptyState!.textContent).to.include("No grammar");
    });

    it("renders rule items from grammar", async () => {
        const backend = new FixtureBackend({ delayMs: 0 });
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtRuleList>(
            html`<gt-rule-list .grammar=${result.grammar}></gt-rule-list>`,
        );
        const items = el.shadowRoot!.querySelectorAll(".rule-item");
        expect(items.length).to.equal(
            result.grammar.identifiers.ruleIds.length,
        );
    });

    it("displays rule names with angle brackets", async () => {
        const backend = new FixtureBackend({ delayMs: 0 });
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtRuleList>(
            html`<gt-rule-list .grammar=${result.grammar}></gt-rule-list>`,
        );
        const firstItem = el.shadowRoot!.querySelector(".rule-name");
        expect(firstItem).to.exist;
        expect(firstItem!.textContent).to.include("<");
        expect(firstItem!.textContent).to.include(">");
    });

    it("shows location info when debugInfo is present", async () => {
        const backend = new FixtureBackend({ delayMs: 0 });
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtRuleList>(
            html`<gt-rule-list .grammar=${result.grammar}></gt-rule-list>`,
        );
        const locations = el.shadowRoot!.querySelectorAll(".rule-location");
        expect(locations.length).to.be.greaterThan(0);
    });

    it("fires onRuleClick when item is clicked", async () => {
        const backend = new FixtureBackend({ delayMs: 0 });
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        let clickedRule = "";
        const onRuleClick = (ruleId: string) => {
            clickedRule = ruleId;
        };

        const el = await fixture<GtRuleList>(
            html`<gt-rule-list
                .grammar=${result.grammar}
                .onRuleClick=${onRuleClick}
            ></gt-rule-list>`,
        );

        const firstItem = el.shadowRoot!.querySelector(
            ".rule-item",
        ) as HTMLElement;
        firstItem.click();
        expect(clickedRule).to.equal(result.grammar.identifiers.ruleIds[0]);
    });

    it("highlights selected rule", async () => {
        const backend = new FixtureBackend({ delayMs: 0 });
        const result = await backend.loadGrammarFromFile("test.agr");
        if (!result.ok) throw new Error("load failed");

        const el = await fixture<GtRuleList>(
            html`<gt-rule-list .grammar=${result.grammar}></gt-rule-list>`,
        );

        const firstItem = el.shadowRoot!.querySelector(
            ".rule-item",
        ) as HTMLElement;
        firstItem.click();
        await el.updateComplete;

        expect(firstItem.classList.contains("selected")).to.be.true;
    });
});
