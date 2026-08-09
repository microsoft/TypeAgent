// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    clearPackagedEligibleGoldActionsCacheForTests,
    getPackagedEligibleGoldActionIds,
    loadPackagedGraderForEligibility,
    pickEligibleGoldActions,
} from "../src/translationBench/policy/index.js";
import {
    fieldTreeIsLlmAsAJudge,
    listActionsWithLlmJudgeFields,
} from "../src/translationBench/policy/graderInspect.js";
import {
    loadActionParametersGraderCatalogFile,
    type ActionParametersGraderCatalog,
    type GeneratedActionCatalog,
} from "../src/translationBench/policy/policyGenerator.js";
import {
    countEligibleTranslationBenchActions,
    getPackagedScheduleExcludedActionIds,
} from "../src/translationBench/synthesizer/eligibleActions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(
    here,
    here.endsWith(`${path.sep}dist${path.sep}test`) ||
        here.endsWith("/dist/test")
        ? "../.."
        : "..",
);

function loadCatalog(): GeneratedActionCatalog {
    return JSON.parse(
        readFileSync(
            path.join(
                packageRoot,
                "src/translationBench/catalog.generated.json",
            ),
            "utf8",
        ),
    ) as GeneratedActionCatalog;
}

function loadGrader(): ActionParametersGraderCatalog {
    const grader = loadActionParametersGraderCatalogFile(
        path.join(
            packageRoot,
            "src/translationBench/action-parameters-grader.generated.json",
        ),
    );
    if (grader === undefined) {
        throw new Error("missing packaged action-parameters grader");
    }
    return grader;
}

function includeAllLlm(model = "test-model") {
    return {
        model,
        async complete(prompt: string) {
            const marker = "CANDIDATES:";
            const idx = prompt.indexOf(marker);
            const body = idx >= 0 ? prompt.slice(idx + marker.length) : prompt;
            const ids = [...body.matchAll(/"id": "([^"]+)"/g)].map(
                (m) => m[1]!,
            );
            const unique = [...new Set(ids)];
            return JSON.stringify({
                decisions: unique.map((id) => ({ id, include: true })),
            });
        },
    };
}

describe("action quality picker", () => {
    it("excludes human removals and builds a non-empty allowlist via LLM", async () => {
        const catalog = loadCatalog();
        const grader = loadGrader();
        const artifact = await pickEligibleGoldActions(catalog, grader, {
            llm: includeAllLlm(),
        });
        expect(artifact.model).toBe("test-model");
        expect(artifact.graderRulesFingerprint).toBeTruthy();
        expect(artifact.allowlist.length).toBeGreaterThan(50);
        expect(artifact.allowlist).not.toContain("dispatcher.unknown");
        expect(artifact.allowlist).not.toContain(
            "code.code-editor.createCodeBlock",
        );
        expect(artifact.allowlist).not.toContain("browser.executeAdHocScript");
        expect(artifact.allowlist).not.toContain("chat.generateResponse");
        expect(
            artifact.allowlist.some((id) => id.startsWith("onboarding.")),
        ).toBe(false);
    });

    it("honors LLM include decisions for candidates only", async () => {
        const catalog = loadCatalog();
        const grader = loadGrader();
        const baseline = await pickEligibleGoldActions(catalog, grader, {
            llm: includeAllLlm("baseline"),
        });
        const keep = new Set(baseline.allowlist.slice(0, 3));
        const llm = {
            model: "test",
            async complete(prompt: string) {
                const marker = "CANDIDATES:";
                const idx = prompt.indexOf(marker);
                const body =
                    idx >= 0 ? prompt.slice(idx + marker.length) : prompt;
                const ids = [...body.matchAll(/"id": "([^"]+)"/g)].map(
                    (m) => m[1]!,
                );
                const unique = [...new Set(ids)];
                return JSON.stringify({
                    decisions: unique.map((id) => ({
                        id,
                        include: keep.has(id),
                    })),
                });
            },
        };
        const artifact = await pickEligibleGoldActions(catalog, grader, {
            llm,
            batchSize: 64,
        });
        expect(artifact.allowlist.sort()).toEqual([...keep].sort());
        expect(artifact.allowlist).not.toContain("dispatcher.unknown");
    });

    it("packaged allowlist load is fail-closed and drives default schedule", () => {
        clearPackagedEligibleGoldActionsCacheForTests();
        const packaged = getPackagedEligibleGoldActionIds();
        expect(packaged.artifact.model.length).toBeGreaterThan(0);
        expect(packaged.artifact.graderRulesFingerprint.length).toBeGreaterThan(
            0,
        );
        expect(packaged.allowlist.size).toBeGreaterThan(50);
        expect(packaged.allowlist.has("dispatcher.unknown")).toBe(false);

        for (const id of [
            "dispatcher.unknown",
            "chat.generateResponse",
            "browser.executeAdHocScript",
        ]) {
            expect(packaged.allowlist.has(id)).toBe(false);
        }

        const grader = loadPackagedGraderForEligibility();
        expect(grader.rulesFingerprint).toBe(
            packaged.artifact.graderRulesFingerprint,
        );
        for (const id of listActionsWithLlmJudgeFields(grader)) {
            expect(packaged.allowlist.has(id)).toBe(false);
        }
    });

    it("pick refuses grader without rulesFingerprint", async () => {
        const catalog = loadCatalog();
        const grader = { ...loadGrader() };
        delete grader.rulesFingerprint;
        await expect(
            pickEligibleGoldActions(catalog, grader, {
                llm: includeAllLlm(),
            }),
        ).rejects.toThrow(/rulesFingerprint/);
    });
});

describe("graderInspect llmAsAJudge", () => {
    it("detects nested item-only llmAsAJudge", () => {
        expect(fieldTreeIsLlmAsAJudge({ verify: "exact" })).toBe(false);
        expect(
            fieldTreeIsLlmAsAJudge({
                item: { verify: "llmAsAJudge" },
            }),
        ).toBe(true);
        expect(
            listActionsWithLlmJudgeFields({
                byAction: {
                    "a.keep": { fields: { x: { verify: "exact" } } },
                    "a.judge": {
                        fields: {
                            items: { item: { verify: "llmAsAJudge" } },
                        },
                    },
                },
            }),
        ).toEqual(["a.judge"]);
    });
});

describe("schedule exclusions allowlist-on", () => {
    it("default schedule excludes everything outside packaged allowlist", () => {
        clearPackagedEligibleGoldActionsCacheForTests();
        const { allowlist } = getPackagedEligibleGoldActionIds();
        // Use schemas from a tiny synthetic catalog derived from allowlist sample
        // plus known bans so we exercise the lattice without full agent schemas file.
        const sample = [...allowlist].slice(0, 5);
        const banned = [
            "dispatcher.unknown",
            "chat.generateResponse",
            "onboarding.start",
        ];
        const schemas = [
            {
                schemaName: "dispatcher",
                tools: [
                    { function: { name: "unknown" } },
                    ...(sample
                        .filter((id) => id.startsWith("dispatcher."))
                        .map((id) => ({
                            function: {
                                name: id.split(".").slice(1).join("."),
                            },
                        })) as { function: { name: string } }[]),
                ],
            },
            {
                schemaName: "chat",
                tools: [{ function: { name: "generateResponse" } }],
            },
            {
                schemaName: "onboarding",
                tools: [{ function: { name: "start" } }],
            },
            // include a few allowlisted actions from other schemas
            ...sample
                .filter((id) => !id.startsWith("dispatcher."))
                .map((id) => {
                    const [schemaName, ...rest] = id.split(".");
                    return {
                        schemaName: schemaName!,
                        tools: [{ function: { name: rest.join(".") } }],
                    };
                }),
        ];

        const excluded = getPackagedScheduleExcludedActionIds(schemas, {
            allowMissingExactIds: true,
        });
        for (const id of banned) {
            expect(excluded.has(id)).toBe(true);
        }
        for (const id of sample) {
            expect(excluded.has(id)).toBe(false);
        }
        const eligible = countEligibleTranslationBenchActions(
            schemas,
            excluded,
        );
        expect(eligible).toBe(
            sample.filter((id) =>
                schemas.some((s) =>
                    s.tools.some(
                        (t) => `${s.schemaName}.${t.function.name}` === id,
                    ),
                ),
            ).length,
        );
    });

    it("allowlist-off still excludes llmAsAJudge and human bans", () => {
        const schemas = [
            {
                schemaName: "dispatcher",
                tools: [{ function: { name: "unknown" } }],
            },
            {
                schemaName: "code",
                tools: [{ function: { name: "code-editor.createCodeBlock" } }],
            },
        ];
        const excluded = getPackagedScheduleExcludedActionIds(schemas, {
            applyEligibleGoldAllowlist: false,
            allowMissingExactIds: true,
        });
        expect(excluded.has("dispatcher.unknown")).toBe(true);
        // createCodeBlock is human-removed and/or llmJudge — either way excluded
        expect(excluded.has("code.code-editor.createCodeBlock")).toBe(true);
    });
});
