// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../src/loader.js";
import type { KeyVaultFetcher } from "../src/keyVault.js";

function makeTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-config-kv-"));
}

function cleanProcessEnv(keys: string[]): void {
    for (const k of keys) {
        delete process.env[k];
    }
}

function stubFetcher(yamlText: string | null): KeyVaultFetcher {
    return async () => yamlText;
}

describe("loadConfig (with Key Vault layer)", () => {
    const tracked = [
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_MAX_CONCURRENCY",
        "BING_API_KEY",
        "OPENAI_API_KEY",
    ];

    afterEach(() => cleanProcessEnv(tracked));

    test("Key Vault layer overrides defaults", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "azure:\n  openai:\n    max_concurrency: 4\n",
            );
            cleanProcessEnv(tracked);
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: stubFetcher(
                        "azure:\n  openai:\n    max_concurrency: 32\n",
                    ),
                },
            });
            expect(result.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("32");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("local YAML overrides Key Vault", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: from-local\n",
            );
            cleanProcessEnv(tracked);
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: stubFetcher("openai:\n  api_key: from-vault\n"),
                },
            });
            expect(result.env.OPENAI_API_KEY).toBe("from-local");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("Key Vault overrides .env (which sits below defaults)", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, ".env"),
                "BING_API_KEY=from-dotenv\n",
            );
            cleanProcessEnv(tracked);
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: stubFetcher("bing:\n  api_key: from-vault\n"),
                },
            });
            expect(result.env.BING_API_KEY).toBe("from-vault");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("missing Key Vault secret leaves defaults intact", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "azure:\n  openai:\n    max_concurrency: 4\n",
            );
            cleanProcessEnv(tracked);
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: stubFetcher(null),
                },
            });
            expect(result.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("4");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("Key Vault fetch error in non-strict mode falls through", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: ok\n",
            );
            cleanProcessEnv(tracked);
            const failingFetcher: KeyVaultFetcher = async () => {
                throw new Error("simulated failure");
            };
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
                strict: false,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: failingFetcher,
                },
            });
            expect(result.env.OPENAI_API_KEY).toBe("ok");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("Key Vault fetch error in strict mode propagates", async () => {
        const root = makeTempWorkspace();
        try {
            cleanProcessEnv(tracked);
            const failingFetcher: KeyVaultFetcher = async () => {
                throw new Error("simulated failure");
            };
            await expect(
                loadConfig({
                    workspaceRoot: root,
                    populateProcessEnv: false,
                    strict: true,
                    keyVault: {
                        vaultName: "aisystems",
                        fetcher: failingFetcher,
                    },
                }),
            ).rejects.toThrow(/simulated failure/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("source tracking attributes Key Vault keys correctly", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "azure:\n  openai:\n    max_concurrency: 4\n",
            );
            cleanProcessEnv(tracked);
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
                trackSources: true,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: stubFetcher("openai:\n  api_key: from-vault\n"),
                },
            });
            expect(result.sources).toBeDefined();
            expect(result.sources!.AZURE_OPENAI_MAX_CONCURRENCY).toBe(
                "defaults",
            );
            expect(result.sources!.OPENAI_API_KEY).toBe("key-vault");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("loadConfig without keyVault option behaves like loadConfigSync", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: x\n",
            );
            cleanProcessEnv(tracked);
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.OPENAI_API_KEY).toBe("x");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
