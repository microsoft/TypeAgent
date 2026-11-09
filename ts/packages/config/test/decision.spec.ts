// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildConfig,
    configToEnv,
    flatten,
    envToYamlTree,
    validateConfigTree,
} from "../src/index.js";

describe("typed native decision configuration", () => {
    const tree = {
        modelProvider: "copilot",
        decision: {
            provider: "inherit",
            azure: {
                deploymentKey: "decision_1",
                deploymentName: "decision-1",
            },
            copilot: { model: "gpt-6-luna-decisions" },
        },
    };
    test("round-trips YAML, flat env, typed config and serialization", () => {
        validateConfigTree(tree, "test");
        const flat = flatten(tree);
        const config = buildConfig(flat);
        expect(config.decision).toEqual(tree.decision);
        expect(config.extra.has("TYPEAGENT_DECISION_PROVIDER")).toBe(false);
        expect(buildConfig(configToEnv(config)).decision).toEqual(
            tree.decision,
        );
        expect(envToYamlTree(configToEnv(config)).decision).toEqual(
            tree.decision,
        );
    });
    test("leaves older config sparse and unknown keys unchanged", () => {
        const config = buildConfig({ OTHER: "preserved" });
        expect(config.decision).toBeUndefined();
        expect(config.extra.get("OTHER")).toBe("preserved");
    });
    test.each(["openai", "ollama", "", "Azure"])(
        "rejects unsupported decision provider %p",
        (provider) => {
            expect(() =>
                buildConfig({ TYPEAGENT_DECISION_PROVIDER: provider }),
            ).toThrow();
            expect(() => flatten({ decision: { provider } })).toThrow();
        },
    );
    test.each([
        "TYPEAGENT_DECISION_AZURE_DEPLOYMENT_KEY",
        "TYPEAGENT_DECISION_AZURE_DEPLOYMENT_NAME",
        "TYPEAGENT_DECISION_COPILOT_MODEL",
    ])("rejects empty %s", (key) => {
        expect(() => buildConfig({ [key]: " " })).toThrow();
    });
    test("accepts native request constraints without allowing embedding-only bounds", () => {
        expect(
            buildConfig(
                flatten({
                    modelRequestConstraints: {
                        "copilot:decision:gpt-6-luna-decisions": {
                            inputTokens: 1000,
                        },
                    },
                }),
            ).modelRequestConstraints?.size,
        ).toBe(1);
        expect(() =>
            buildConfig(
                flatten({
                    modelRequestConstraints: {
                        "azure:decision:decision_1": {
                            embeddingItemTokens: 1000,
                        },
                    },
                }),
            ),
        ).toThrow();
    });
});
