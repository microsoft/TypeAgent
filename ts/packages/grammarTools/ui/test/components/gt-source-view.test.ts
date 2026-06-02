// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fixture, html, expect } from "@open-wc/testing";
import type { GtSourceView } from "../../src/gt-source-view.js";
import { FixtureBackend } from "../fixture/fixtureBackend.js";

// Import to register element
import "../../src/gt-source-view.js";

describe("gt-source-view", () => {
    let backend: FixtureBackend;

    beforeEach(() => {
        backend = new FixtureBackend({ delayMs: 0 });
    });

    it("renders radio buttons for source modes", async () => {
        const el = await fixture<GtSourceView>(
            html`<gt-source-view></gt-source-view>`,
        );
        const radios = el.shadowRoot!.querySelectorAll('input[type="radio"]');
        // File + Agent (no live by default)
        expect(radios.length).to.be.greaterThanOrEqual(2);
    });

    it("shows file input panel by default", async () => {
        const el = await fixture<GtSourceView>(
            html`<gt-source-view .backend=${backend}></gt-source-view>`,
        );
        const textInput = el.shadowRoot!.querySelector(
            'input[type="text"]',
        ) as HTMLInputElement;
        expect(textInput).to.exist;
        expect(textInput!.placeholder).to.include(".agr");
    });

    it("shows agent dropdown when agent mode selected", async () => {
        const agents = ["player", "calendar", "email"];
        const el = await fixture<GtSourceView>(
            html`<gt-source-view
                .backend=${backend}
                .agents=${agents}
            ></gt-source-view>`,
        );

        // Switch to agent mode
        const radios = el.shadowRoot!.querySelectorAll('input[type="radio"]');
        const agentRadio = radios[1] as HTMLInputElement;
        agentRadio.click();
        await el.updateComplete;

        const select = el.shadowRoot!.querySelector("select");
        expect(select).to.exist;
        const options = select!.querySelectorAll("option");
        // +1 for the placeholder option
        expect(options.length).to.equal(agents.length + 1);
    });

    it("shows live panel when live-available is true", async () => {
        const el = await fixture<GtSourceView>(
            html`<gt-source-view
                .backend=${backend}
                live-available
            ></gt-source-view>`,
        );

        const radios = el.shadowRoot!.querySelectorAll('input[type="radio"]');
        expect(radios.length).to.equal(3); // File, Agent, Live
    });

    it("fires onLoad callback on successful load", async () => {
        let loaded = false;
        const onLoad = () => {
            loaded = true;
        };

        const el = await fixture<GtSourceView>(
            html`<gt-source-view
                .backend=${backend}
                .onLoad=${onLoad}
            ></gt-source-view>`,
        );

        // Set path and click load
        const textInput = el.shadowRoot!.querySelector(
            'input[type="text"]',
        ) as HTMLInputElement;
        textInput.value = "test.agr";
        textInput.dispatchEvent(new Event("input"));
        await el.updateComplete;

        const loadBtn = el.shadowRoot!.querySelector(
            "button:not(.secondary)",
        ) as HTMLButtonElement;
        loadBtn.click();

        // Wait for async load
        await new Promise((r) => setTimeout(r, 50));
        expect(loaded).to.be.true;
    });
});
