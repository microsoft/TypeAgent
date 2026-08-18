// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    expandRemovedActions,
    parseActionEligibilityPolicy,
} from "../src/translationBench/policy/loadPolicy.js";

describe("translation bench action eligibility policy", () => {
    it("parses and expands exact action removals", () => {
        const loaded = parseActionEligibilityPolicy({
            version: 1,
            removedActions: [
                {
                    type: "action",
                    id: "calendar.addEvent",
                    reasons: ["internal_utility"],
                },
            ],
            parameterOverrides: [],
        });
        const expanded = expandRemovedActions(loaded.policy, [
            { schemaName: "calendar", actionName: "addEvent" },
        ]);

        expect(loaded.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(expanded.removedActionIds.has("calendar.addEvent")).toBe(true);
    });
});
