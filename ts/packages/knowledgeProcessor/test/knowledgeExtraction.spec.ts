// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { success } from "typechat";
import {
    createKnowledgeExtractor,
    dateAnchorQuoteRejection,
} from "../src/conversation/knowledge.js";

const text = "Launch was 2024-05-01. Review was 2024-05-01.";
const knowledge = {
    entities: [],
    actions: [],
    inverseActions: [],
    topics: [],
};
const anchor = {
    quote: "Launch was 2024-05-01.",
    date: "2024-05-01",
    role: "eventTime" as const,
};

describe("source-grounded date annotations", () => {
    test.each([
        ["", "empty-quote"],
        ["Launch was 2024-05-02.", "quote-not-found"],
        ["2024-05-01", "ambiguous-quote"],
        ["Launch was", "date-not-in-quote"],
        [anchor.quote, undefined],
    ])(
        "classifies quote %s without retaining source payloads",
        (quote, reason) => {
            expect(dateAnchorQuoteRejection(text, { ...anchor, quote })).toBe(
                reason,
            );
        },
    );

    test("optional annotations reach the temporal grounding boundary without failing valid knowledge", async () => {
        const response = {
            ...knowledge,
            dateAnchors: [{ ...anchor, quote: "Not in source." }],
        };
        let calls = 0;
        const extractor = createKnowledgeExtractor({
            complete: async () => {
                calls++;
                return success(JSON.stringify(response));
            },
        });
        expect(await extractor.extractWithRetry(text, 1)).toEqual(
            success(response),
        );
        expect(calls).toBe(1);
    });
});
