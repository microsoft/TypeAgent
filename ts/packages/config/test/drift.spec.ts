// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeConfigDrift } from "../src/loader.js";
import type { KeyVaultFetcher } from "../src/keyVault.js";

function makeTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-config-drift-"));
}

function stubFetcher(yamlText: string | null): KeyVaultFetcher {
    return async () => yamlText;
}

describe("computeConfigDrift", () => {
    test("reports vault keys the local file omits or sets differently", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "azure:\n  openai:\n    endpoint: https://local\n    max_concurrency: 4\n",
            );
            const drift = await computeConfigDrift({
                workspaceRoot: root,
                keyVault: {
                    vaultName: "aisystems",
                    // endpoint differs, api_key missing locally,
                    // max_concurrency matches (so not reported).
                    fetcher: stubFetcher(
                        "azure:\n  openai:\n    endpoint: https://vault\n    api_key: secret\n    max_concurrency: 4\n",
                    ),
                },
            });
            expect(drift).toBeDefined();
            expect(drift!.vaultName).toBe("aisystems");
            expect(drift!.driftedKeys).toEqual([
                "AZURE_OPENAI_API_KEY",
                "AZURE_OPENAI_ENDPOINT",
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("returns undefined when the vault is a subset the local file matches", async () => {
        const root = makeTempWorkspace();
        try {
            // org_id exists only locally (an intentional override) and must be
            // ignored; api_key matches the vault, so there is no drift.
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: shared-value\n  org_id: local-only\n",
            );
            const drift = await computeConfigDrift({
                workspaceRoot: root,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: stubFetcher("openai:\n  api_key: shared-value\n"),
                },
            });
            expect(drift).toBeUndefined();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("returns undefined when the vault holds no config", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: local-value\n",
            );
            const drift = await computeConfigDrift({
                workspaceRoot: root,
                keyVault: {
                    vaultName: "aisystems",
                    fetcher: stubFetcher(null),
                },
            });
            expect(drift).toBeUndefined();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("returns undefined when no vault is configured", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: local-value\n",
            );
            // No explicit vaultName and no vault.shared anywhere, so there is
            // nothing to compare against and no live fetch is attempted.
            const drift = await computeConfigDrift({ workspaceRoot: root });
            expect(drift).toBeUndefined();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("auto-discovers the vault name from vault.shared", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "vault:\n  shared: myvault\n",
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: local-value\n",
            );
            const drift = await computeConfigDrift({
                workspaceRoot: root,
                keyVault: {
                    fetcher: stubFetcher("openai:\n  api_key: vault-value\n"),
                },
            });
            expect(drift).toBeDefined();
            expect(drift!.vaultName).toBe("myvault");
            expect(drift!.driftedKeys).toEqual(["OPENAI_API_KEY"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
