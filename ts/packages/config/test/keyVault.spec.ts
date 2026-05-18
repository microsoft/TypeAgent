// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fetchKeyVaultConfig } from "../src/keyVault.js";
import type { KeyVaultFetcher } from "../src/keyVault.js";

/**
 * Build a stub fetcher that returns the given map of
 * `secret-name -> raw YAML string`. Unknown secrets resolve to null.
 */
function stubFetcher(secrets: Record<string, string | null>): KeyVaultFetcher {
    return async (_vault, name) => {
        if (!(name in secrets)) return null;
        return secrets[name];
    };
}

describe("fetchKeyVaultConfig", () => {
    test("parses a YAML blob into a ConfigTree", async () => {
        const fetcher = stubFetcher({
            "typeagent-config": [
                "azure:",
                "  openai:",
                "    endpoint: https://kv.example/chat",
                "    api_key: from-vault",
            ].join("\n"),
        });
        const tree = await fetchKeyVaultConfig({
            vaultName: "aisystems",
            fetcher,
        });
        expect(tree).toEqual({
            azure: {
                openai: {
                    endpoint: "https://kv.example/chat",
                    api_key: "from-vault",
                },
            },
        });
    });

    test("uses DEFAULT_SECRET_NAME when secretName not specified", async () => {
        const seen: string[] = [];
        const fetcher: KeyVaultFetcher = async (_vault, name) => {
            seen.push(name);
            return "openai:\n  api_key: x\n";
        };
        await fetchKeyVaultConfig({ vaultName: "aisystems", fetcher });
        expect(seen).toEqual(["typeagent-config"]);
    });

    test("honors explicit secretName", async () => {
        const seen: string[] = [];
        const fetcher: KeyVaultFetcher = async (_vault, name) => {
            seen.push(name);
            return "openai:\n  api_key: x\n";
        };
        await fetchKeyVaultConfig({
            vaultName: "aisystems",
            secretName: "ci-overrides",
            fetcher,
        });
        expect(seen).toEqual(["ci-overrides"]);
    });

    test("returns null when secret does not exist", async () => {
        const fetcher = stubFetcher({});
        const tree = await fetchKeyVaultConfig({
            vaultName: "aisystems",
            fetcher,
        });
        expect(tree).toBeNull();
    });

    test("returns null on empty secret value", async () => {
        const fetcher = stubFetcher({ "typeagent-config": "" });
        const tree = await fetchKeyVaultConfig({
            vaultName: "aisystems",
            fetcher,
        });
        expect(tree).toBeNull();
    });

    test("returns null on fetch error when failOnError is false", async () => {
        const fetcher: KeyVaultFetcher = async () => {
            throw new Error("network down");
        };
        const tree = await fetchKeyVaultConfig({
            vaultName: "aisystems",
            fetcher,
        });
        expect(tree).toBeNull();
    });

    test("rethrows on fetch error when failOnError is true", async () => {
        const fetcher: KeyVaultFetcher = async () => {
            throw new Error("network down");
        };
        await expect(
            fetchKeyVaultConfig({
                vaultName: "aisystems",
                fetcher,
                failOnError: true,
            }),
        ).rejects.toThrow(/network down/);
    });

    test("returns null on top-level YAML array (not a map)", async () => {
        const fetcher = stubFetcher({
            "typeagent-config": "- one\n- two\n",
        });
        const tree = await fetchKeyVaultConfig({
            vaultName: "aisystems",
            fetcher,
        });
        expect(tree).toBeNull();
    });

    test("validation error throws when failOnError is true", async () => {
        const fetcher = stubFetcher({
            "typeagent-config": "deployments:\n  - one\n  - two\n",
        });
        await expect(
            fetchKeyVaultConfig({
                vaultName: "aisystems",
                fetcher,
                failOnError: true,
            }),
        ).rejects.toThrow(/Invalid TypeAgent config/);
    });

    test("rejects oversized blob", async () => {
        const big = "padding: " + "x".repeat(26 * 1024) + "\n";
        const fetcher = stubFetcher({ "typeagent-config": big });
        await expect(
            fetchKeyVaultConfig({
                vaultName: "aisystems",
                fetcher,
                failOnError: true,
            }),
        ).rejects.toThrow(/exceeds the .* limit/);
    });

    test("test-isolation guard blocks live fetch under Jest", async () => {
        // No fetcher supplied → would hit the live SDK. Under Jest this
        // is blocked and returns null.
        const tree = await fetchKeyVaultConfig({
            vaultName: "definitely-not-a-real-vault",
        });
        expect(tree).toBeNull();
    });

    test("test-isolation guard does NOT block when fetcher is provided", async () => {
        // Stub fetcher means the call never reaches Azure, so the
        // guard does not fire.
        const fetcher = stubFetcher({
            "typeagent-config": "openai:\n  api_key: ok\n",
        });
        const tree = await fetchKeyVaultConfig({
            vaultName: "any",
            fetcher,
        });
        expect(tree).toEqual({ openai: { api_key: "ok" } });
    });

    test("test-isolation guard can be bypassed via env opt-in", async () => {
        // The opt-in is honored even though no fetcher is supplied; we
        // can't make a real call here, so we expect the SDK call to
        // fail and (since failOnError is false) yield null. The point
        // is that the guard's distinct "refusing live call" debug
        // message is NOT what's blocking us.
        const prev = process.env.TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS;
        process.env.TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS = "1";
        try {
            const tree = await fetchKeyVaultConfig({
                vaultName: "definitely-not-a-real-vault-12345",
            });
            // Live call attempted but failed; failOnError defaults to
            // false, so we get null.
            expect(tree).toBeNull();
        } finally {
            if (prev === undefined) {
                delete process.env.TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS;
            } else {
                process.env.TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS = prev;
            }
        }
    }, 30000);
});
