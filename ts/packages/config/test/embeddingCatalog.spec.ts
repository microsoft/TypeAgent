// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import {
    buildConfig,
    configToEnv,
    envToYamlTree,
    flatEnvToConfigTree,
    flatten,
    importDotEnv,
    loadRuntimeConfigSync,
    mergeFlat,
    redactFlat,
    redactTree,
    resolveEmbeddingConfig,
    validateConfigTree,
    type ConfigTree,
} from "../src/index.js";

const minilm = {
    provider: "local",
    runtime: "minilm",
    model: "Xenova/all-MiniLM-L6-v2",
    revision: "751bff37182d3f1213fa05d7196b954e230abad9",
    size: 384,
    modalities: ["text"],
    localFilesOnly: false,
    cacheDir: "models",
    maxBatchSize: 32,
    maxPending: 8,
};
const gemma = {
    ...minilm,
    runtime: "embeddinggemma",
    model: "onnx-community/embeddinggemma-2-ONNX",
    revision: "daa72c51243991dfcaf9f9137d2c573d8f7790c0",
    size: 768,
    modalities: ["text", "image"],
};
const catalog: ConfigTree = { minilm, gemma };

describe("named embedding catalog", () => {
    test("catalog alone is inert and legacy inference remains unchanged", () => {
        const config = buildConfig(flatten({ embeddingModels: catalog }));
        expect(config.embedding).toBeUndefined();
        expect(resolveEmbeddingConfig(config)).toBeUndefined();
        const legacy = buildConfig(
            flatten({
                embeddingModels: catalog,
                embedding: { provider: "azure", size: 1536 },
            }),
        );
        expect(resolveEmbeddingConfig(legacy)).toBe(legacy.embedding);
        expect(
            resolveEmbeddingConfig(
                buildConfig({
                    AZURE_OPENAI_ENDPOINT_EMBEDDING:
                        "https://example-eastus.openai.azure.com/embeddings",
                }),
            ),
        ).toBeUndefined();
    });

    test("selects a profile without materializing a legacy embedding section", () => {
        const config = buildConfig(
            flatten({
                embeddingModels: catalog,
                defaultEmbeddingModel: "gemma",
            }),
        );
        expect(resolveEmbeddingConfig(config)).toEqual(gemma);
        expect(config.embedding).toBeUndefined();
        expect(
            configToEnv(config).TYPEAGENT_EMBEDDING_PROVIDER,
        ).toBeUndefined();
        expect(buildConfig(configToEnv(config))).toEqual(config);
    });

    test("none disables embeddings without requiring a catalog", () => {
        expect(
            resolveEmbeddingConfig(
                buildConfig({
                    TYPEAGENT_DEFAULT_EMBEDDING_MODEL: "none",
                }),
            ),
        ).toEqual({ provider: "none" });
    });

    test.each(["missing", "", " "])(
        "rejects unknown/empty selector %j",
        (selector) => {
            expect(() =>
                buildConfig({
                    TYPEAGENT_DEFAULT_EMBEDDING_MODEL: selector,
                }),
            ).toThrow(/defaultEmbeddingModel/);
        },
    );

    test("merges final definitions by alias and field, keeping other aliases", () => {
        const defaults = flatten({
            embeddingModels: { minilm: { ...minilm, localFilesOnly: true } },
        });
        const local = flatten({
            embeddingModels: {
                minilm: { localFilesOnly: false, cacheDir: "staged-models" },
                gemma,
            },
        });
        const config = buildConfig(mergeFlat(defaults, local));
        expect(config.embeddingModels).toEqual({
            ...catalog,
            minilm: { ...minilm, cacheDir: "staged-models" },
        });
        expect(() => buildConfig(local)).toThrow(/required/);
    });

    test("round-trips the entire catalog through YAML, shim, tree and importer", () => {
        const tree = {
            embeddingModels: catalog,
            defaultEmbeddingModel: "minilm",
        };
        const parsed = yaml.load(yaml.dump(tree)) as ConfigTree;
        validateConfigTree(parsed, "catalog");
        const flat = flatten(parsed);
        const config = buildConfig(flat);
        expect(config.extra.size).toBe(0);
        expect(buildConfig(configToEnv(config))).toEqual(config);
        for (const projected of [
            envToYamlTree(flat),
            flatEnvToConfigTree(flat),
        ]) {
            expect(projected.embeddingModels).toEqual(catalog);
            expect(projected.defaultEmbeddingModel).toBe("minilm");
            expect(buildConfig(flatten(projected))).toEqual(config);
        }
        expect(redactFlat(flat)).toEqual(flat);
        expect(redactTree(tree)).toEqual(tree);
    });

    test.each([
        null,
        [],
        "profile",
        {},
        { ...minilm, provider: "none" },
        { ...minilm, provider: "unknown" },
        { ...minilm, model: "" },
        { ...minilm, size: 768 },
        { ...minilm, size: "384" },
        { ...minilm, revision: "main" },
        { ...minilm, model: "unknown/checkpoint" },
        { ...minilm, runtime: "embeddinggemma" },
        { ...minilm, modalities: ["text", "image"] },
        { ...minilm, modalities: ["text", "text"] },
        { ...gemma, modalities: ["audio"] },
        { ...minilm, localFilesOnly: "false" },
        { ...minilm, maxPending: 0 },
        { ...minilm, cacheDir: 2 },
        { ...minilm, apiKey: "not-a-credential" },
        { ...minilm, deployment: "embedding" },
        {
            provider: "openai",
            model: "hosted",
            size: 1536,
            modalities: ["text"],
            cacheDir: "models",
        },
    ])("rejects malformed UNUSED definition %j", (profile) => {
        expect(() =>
            buildConfig({
                TYPEAGENT_EMBEDDING_MODELS: JSON.stringify({ unused: profile }),
            }),
        ).toThrow(/embeddingModels.unused/);
    });

    test.each(["[]", "null", "not json", "1"])(
        "rejects malformed catalog %s",
        (raw) => {
            expect(() =>
                buildConfig({ TYPEAGENT_EMBEDDING_MODELS: raw }),
            ).toThrow();
        },
    );

    test("reserves none as a selector, not a catalog alias", () => {
        expect(() =>
            buildConfig(flatten({ embeddingModels: { none: minilm } })),
        ).toThrow(/reserved/);
    });

    test.each(["provider", "model", "modalities", "size", "localFilesOnly"])(
        "rejects selector mixed with legacy %s even for none",
        (field) => {
            const values: ConfigTree = {
                provider: "azure",
                model: "hosted",
                modalities: ["text"],
                size: 1536,
                localFilesOnly: false,
            };
            expect(() =>
                buildConfig(
                    flatten({
                        defaultEmbeddingModel: "none",
                        embedding: { [field]: values[field] },
                    }),
                ),
            ).toThrow(/migrate/);
        },
    );

    test("Azure definitions reference provider-owned deployment pools", () => {
        const azure: ConfigTree = {
            embeddingModels: {
                azure: {
                    provider: "azure",
                    model: "text-embedding-ada-002",
                    size: 1536,
                    modalities: ["text"],
                    deployment: "embedding",
                },
            },
            defaultEmbeddingModel: "azure",
        };
        expect(() => buildConfig(flatten(azure))).toThrow(/deployment/);
        const flat = flatten({
            ...azure,
            azureOpenAI: {
                deployments: {
                    embedding: {
                        endpoints: [
                            {
                                endpoint:
                                    "https://example-eastus.openai.azure.com/embeddings",
                            },
                        ],
                    },
                },
            },
        });
        const config = buildConfig(flat);
        expect(resolveEmbeddingConfig(config)?.deployment).toBe("embedding");
        const rebuilt = buildConfig(flatten(flatEnvToConfigTree(flat)));
        expect(rebuilt.embeddingModels).toEqual(config.embeddingModels);
        expect(resolveEmbeddingConfig(rebuilt)).toEqual(
            resolveEmbeddingConfig(config),
        );
        expect(rebuilt.azureOpenAI.deployments).toEqual(
            config.azureOpenAI.deployments,
        );
    });

    test("Azure omission preserves the exact default transport and opaque model", () => {
        const flat = flatten({
            embeddingModels: {
                "azure-current": {
                    provider: "azure",
                    model: "azure:",
                    size: 1536,
                    modalities: ["text"],
                },
            },
            defaultEmbeddingModel: "azure-current",
        });
        expect(() => buildConfig(flat)).toThrow(/deployment/);
        const config = buildConfig({
            ...flat,
            AZURE_OPENAI_ENDPOINT_EMBEDDING:
                "https://example-eastus.openai.azure.com/default-embedding",
        });
        expect(resolveEmbeddingConfig(config)).toEqual({
            provider: "azure",
            model: "azure:",
            size: 1536,
            modalities: ["text"],
        });
        expect(resolveEmbeddingConfig(config)?.deployment).toBeUndefined();
        expect(buildConfig(configToEnv(config))).toEqual(config);
    });

    test.each(["openai", "copilot"])(
        "accepts hosted text-only %s definitions",
        (provider) => {
            const config = buildConfig(
                flatten({
                    embeddingModels: {
                        hosted: {
                            provider,
                            model: "text-embedding-3-small",
                            size: 1536,
                            modalities: ["text"],
                        },
                    },
                    defaultEmbeddingModel: "hosted",
                }),
            );
            expect(resolveEmbeddingConfig(config)?.provider).toBe(provider);
        },
    );

    test("normal YAML layers, env overrides and dotenv importer retain all profiles", () => {
        const dir = path.join(process.cwd(), "test", `.catalog-${process.pid}`);
        fs.mkdirSync(dir, { recursive: true });
        const defaultsPath = path.join(dir, "defaults.yaml");
        const localPath = path.join(dir, "local.yaml");
        const dotEnvPath = path.join(dir, "legacy.env");
        const envKeys = [
            "TYPEAGENT_DEFAULT_EMBEDDING_MODEL",
            "TYPEAGENT_EMBEDDING_MODELS",
        ];
        const original = envKeys.map((key) => process.env[key]);
        try {
            fs.writeFileSync(
                defaultsPath,
                yaml.dump({ embeddingModels: catalog }),
            );
            fs.writeFileSync(
                localPath,
                yaml.dump({
                    defaultEmbeddingModel: "minilm",
                    embeddingModels: { minilm: { maxBatchSize: 16 } },
                }),
            );
            process.env.TYPEAGENT_DEFAULT_EMBEDDING_MODEL = "gemma";
            process.env.TYPEAGENT_EMBEDDING_MODELS = JSON.stringify({
                gemma: { maxPending: 2 },
            });
            const config = loadRuntimeConfigSync({
                defaultsPath,
                localPath,
                dotEnvPath,
                populateProcessEnv: false,
            }).config;
            expect(config.defaultEmbeddingModel).toBe("gemma");
            expect(config.embeddingModels?.minilm.maxBatchSize).toBe(16);
            expect(resolveEmbeddingConfig(config)?.maxPending).toBe(2);
            fs.writeFileSync(
                dotEnvPath,
                `TYPEAGENT_DEFAULT_EMBEDDING_MODEL=gemma\nTYPEAGENT_EMBEDDING_MODELS='${JSON.stringify(config.embeddingModels)}'\n`,
            );
            expect(importDotEnv(dotEnvPath).tree.embeddingModels).toEqual(
                config.embeddingModels,
            );
        } finally {
            envKeys.forEach((key, i) => {
                if (original[i] === undefined) delete process.env[key];
                else process.env[key] = original[i];
            });
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
