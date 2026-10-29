// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import {
    downloadEmbeddingConsent,
    embeddingRuntimeVersions,
    localEmbeddingAssets,
    localEmbeddingDefinition,
    provisionLocalEmbedding,
} from "../localEmbeddingModels.mjs";
import { writeEmbeddingRuntimeManifest } from "../embeddingRuntimeManifest.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const yaml = createRequire(import.meta.url)("js-yaml");
function fixture(t) {
    const root = fs.mkdtempSync(path.join(directory, ".embedding-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
function cli(script, args, environment = {}) {
    return spawnSync(
        process.execPath,
        [path.join(directory, "..", script), ...args],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                TYPEAGENT_CONFIG_LOCAL: "",
                TYPEAGENT_CONFIG_DIR: "",
                ...environment,
            },
        },
    );
}
function generated(t, args = []) {
    const root = fixture(t);
    const out = path.join(root, "config.yaml");
    const result = cli("generate-selfhost-config.mjs", [
        "--provider",
        "copilot",
        "--out",
        out,
        ...args,
    ]);
    assert.equal(result.status, 0, result.stderr);
    return { root, out, config: yaml.load(fs.readFileSync(out, "utf8")) };
}

test("fresh install selects pinned lightweight MiniLM with offline inference", (t) => {
    const { config } = generated(t);
    assert.equal(config.defaultEmbeddingModel, "local-minilm");
    assert.deepEqual(
        config.embeddingModels["local-minilm"],
        localEmbeddingDefinition(),
    );
    assert.equal(config.embedding, undefined);
    assert.equal(config.embeddingModels["local-embeddinggemma"], undefined);
    assert.equal(config.copilot.defaultModel, "gpt-6-luna");
});

test("Copilot provisioning preserves an explicit chat-model override", (t) => {
    const { config } = generated(t, ["--copilot-model", "gpt-6.1-sol"]);
    assert.equal(config.copilot.defaultModel, "gpt-6.1-sol");
});

test("switching to Copilot defaults to Luna 6 unless explicitly overridden", (t) => {
    for (const override of [undefined, "gpt-6.1-sol"]) {
        const { out } = generated(t);
        const result = cli("setModelProvider.mjs", [
            "--provider",
            "copilot",
            "--config",
            out,
            ...(override ? ["--copilot-model", override] : []),
        ]);
        assert.equal(result.status, 0, result.stderr);
        const config = yaml.load(fs.readFileSync(out, "utf8"));
        assert.equal(config.copilot.defaultModel, override ?? "gpt-6-luna");
    }
});

test("Gemma is an explicit pinned text+image CPU/FP32 profile, not MiniLM", (t) => {
    const { config } = generated(t, [
        "--local-embedding-model",
        "EMBEDDINGGEMMA",
    ]);
    const gemma = config.embeddingModels["local-embeddinggemma"];
    assert.equal(config.defaultEmbeddingModel, "local-embeddinggemma");
    assert.equal(gemma.model, "onnx-community/embeddinggemma-2-ONNX");
    assert.equal(gemma.size, 768);
    assert.deepEqual(gemma.modalities, ["text", "image"]);
    assert.equal(gemma.revision, "daa72c51243991dfcaf9f9137d2c573d8f7790c0");
    assert.equal(gemma.localFilesOnly, true);
    assert.equal(config.embeddingModels["local-minilm"], undefined);
});

test("legacy model-ID CLI inputs map only to the supported pinned definitions", () => {
    assert.equal(
        localEmbeddingDefinition("Xenova/all-MiniLM-L6-v2").runtime,
        "minilm",
    );
    assert.equal(
        localEmbeddingDefinition("onnx-community/embeddinggemma-2-ONNX")
            .runtime,
        "embeddinggemma",
    );
    assert.throws(() => localEmbeddingDefinition("other/model"), /Unsupported/);
});

for (const provider of ["copilot", "ollama"]) {
    test(`${provider} fresh chat generation uses the local named default`, (t) => {
        const { config } = generated(t, ["--provider", provider]);
        assert.equal(config.defaultEmbeddingModel, "local-minilm");
    });
}

test("explicit hosted and disabled choices emit named selectors without legacy conflicts", (t) => {
    const { config } = generated(t, ["--embedding", "openai"]);
    assert.deepEqual(config.embeddingModels["openai-embedding"], {
        provider: "openai",
        model: "text-embedding-3-small",
        size: 1536,
        modalities: ["text"],
    });
    assert.equal(config.embedding, undefined);
    const disabled = generated(t, ["--embedding", "none"]).config;
    assert.equal(disabled.defaultEmbeddingModel, "none");
    assert.equal(disabled.embedding, undefined);
});

test("unknown hosted dimensions fail before writing; explicit size is honored", (t) => {
    const root = fixture(t);
    const out = path.join(root, "config.yaml");
    const args = [
        "--provider",
        "copilot",
        "--embedding",
        "openai",
        "--embedding-model",
        "custom",
        "--out",
        out,
    ];
    const failed = cli("generate-selfhost-config.mjs", args);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /embedding-size/);
    assert.equal(fs.existsSync(out), false);
    const passed = cli("generate-selfhost-config.mjs", [
        ...args,
        "--embedding-size",
        "512",
    ]);
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(
        yaml.load(fs.readFileSync(out, "utf8")).embeddingModels[
            "openai-embedding"
        ].size,
        512,
    );
});

test("generator force/provider switches preserve a selected hosted profile and unrelated config", (t) => {
    const { root, out, config } = generated(t, ["--embedding", "openai"]);
    const noFetch = path.join(root, "no-fetch.mjs");
    fs.writeFileSync(
        noFetch,
        'globalThis.fetch = async () => { throw new Error("Unexpected model fetch"); };',
    );
    config.azureOpenAI = {
        endpoint: "https://example.invalid",
        deployments: [{ name: "test" }],
    };
    fs.writeFileSync(out, yaml.dump(config));
    const result = cli(
        "generate-selfhost-config.mjs",
        [
            "--provider",
            "ollama",
            "--out",
            out,
            "--force",
            "--embedding",
            "local",
            "--local-embedding-model",
            "embeddinggemma",
            "--preserve-embedding-selection",
            "--download-local-embedding",
            "1",
        ],
        { NODE_OPTIONS: `--import=${pathToFileURL(noFetch).href}` },
    );
    assert.equal(result.status, 0, result.stderr);
    const next = yaml.load(fs.readFileSync(out, "utf8"));
    assert.equal(next.defaultEmbeddingModel, "openai-embedding");
    assert.deepEqual(next.embeddingModels, config.embeddingModels);
    assert.deepEqual(next.azureOpenAI, config.azureOpenAI);
});

test("provider setter preserves hosted embeddings unless an explicit model/alias is selected", (t) => {
    const { out, config } = generated(t, ["--embedding", "openai"]);
    config.embeddingModels["local-embeddinggemma"] =
        localEmbeddingDefinition("embeddinggemma");
    fs.writeFileSync(out, yaml.dump(config));
    for (const provider of ["ollama", "copilot", "aisystems"]) {
        const result = cli("setModelProvider.mjs", [
            "--config",
            out,
            "--provider",
            provider,
            "--no-validate",
        ]);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
            yaml.load(fs.readFileSync(out, "utf8")).defaultEmbeddingModel,
            "openai-embedding",
        );
    }
    const selected = cli("setModelProvider.mjs", [
        "--config",
        out,
        "--provider",
        "copilot",
        "--default-embedding-model",
        "local-embeddinggemma",
        "--no-validate",
    ]);
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(
        yaml.load(fs.readFileSync(out, "utf8")).defaultEmbeddingModel,
        "local-embeddinggemma",
    );
    const missing = cli("setModelProvider.mjs", [
        "--config",
        out,
        "--provider",
        "copilot",
        "--default-embedding-model",
        "absent",
        "--no-validate",
    ]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Unknown embedding/);
});

test("generator and provider setter select inherited hosted aliases and merge partial local definitions", (t) => {
    const root = fixture(t);
    const defaults = path.join(root, "defaults.yaml");
    const out = path.join(root, "config.yaml");
    fs.writeFileSync(
        defaults,
        yaml.dump({
            embeddingModels: {
                "copilot-small": {
                    provider: "copilot",
                    model: "text-embedding-3-small",
                    size: 1536,
                    modalities: ["text"],
                },
                "local-embeddinggemma": localEmbeddingDefinition(
                    "embeddinggemma",
                    path.join(root, "default-cache"),
                ),
            },
        }),
    );
    const environment = { TYPEAGENT_CONFIG_DEFAULTS: defaults };
    const generated = cli(
        "generate-selfhost-config.mjs",
        [
            "--provider",
            "copilot",
            "--out",
            out,
            "--default-embedding-model",
            "copilot-small",
        ],
        environment,
    );
    assert.equal(generated.status, 0, generated.stderr);
    let cfg = yaml.load(fs.readFileSync(out, "utf8"));
    assert.equal(cfg.defaultEmbeddingModel, "copilot-small");
    assert.equal(cfg.embeddingModels["copilot-small"].provider, "copilot");
    cfg.embeddingModels = { "local-embeddinggemma": { maxBatchSize: 3 } };
    delete cfg.defaultEmbeddingModel;
    fs.writeFileSync(out, yaml.dump(cfg));
    const selected = cli(
        "setModelProvider.mjs",
        [
            "--config",
            out,
            "--provider",
            "copilot",
            "--default-embedding-model",
            "local-embeddinggemma",
            "--no-validate",
        ],
        environment,
    );
    assert.equal(selected.status, 0, selected.stderr);
    cfg = yaml.load(fs.readFileSync(out, "utf8"));
    assert.equal(cfg.embeddingModels["local-embeddinggemma"].size, 768);
    assert.equal(cfg.embeddingModels["local-embeddinggemma"].maxBatchSize, 3);
    delete cfg.embeddingModels["copilot-small"];
    fs.writeFileSync(out, yaml.dump(cfg));
    const hosted = cli(
        "setModelProvider.mjs",
        [
            "--config",
            out,
            "--provider",
            "copilot",
            "--default-embedding-model",
            "copilot-small",
            "--no-validate",
        ],
        environment,
    );
    assert.equal(hosted.status, 0, hosted.stderr);
    assert.equal(
        yaml.load(fs.readFileSync(out, "utf8")).defaultEmbeddingModel,
        "copilot-small",
    );
});

test("explicit setter model choice migrates legacy config and preserves provider connections", (t) => {
    const root = fixture(t);
    const out = path.join(root, "config.yaml");
    fs.writeFileSync(
        out,
        yaml.dump({
            embedding: { provider: "openai" },
            openAI: {
                apiKey: "synthetic-only",
                endpointEmbedding: "https://example.invalid",
            },
        }),
    );
    const result = cli("setModelProvider.mjs", [
        "--config",
        out,
        "--provider",
        "copilot",
        "--embedding",
        "local",
        "--local-embedding-model",
        "embeddinggemma",
        "--no-validate",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const config = yaml.load(fs.readFileSync(out, "utf8"));
    assert.equal(config.embedding, undefined);
    assert.equal(config.defaultEmbeddingModel, "local-embeddinggemma");
    assert.equal(config.openAI.apiKey, "synthetic-only");
});

for (const runtime of ["minilm", "embeddinggemma"]) {
    test(`${runtime} provisions only its complete pinned FP32 snapshot with explicit consent`, async (t) => {
        const root = fixture(t);
        const definition = localEmbeddingDefinition(runtime, root);
        const requests = [];
        const fetchImpl = async (url) => {
            requests.push(url);
            return new Response(
                url.endsWith(".json") ? "{}" : "synthetic-onnx",
            );
        };
        await assert.rejects(
            provisionLocalEmbedding(definition, { fetchImpl }),
            /explicitly pass/,
        );
        assert.equal(requests.length, 0);
        const result = await provisionLocalEmbedding(definition, {
            allowDownload: true,
            fetchImpl,
        });
        assert.deepEqual(result.downloaded, localEmbeddingAssets(definition));
        for (const asset of localEmbeddingAssets(definition)) {
            assert.equal(
                fs.existsSync(path.join(result.snapshot, asset)),
                true,
            );
        }
        assert.equal(requests.length, localEmbeddingAssets(definition).length);
        assert.ok(
            requests.every((url) =>
                url.startsWith(
                    `https://huggingface.co/${definition.model}/resolve/${definition.revision}/`,
                ),
            ),
        );
        assert.ok(requests.every((url) => !/quantized|fp16|q4|q8/.test(url)));
        const cached = await provisionLocalEmbedding(definition, { fetchImpl });
        assert.deepEqual(cached.downloaded, []);
        assert.equal(requests.length, localEmbeddingAssets(definition).length);
        if (runtime === "embeddinggemma") {
            assert.ok(result.downloaded.includes("processor_config.json"));
            assert.ok(result.downloaded.includes("onnx/model.onnx_data"));
            assert.ok(result.downloaded.includes("onnx/vision_encoder.onnx"));
        }
    });
}

test("Gemma text-only provisioning does not fetch the vision encoder", async (t) => {
    const definition = localEmbeddingDefinition("embeddinggemma", fixture(t));
    definition.modalities = ["text"];
    const requests = [];
    await provisionLocalEmbedding(definition, {
        allowDownload: true,
        fetchImpl: async (url) => {
            requests.push(url);
            return new Response(url.endsWith(".json") ? "{}" : "onnx");
        },
    });
    assert.ok(requests.every((url) => !url.includes("vision_encoder")));
});

test("failed downloads clean partials, preserve completed files and retry only missing assets", async (t) => {
    const definition = localEmbeddingDefinition("embeddinggemma", fixture(t));
    let failed = false;
    const requests = [];
    const fetchImpl = async (url) => {
        requests.push(url);
        if (url.endsWith("model.onnx_data") && !failed) {
            failed = true;
            return new Response("failure", { status: 503 });
        }
        return new Response(url.endsWith(".json") ? "{}" : "onnx");
    };
    await assert.rejects(
        provisionLocalEmbedding(definition, { allowDownload: true, fetchImpl }),
        /503/,
    );
    const firstRequests = requests.length;
    const result = await provisionLocalEmbedding(definition, {
        allowDownload: true,
        fetchImpl,
    });
    assert.deepEqual(result.downloaded, [
        "onnx/model.onnx_data",
        "onnx/vision_encoder.onnx",
    ]);
    assert.equal(requests.length - firstRequests, 2);
    assert.equal(
        fs.existsSync(
            path.join(result.snapshot, "onnx/model.onnx_data.partial"),
        ),
        false,
    );
    fs.rmSync(path.join(result.snapshot, "onnx/vision_encoder.onnx"));
    await assert.rejects(
        provisionLocalEmbedding(definition, { fetchImpl }),
        /vision_encoder/,
    );
});

test("malformed metadata, empty weights and incorrect pins fail without accepting partial snapshots", async (t) => {
    const definition = localEmbeddingDefinition("minilm", fixture(t));
    await assert.rejects(
        provisionLocalEmbedding(definition, {
            allowDownload: true,
            fetchImpl: async () => new Response("not JSON"),
        }),
        SyntaxError,
    );
    await assert.rejects(
        provisionLocalEmbedding(definition, {
            allowDownload: true,
            fetchImpl: async (url) =>
                new Response(url.endsWith(".json") ? "{}" : ""),
        }),
        /Empty model/,
    );
    let requests = 0;
    await assert.rejects(
        provisionLocalEmbedding(
            { ...definition, revision: "main" },
            {
                allowDownload: true,
                fetchImpl: async () => {
                    requests++;
                },
            },
        ),
        /pinned/,
    );
    assert.equal(requests, 0);
});

test("download consent is explicit, including the MSI numeric property contract", () => {
    assert.equal(downloadEmbeddingConsent([]), false);
    assert.equal(
        downloadEmbeddingConsent(["--download-local-embedding", "0"]),
        false,
    );
    assert.equal(
        downloadEmbeddingConsent(["--download-local-embedding", "1"]),
        true,
    );
    assert.equal(
        downloadEmbeddingConsent(["--download-local-embedding", "--force"]),
        true,
    );
    assert.throws(
        () => downloadEmbeddingConsent(["--download-local-embedding", "yes"]),
        /0 or 1/,
    );
});

test("dry-run download request cannot fetch or create model/config artifacts", (t) => {
    const root = fixture(t);
    const out = path.join(root, "config.yaml");
    const result = cli("generate-selfhost-config.mjs", [
        "--provider",
        "copilot",
        "--local-embedding-model",
        "embeddinggemma",
        "--local-embedding-cache-dir",
        path.join(root, "cache"),
        "--out",
        out,
        "--download-local-embedding",
        "--dry-run",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /defaultEmbeddingModel: local-embeddinggemma/);
    assert.deepEqual(fs.readdirSync(root), []);
});

test("generator downloads only the selected alias, and failed provisioning never replaces config", (t) => {
    const root = fixture(t);
    const out = path.join(root, "config.yaml");
    const log = path.join(root, "requests.jsonl");
    const bootstrap = path.join(root, "mock-fetch.mjs");
    fs.writeFileSync(
        bootstrap,
        `
        import fs from "node:fs";
        globalThis.fetch = async (url) => {
            fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(url) + "\\n");
            if (process.env.FAIL_MOCK_FETCH === "1") return new Response("failed", {status: 503});
            return new Response(url.endsWith(".json") ? "{}" : "synthetic-onnx");
        };
    `,
    );
    const original = {
        modelProvider: "copilot",
        defaultEmbeddingModel: "local-minilm",
        embeddingModels: {
            "local-minilm": localEmbeddingDefinition(
                "minilm",
                path.join(root, "cache"),
            ),
            "local-embeddinggemma": localEmbeddingDefinition(
                "embeddinggemma",
                path.join(root, "cache"),
            ),
        },
    };
    const raw = yaml.dump(original);
    fs.writeFileSync(out, raw);
    const args = [
        "--import",
        pathToFileURL(bootstrap).href,
        path.join(directory, "..", "generate-selfhost-config.mjs"),
        "--provider",
        "copilot",
        "--out",
        out,
        "--force",
        "--download-local-embedding",
    ];
    const failed = spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: { ...process.env, FAIL_MOCK_FETCH: "1" },
    });
    assert.notEqual(failed.status, 0);
    assert.equal(fs.readFileSync(out, "utf8"), raw);
    fs.writeFileSync(log, "");
    const passed = spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: { ...process.env, FAIL_MOCK_FETCH: "0" },
    });
    assert.equal(passed.status, 0, passed.stderr);
    const requests = fs
        .readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    assert.equal(
        requests.length,
        localEmbeddingAssets(original.embeddingModels["local-minilm"]).length,
    );
    assert.ok(requests.every((url) => url.includes("Xenova/all-MiniLM-L6-v2")));
    assert.equal(
        fs.existsSync(path.join(root, "cache", "onnx-community")),
        false,
    );
    assert.equal(
        yaml.load(fs.readFileSync(out, "utf8")).defaultEmbeddingModel,
        "local-minilm",
    );
});

function writePackage(root, name, version) {
    const destination = path.join(root, "node_modules", ...name.split("/"));
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(
        path.join(destination, "package.json"),
        JSON.stringify({ name, version, main: "index.js" }),
    );
    fs.writeFileSync(path.join(destination, "index.js"), "");
    return destination;
}

test("deployment manifests require one pinned native graph and reject missing/older nested packages", (t) => {
    const root = fixture(t);
    assert.throws(() => writeEmbeddingRuntimeManifest(root), /missing/);
    for (const [name, version] of Object.entries(embeddingRuntimeVersions))
        writePackage(root, name, version);
    const manifest = writeEmbeddingRuntimeManifest(root);
    assert.deepEqual(manifest.versions, {
        "@huggingface/transformers": "4.3.1",
        sharp: "0.35.5",
        "onnxruntime-node": "1.30.0",
    });
    assert.equal(manifest.downloadRequiresConsent, true);
    assert.equal(manifest.restartRequiredToSwitch, true);
    assert.equal(manifest.dtype, "fp32");
    const nested = writePackage(root, "some-consumer", "1.0.0");
    writePackage(nested, "onnxruntime-node", "1.20.0");
    assert.throws(
        () => writeEmbeddingRuntimeManifest(root),
        /requires onnxruntime-node@1.30.0/,
    );
});

test("both artifact packagers deploy catalog provisioning and retain Transformers native dependencies", () => {
    for (const name of ["deployAgentServer.mjs", "bundleAgentServer.mjs"]) {
        const source = fs.readFileSync(
            path.join(directory, "..", name),
            "utf8",
        );
        assert.match(source, /writeEmbeddingRuntimeManifest\(/);
        assert.match(source, /setModelProvider\.mjs/);
    }
    assert.match(
        fs.readFileSync(
            path.join(directory, "..", "deployAgentServer.mjs"),
            "utf8",
        ),
        /localEmbeddingModels\.mjs/,
    );
    const utils = fs.readFileSync(
        path.join(directory, "..", "bundleUtils.mjs"),
        "utf8",
    );
    for (const name of Object.keys(embeddingRuntimeVersions))
        assert.ok(utils.includes(`"${name}"`));
});

test("repo-less provisioning tools bundle and select shipped inherited aliases without embedding runtime imports", async (t) => {
    const root = fixture(t);
    const tools = path.join(root, "tools");
    const { bundleEntry } = await import("../bundleUtils.mjs");
    fs.mkdirSync(tools);
    fs.writeFileSync(
        path.join(tools, "config.defaults.yaml"),
        yaml.dump({
            embeddingModels: {
                "copilot-small": {
                    provider: "copilot",
                    model: "text-embedding-3-small",
                    size: 1536,
                    modalities: ["text"],
                },
            },
        }),
    );
    for (const name of [
        "generate-selfhost-config.mjs",
        "setModelProvider.mjs",
    ]) {
        const metadata = await bundleEntry({
            entryPoint: path.join(directory, "..", name),
            outfile: path.join(tools, name),
        });
        assert.ok(
            Object.keys(metadata.inputs).every(
                (input) =>
                    !/@huggingface|onnxruntime|node_modules[\\/]sharp[\\/]/.test(
                        input,
                    ),
            ),
        );
    }
    const out = path.join(root, "config.yaml");
    const environment = {
        ...process.env,
        TYPEAGENT_CONFIG_DEFAULTS: "",
        TYPEAGENT_CONFIG_DIR: root,
        TYPEAGENT_CONFIG_LOCAL: out,
    };
    const generated = spawnSync(
        process.execPath,
        [
            path.join(tools, "generate-selfhost-config.mjs"),
            "--provider",
            "copilot",
            "--out",
            out,
            "--default-embedding-model",
            "copilot-small",
        ],
        { encoding: "utf8", env: environment },
    );
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(
        yaml.load(fs.readFileSync(out, "utf8")).defaultEmbeddingModel,
        "copilot-small",
    );
    const updated = spawnSync(
        process.execPath,
        [
            path.join(tools, "setModelProvider.mjs"),
            "--config",
            out,
            "--provider",
            "copilot",
            "--default-embedding-model",
            "copilot-small",
        ],
        { encoding: "utf8", env: environment },
    );
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(updated.stdout, /Validated:.*embedding.provider=copilot/);
});
