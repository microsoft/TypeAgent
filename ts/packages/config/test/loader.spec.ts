// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfigSync, loadConfig } from "../src/loader.js";

function makeTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-config-test-"));
}

function cleanProcessEnv(keys: string[]): void {
    for (const k of keys) {
        delete process.env[k];
    }
}

describe("loadConfigSync", () => {
    const trackedKeys = [
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_MAX_CONCURRENCY",
        "OPENAI_API_KEY",
        "BING_API_KEY",
        "TYPEAGENT_TEST_KEY",
    ];

    afterEach(() => cleanProcessEnv(trackedKeys));

    test("returns empty result when no files exist", () => {
        const root = makeTempWorkspace();
        try {
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env).toEqual({});
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("loads defaults YAML and populates process.env", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                [
                    "azure:",
                    "  openai:",
                    "    max_concurrency: 4",
                    "    response_format: true",
                ].join("\n"),
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({ workspaceRoot: root });
            expect(result.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("4");
            expect(result.env.AZURE_OPENAI_RESPONSE_FORMAT).toBe("1");
            expect(process.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("4");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("local YAML overrides defaults", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                ["azure:", "  openai:", "    max_concurrency: 4"].join("\n"),
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                ["azure:", "  openai:", "    max_concurrency: 16"].join("\n"),
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("16");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test(".env loads as lowest-precedence fallback", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, ".env"),
                [
                    "BING_API_KEY=from-dotenv",
                    "AZURE_OPENAI_API_KEY=from-dotenv",
                ].join("\n"),
            );
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                ["env:", "  AZURE_OPENAI_API_KEY: from-yaml"].join("\n"),
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            // Defaults wins over .env.
            expect(result.env.AZURE_OPENAI_API_KEY).toBe("from-yaml");
            // .env-only key still flows through.
            expect(result.env.BING_API_KEY).toBe("from-dotenv");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("local YAML overrides Key Vault would-be values (and .env)", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(path.join(root, ".env"), "BING_API_KEY=dotenv\n");
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "bing:\n  api_key: defaults\n",
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "bing:\n  api_key: local\n",
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.BING_API_KEY).toBe("local");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("preserves existing process.env (does not clobber overrides)", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: from-yaml\n",
            );
            cleanProcessEnv(trackedKeys);
            process.env.OPENAI_API_KEY = "from-shell";
            loadConfigSync({ workspaceRoot: root });
            expect(process.env.OPENAI_API_KEY).toBe("from-shell");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("idempotent: calling twice does not double-apply or change result", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: stable\n",
            );
            cleanProcessEnv(trackedKeys);
            const first = loadConfigSync({ workspaceRoot: root });
            const second = loadConfigSync({ workspaceRoot: root });
            expect(first.env).toEqual(second.env);
            expect(process.env.OPENAI_API_KEY).toBe("stable");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("trackSources records origin per key", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, ".env"),
                "TYPEAGENT_TEST_KEY=from-dotenv\n",
            );
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: from-defaults\n",
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: from-local\n",
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
                trackSources: true,
            });
            expect(result.sources).toBeDefined();
            expect(result.sources!.OPENAI_API_KEY).toBe("local");
            expect(result.sources!.TYPEAGENT_TEST_KEY).toBe("dotenv");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("strict: invalid YAML throws", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "deployments:\n  - one\n  - two\n",
            );
            cleanProcessEnv(trackedKeys);
            expect(() =>
                loadConfigSync({
                    workspaceRoot: root,
                    populateProcessEnv: false,
                }),
            ).toThrow(/Invalid TypeAgent config/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("non-strict: invalid YAML is logged and skipped", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "deployments:\n  - one\n",
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: ok\n",
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
                strict: false,
            });
            expect(result.env.OPENAI_API_KEY).toBe("ok");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("loadConfig (async)", () => {
    test("returns the same shape as loadConfigSync in Phase 1", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: hello\n",
            );
            delete process.env.OPENAI_API_KEY;
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.OPENAI_API_KEY).toBe("hello");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            delete process.env.OPENAI_API_KEY;
        }
    });
});
