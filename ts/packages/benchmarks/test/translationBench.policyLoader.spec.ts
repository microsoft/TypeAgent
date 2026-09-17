// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "@jest/globals";

import {
    assertRemovedActionsMatchCatalog,
    catalogActionId,
    clearPackagedActionEligibilityPolicyCacheForTests,
    expandRemovedActions,
    getPackagedActionEligibilityPolicy,
    isOnboardingSchemaName,
    parseActionEligibilityPolicy,
} from "../src/translationBench/policy/loadPolicy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(
    here,
    here.endsWith(`${path.sep}dist${path.sep}test`) ||
        here.endsWith("/dist/test")
        ? "../.."
        : "..",
);

interface Catalog {
    actions: Array<{ schemaName: string; actionName: string }>;
}

function loadCatalog(): Catalog {
    return JSON.parse(
        readFileSync(
            path.join(
                packageRoot,
                "src/translationBench/catalog.generated.json",
            ),
            "utf8",
        ),
    ) as Catalog;
}

describe("translation bench action eligibility policy", () => {
    beforeEach(() => {
        clearPackagedActionEligibilityPolicyCacheForTests();
    });

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

    it("loads the packaged policy with a stable hash", () => {
        const first = getPackagedActionEligibilityPolicy();
        clearPackagedActionEligibilityPolicyCacheForTests();
        const second = getPackagedActionEligibilityPolicy();

        expect(first.contentHash).toBe(second.contentHash);
        expect(first.policy.version).toBe(1);
        expect(first.parameterOverrides.size).toBeGreaterThan(0);
    });

    it("rejects unsupported removal types", () => {
        expect(() =>
            parseActionEligibilityPolicy({
                version: 1,
                removedActions: [
                    {
                        type: "glob",
                        pattern: "foo.*",
                        reasons: ["internal_utility"],
                    },
                ],
                parameterOverrides: [],
            }),
        ).toThrow(/Invalid translation-bench action eligibility policy/);
    });

    it("expands onboarding schemas to the reviewed snapshot", () => {
        const expanded = loadCatalog()
            .actions.filter((action) =>
                isOnboardingSchemaName(action.schemaName),
            )
            .map(catalogActionId)
            .sort();
        const snapshot = JSON.parse(
            readFileSync(
                path.join(
                    packageRoot,
                    "test/fixtures/onboarding-removed-actions.snapshot.json",
                ),
                "utf8",
            ),
        ) as string[];

        expect(expanded).toEqual(snapshot);
        expect(expanded).toHaveLength(32);
    });

    it("fails closed when an exact removal is absent", () => {
        const policy = getPackagedActionEligibilityPolicy().policy;

        expect(() =>
            expandRemovedActions(policy, [], {
                allowMissingExactIds: false,
            }),
        ).toThrow(/removedActions id/);
        expect(
            expandRemovedActions(policy, [], {
                allowMissingExactIds: true,
            }).removedActionIds.size,
        ).toBe(0);
    });

    it("keeps packaged removals aligned with the catalog", () => {
        const actions = loadCatalog().actions.map(
            ({ schemaName, actionName }) => ({ schemaName, actionName }),
        );

        expect(() =>
            assertRemovedActionsMatchCatalog(
                getPackagedActionEligibilityPolicy().policy,
                actions,
            ),
        ).not.toThrow();
    });
});
