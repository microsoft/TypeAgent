// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildConfig,
    configToEnv,
    flatten,
    envToYamlTree,
} from "../src/index.js";

test("typed YAML request constraints round-trip independently of scheduling and explicit disablement", () => {
    const tree = {
        modelRequestConstraints: {
            "azure:chat:gpt_6_luna": {
                contextTokens: 128000,
                outputTokens: 8000,
            },
            "azure:embedding:": {
                inputTokens: 300000,
                embeddingItemTokens: 8191,
            },
        },
        env: {
            TYPEAGENT_MEMORY_VIEW_DRAFTS: false,
            TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS: false,
        },
    };
    const flat = flatten(tree);
    const config = buildConfig(flat);
    expect(
        config.modelRequestConstraints?.get("azure:chat:gpt_6_luna"),
    ).toEqual({
        contextTokens: 128000,
        outputTokens: 8000,
    });
    expect(config.azureOpenAI.maxConcurrency).toBe(4);
    expect(flat.TYPEAGENT_MEMORY_VIEW_DRAFTS).toBe("0");
    expect(flat.TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS).toBe("0");
    const projected = configToEnv(config);
    expect(buildConfig(projected).modelRequestConstraints).toEqual(
        config.modelRequestConstraints,
    );
    expect(
        buildConfig(flatten(envToYamlTree(projected))).modelRequestConstraints,
    ).toEqual(config.modelRequestConstraints);
    expect(buildConfig({}).modelRequestConstraints).toBeUndefined();
});

test.each([
    { "azure:chat:x": { contextTokens: 0 } },
    { "azure:chat:x": { outputTokens: "4000" } },
    { "azure:chat:x": { chatAttempts: 128 } },
    { "azure:chat:x": { embeddingItemTokens: 8000 } },
    { "azure:embedding:": { contextTokens: 8000 } },
    { "azure:chat:x": {}, "AZURE:CHAT:X": {} },
    { "not-a-role": { contextTokens: 8000 } },
])(
    "rejects invalid or mixed scheduling/provider metadata: %j",
    (modelRequestConstraints) => {
        expect(() => flatten({ modelRequestConstraints })).toThrow();
    },
);
