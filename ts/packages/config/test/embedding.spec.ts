// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import yaml from "js-yaml";
import { fileURLToPath } from "node:url";
import {
    buildConfig,
    configToEnv,
    envToYamlTree,
    flatEnvToConfigTree,
    flatten,
    mergeFlat,
    loadRuntimeConfigSync,
    redactFlat,
    redactTree,
    validateConfigTree,
    type ConfigTree,
    type EmbeddingConfig,
    type FlatEnv,
} from "../src/index.js";

const gemmaModel = "onnx-community/embeddinggemma-2-ONNX";
const revision = "daa72c51243991dfcaf9f9137d2c573d8f7790c0";

function fromEmbedding(embedding: ConfigTree) {
    return buildConfig(flatten({ embedding }));
}

describe("embedding configuration", () => {
    test("runtime loading does not silently skip an invalid embedding section", () => {
        const invalidConfig = fileURLToPath(
            new URL(
                "../../test/fixtures/embedding-invalid.yaml",
                import.meta.url,
            ),
        );
        expect(() =>
            loadRuntimeConfigSync({
                defaultsPath: invalidConfig,
                localPath: invalidConfig,
                dotEnvPath: invalidConfig + ".missing",
                populateProcessEnv: false,
            }),
        ).toThrow("embedding.modalities");
    });

    test("legacy no-settings config does not acquire an embedding provider", () => {
        expect(buildConfig({}).embedding).toBeUndefined();
        expect(fromEmbedding({ modalities: ["text"] }).embedding).toEqual({
            modalities: ["text"],
        });
    });

    test.each([true, false])(
        "round-trips all fields through YAML, env, typed config, shim and importer (%s)",
        (localFilesOnly) => {
            const embedding = {
                provider: "local",
                runtime: "embeddinggemma",
                model: gemmaModel,
                modalities: ["text", "image"],
                revision,
                localFilesOnly,
                cacheDir: "models",
                size: 768,
                maxBatchSize: 4,
                maxPending: 32,
            } satisfies EmbeddingConfig;
            const tree: ConfigTree = {
                embedding: {
                    ...embedding,
                    modalities: [...embedding.modalities],
                },
            };
            const parsed = yaml.load(yaml.dump(tree)) as ConfigTree;
            validateConfigTree(parsed, "embedding test");
            const flat = flatten(parsed);
            const config = buildConfig(flat);
            expect(config.embedding).toEqual(embedding);
            expect(config.extra.size).toBe(0);
            const projected = configToEnv(config);
            for (const [key, value] of Object.entries(flat)) {
                expect(projected[key]).toBe(value);
            }
            expect(projected.TYPEAGENT_EMBEDDING_LOCAL_FILES_ONLY).toBe(
                localFilesOnly ? "1" : "0",
            );
            expect(buildConfig(projected).embedding).toEqual(embedding);
            expect(envToYamlTree(flat).embedding).toEqual(tree.embedding);
            const imported = flatEnvToConfigTree(flat);
            expect(imported.embedding).toEqual(tree.embedding);
            expect(buildConfig(flatten(imported)).embedding).toEqual(embedding);
            expect(redactTree(tree)).toEqual(tree);
            expect(redactFlat(flat)).toEqual(flat);
        },
    );

    test("validates after merging partial YAML sections", () => {
        const defaults = flatten({
            embedding: { provider: "local", runtime: "embeddinggemma" },
        });
        const local = flatten({ embedding: { modalities: ["text", "image"] } });
        expect(buildConfig(mergeFlat(defaults, local)).embedding).toEqual({
            provider: "local",
            runtime: "embeddinggemma",
            modalities: ["text", "image"],
        });
    });

    test("accepts image opt-in with the exact known ONNX model and no runtime", () => {
        expect(
            fromEmbedding({
                provider: "local",
                model: gemmaModel,
                modalities: ["text", "image"],
            }).embedding?.runtime,
        ).toBeUndefined();
    });

    test.each(["azure", "openai", "copilot", "none"])(
        "%s accepts text only without local runtime",
        (provider) => {
            expect(
                fromEmbedding({ provider, modalities: ["text"] }).embedding,
            ).toEqual({ provider, modalities: ["text"] });
        },
    );

    test.each([
        [],
        ["image"],
        ["text", "text"],
        ["text", "image", "image"],
        ["text", "audio"],
        ["text", "video"],
        ["text", "unknown"],
        ["TEXT"],
    ])("rejects invalid modalities %j", (...modalities) => {
        expect(() =>
            fromEmbedding({
                provider: "local",
                runtime: "embeddinggemma",
                modalities,
            }),
        ).toThrow("embedding.modalities");
    });

    test.each([
        { modalities: "text" },
        { modalities: null },
        { modalities: [1] },
        { modalities: [null] },
    ])("rejects invalid JSON modality type %j", (value) => {
        expect(() =>
            buildConfig({
                TYPEAGENT_EMBEDDING_MODALITIES: JSON.stringify(
                    value.modalities,
                ),
            }),
        ).toThrow("embedding.modalities");
    });

    test("rejects malformed JSON modalities", () => {
        expect(() =>
            buildConfig({ TYPEAGENT_EMBEDDING_MODALITIES: "text,image" }),
        ).toThrow("embedding.modalities");
    });

    test.each<ConfigTree>([
        { provider: "local", runtime: "bogus" },
        { provider: "azure", runtime: "embeddinggemma" },
        { provider: "local", runtime: "minilm", model: gemmaModel },
        {
            provider: "local",
            runtime: "embeddinggemma",
            model: "Xenova/all-MiniLM-L6-v2",
        },
    ])("rejects invalid/incompatible runtime %j", (embedding) => {
        expect(() => fromEmbedding(embedding)).toThrow("embedding.runtime");
    });

    test.each<ConfigTree>([
        { provider: "azure", runtime: "embeddinggemma" },
        { provider: "openai" },
        { provider: "copilot" },
        { provider: "none" },
        {},
        { provider: "local" },
        { provider: "local", runtime: "minilm" },
        { provider: "local", model: "onnx-community/embeddinggemma-300m-ONNX" },
    ])(
        "rejects image opt-in without compatible local runtime %j",
        (embedding) => {
            expect(() =>
                fromEmbedding({ ...embedding, modalities: ["text", "image"] }),
            ).toThrow(/embedding\.(runtime|modalities)/);
        },
    );

    test.each(["size", "maxBatchSize", "maxPending"])(
        "rejects invalid YAML %s",
        (field) => {
            for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, "4"]) {
                expect(() => fromEmbedding({ [field]: value })).toThrow(
                    `embedding.${field}`,
                );
            }
        },
    );

    test.each(["SIZE", "MAX_BATCH_SIZE", "MAX_PENDING"])(
        "rejects invalid env integer %s",
        (suffix) => {
            const key = `TYPEAGENT_EMBEDDING_${suffix}`;
            for (const value of [
                "",
                "0",
                "-1",
                "1.5",
                "NaN",
                "Infinity",
                "4junk",
            ]) {
                expect(() => buildConfig({ [key]: value })).toThrow(key);
            }
        },
    );

    test.each([
        ["true", true],
        ["false", false],
        ["1", true],
        ["0", false],
    ])("parses strict env boolean %s", (value, expected) => {
        expect(
            buildConfig({
                TYPEAGENT_EMBEDDING_LOCAL_FILES_ONLY: String(value),
            }).embedding?.localFilesOnly,
        ).toBe(expected);
    });

    test.each(["", "yes", "off", "FALSE", "2"])(
        "rejects invalid env boolean %j",
        (value) => {
            expect(() =>
                buildConfig({ TYPEAGENT_EMBEDDING_LOCAL_FILES_ONLY: value }),
            ).toThrow("embedding.localFilesOnly");
        },
    );

    test("preserves false in the env passthrough form", () => {
        const flat = flatten({
            env: { TYPEAGENT_EMBEDDING_LOCAL_FILES_ONLY: false },
        });
        expect(flat.TYPEAGENT_EMBEDDING_LOCAL_FILES_ONLY).toBe("0");
        expect(buildConfig(flat).embedding?.localFilesOnly).toBe(false);
    });

    test.each(["false", "true", 0, 1, null])(
        "rejects nonboolean YAML localFilesOnly %j",
        (localFilesOnly) => {
            expect(() => fromEmbedding({ localFilesOnly })).toThrow(
                "embedding.localFilesOnly",
            );
        },
    );

    test.each(["", "  "])("rejects empty revision %j", (value) => {
        expect(() =>
            buildConfig({ TYPEAGENT_EMBEDDING_REVISION: value }),
        ).toThrow("embedding.revision");
    });

    test("does not impose runtime-specific revision pinning in shared config", () => {
        const flat: FlatEnv = { TYPEAGENT_EMBEDDING_REVISION: "main" };
        expect(buildConfig(flat).embedding?.revision).toBe("main");
    });
});
