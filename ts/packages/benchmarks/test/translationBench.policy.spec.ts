// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    assertRemovedActionsMatchCatalog,
    expandRemovedActions,
    getPackagedActionEligibilityPolicy,
    isOnboardingSchemaName,
    parseActionEligibilityPolicy,
    clearPackagedActionEligibilityPolicyCacheForTests,
    catalogActionId,
} from "../src/translationBench/policy/loadPolicy.js";
import {
    assertParameterOverridesMatchCatalog,
    buildActionParametersGraderCatalog,
    type GeneratedActionCatalog,
} from "../src/translationBench/policy/policyGenerator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Jest runs compiled specs from dist/test; assets live under package root.
const packageRoot = path.resolve(
    here,
    here.endsWith(`${path.sep}dist${path.sep}test`) ||
        here.endsWith("/dist/test")
        ? "../.."
        : "..",
);
const catalogPath = path.join(
    packageRoot,
    "src/translationBench/catalog.generated.json",
);
const onboardingSnapshotPath = path.join(
    packageRoot,
    "test/fixtures/onboarding-removed-actions.snapshot.json",
);

function loadCatalog(): GeneratedActionCatalog {
    return JSON.parse(
        readFileSync(catalogPath, "utf8"),
    ) as GeneratedActionCatalog;
}

describe("translation-bench action eligibility policy", () => {
    beforeEach(() => {
        clearPackagedActionEligibilityPolicyCacheForTests();
    });

    test("packaged policy parses and hashes stably", () => {
        const a = getPackagedActionEligibilityPolicy();
        clearPackagedActionEligibilityPolicyCacheForTests();
        const b = getPackagedActionEligibilityPolicy();
        expect(a.contentHash).toBe(b.contentHash);
        expect(a.policy.version).toBe(1);
        expect(a.parameterOverrides.size).toBeGreaterThan(0);
    });

    test("rejects unknown discriminated type", () => {
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

    test("onboarding.* expands to snapshotted action ids", () => {
        const catalog = loadCatalog();
        const actions = catalog.actions.map((a) => ({
            schemaName: a.schemaName,
            actionName: a.actionName,
        }));
        const expanded = actions
            .filter((a) => isOnboardingSchemaName(a.schemaName))
            .map((a) => catalogActionId(a))
            .sort();
        const snapshot = JSON.parse(
            readFileSync(onboardingSnapshotPath, "utf8"),
        ) as string[];
        expect(expanded).toEqual(snapshot);
        expect(expanded).toHaveLength(32);
    });

    test("fail-closed throws on missing exact removedActions id", () => {
        const loaded = getPackagedActionEligibilityPolicy();
        expect(() =>
            expandRemovedActions(loaded.policy, [], {
                allowMissingExactIds: false,
            }),
        ).toThrow(/removedActions id/);
        const skipped = expandRemovedActions(loaded.policy, [], {
            allowMissingExactIds: true,
        });
        expect(skipped.removedActionIds.size).toBe(0);
    });

    test("all originalRequest actions are removed from schedule set", () => {
        const catalog = loadCatalog();
        const actions = catalog.actions.map((a) => ({
            schemaName: a.schemaName,
            actionName: a.actionName,
        }));
        const loaded = getPackagedActionEligibilityPolicy();
        const { removedActionIds } = expandRemovedActions(
            loaded.policy,
            actions,
            { allowMissingExactIds: false },
        );
        const originalRequestActions = [
            "browser.lookupAndAnswer.lookupAndAnswerInternet",
            "browser.searchImageAction",
            "chat.generateResponse",
            "dispatcher.reasoning.reasoningAction",
            "image.createImageAction",
            "image.editImageAction",
            "markdown.streamingUpdateDocument",
            "markdown.updateDocument",
            "photo.takePhoto",
            "settings.adjustMultiMonitorLayoutAction",
            "settings.dimBrightNessAction",
            "video.createVideoAction",
        ];
        for (const id of originalRequestActions) {
            expect(removedActionIds.has(id)).toBe(true);
        }
        expect(
            removedActionIds.has("system.help.answerTypeAgentQuestion"),
        ).toBe(true);
        expect(removedActionIds.has("utility.claudeTask")).toBe(true);
        // onboarding expanded
        expect(
            [...removedActionIds].some((id) => id.startsWith("onboarding")),
        ).toBe(true);
    });

    test("every parameter override path exists on the catalog", () => {
        const catalog = loadCatalog();
        expect(() =>
            assertParameterOverridesMatchCatalog(catalog),
        ).not.toThrow();
        const actions = catalog.actions.map((a) => ({
            schemaName: a.schemaName,
            actionName: a.actionName,
        }));
        expect(() =>
            assertRemovedActionsMatchCatalog(
                getPackagedActionEligibilityPolicy().policy,
                actions,
            ),
        ).not.toThrow();
    });

    test("stale override path fails closed", () => {
        const catalog = loadCatalog();
        const loaded = getPackagedActionEligibilityPolicy();
        const poisoned = parseActionEligibilityPolicy({
            ...loaded.policy,
            parameterOverrides: [
                ...loaded.policy.parameterOverrides,
                {
                    type: "field",
                    path: "no.such.action.field",
                    verify: "ignore",
                },
            ],
        });
        expect(() =>
            assertParameterOverridesMatchCatalog(catalog, poisoned),
        ).toThrow(/parameterOverrides paths missing/);
    });

    test("grader build applies override verify without LLM", async () => {
        const catalog = loadCatalog();
        // Tiny catalog slice: one originalRequest action + one normal action
        const slice: GeneratedActionCatalog = {
            catalogVersion: catalog.catalogVersion,
            actions: catalog.actions
                .filter(
                    (a) =>
                        [
                            "browser.searchImageAction",
                            "browser.openWebPage",
                        ].includes(`${a.schemaName}.${a.actionName}`) ||
                        `${a.schemaName}.${a.actionName}` ===
                            "browser.searchImageAction",
                )
                .slice(0, 5),
        };
        // Ensure searchImage is included
        const search = catalog.actions.find(
            (a) =>
                a.schemaName === "browser" &&
                a.actionName === "searchImageAction",
        );
        if (search && !slice.actions.includes(search)) {
            slice.actions = [search, ...slice.actions];
        }
        const grader = await buildActionParametersGraderCatalog(slice, {
            forceFull: true,
            assertOverridesMatchCatalog: false,
        });
        const entry = grader.byAction["browser.searchImageAction"];
        expect(entry).toBeDefined();
        expect(entry!.fields.originalRequest?.verify).toBe("ignore");
        expect(grader.llmFallbackCount).toBe(0);
    });
});
