// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import { assessEmptyGoldUtterance } from "../src/translationBench/synthesizer/emptyGoldUtterance.js";

describe("assessEmptyGoldUtterance deterministic shape gate", () => {
    it("accepts start-anchored pure refusals and leave-alone forms", () => {
        const fair = [
            "Don't take a screenshot of my online banking page.",
            "Leave my tabs alone.",
            "Do not open any websites right now.",
            "Don't enable Game Mode; I need to compare performance with it off.",
            "Don't pause the audiobook; let it keep playing.",
            'Don\'t deselect the photos in the "Graduation Ceremony" montage; leave the current selection unchanged.',
            "Don't reload the concert ticket page; I haven't saved my details yet.",
            "Don't cancel my passport renewal appointment on November 12.",
            "Please don't pause the audiobook; let it keep playing.",
            "Don't resume the podcast yet.",
            "Don't go forward yet; stay on this checkout page.",
            "Never open any websites right now.",
            "Hands off my browser tabs.",
            "Do nothing with my open tabs.",
            // Periods in schema.action tags must not false-split clauses.
            "Don't run browser.openWebPage right now; leave everything alone.",
            "Don't run foo.bar.baz right now; leave everything alone (0).",
        ];
        for (const u of fair) {
            const r = assessEmptyGoldUtterance(u);
            expect({ u, ...r }).toEqual({
                u,
                fair: true,
                reason: "pure refusal / leave-alone",
            });
        }
    });

    it("rejects 1k-corpus unfair empties (questions, siblings, partials)", () => {
        const unfair: Array<{ u: string; reasonSubstr: string }> = [
            {
                u: "What keyboard shortcut can I use to take a screenshot of a webpage?",
                reasonSubstr: "question",
            },
            {
                u: "Search Bing for Microsoft's current stock price.",
                reasonSubstr: "does not open as pure refusal",
            },
            {
                u: "Close the fourth tab with the weather forecast.",
                reasonSubstr: "does not open as pure refusal",
            },
            {
                u: "Don't close all tabs; just close this one.",
                reasonSubstr: "just-alternate",
            },
            {
                u: "Can you open google.com for me?",
                reasonSubstr: "question",
            },
            {
                u: "Don't open a website—just tell me whether the downtown library is open today.",
                reasonSubstr: "just-alternate",
            },
            {
                u: "Build the current Visual Studio solution, but don't start debugging it.",
                reasonSubstr: "does not open as pure refusal",
            },
            {
                u: "Don't change the editor layout; just increase the code font size.",
                reasonSubstr: "just-alternate",
            },
            {
                u: "Turn on Night Light for this reading session only—don't schedule it.",
                reasonSubstr: "does not open as pure refusal",
            },
            {
                u: "Don't list the scaffolding patterns; explain what a TypeAgent package manifest does.",
                reasonSubstr: "explanation",
            },
            {
                u: "Stop reading the current webpage.",
                reasonSubstr: "does not open as pure refusal",
            },
            {
                u: "Scroll up to the hotel comparison table near the top of the page.",
                reasonSubstr: "does not open as pure refusal",
            },
            {
                u: "Is Bluetooth currently enabled?",
                reasonSubstr: "question",
            },
            {
                u: "Keep my email tabs open, but close this webpage.",
                reasonSubstr: "does not open as pure refusal",
            },
        ];
        for (const { u, reasonSubstr } of unfair) {
            const r = assessEmptyGoldUtterance(u);
            expect(r.fair).toBe(false);
            expect(r.reason.toLowerCase()).toContain(
                reasonSubstr.toLowerCase(),
            );
        }
    });
});
