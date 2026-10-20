// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    HOSTED_API_PROFILE,
    HOSTED_API_SECRET_NAME,
    loadHostedApiRuntimeConfig,
} from "../src/containerBootstrap.js";
import { startAfterBootstrap } from "../src/startup.js";
import type { ConfigTree, KeyVaultFetcher } from "@typeagent/config";

const ALLOWED_ENDPOINT =
    "https://api-eastus.openai.azure.com/openai/deployments/gpt-6-luna/chat/completions?api-version=2025-01-01-preview";

function createTempRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-api-bootstrap-"));
}

function hostedTree(extra: ConfigTree = {}): ConfigTree {
    return {
        profile: HOSTED_API_PROFILE,
        modelProvider: "azure",
        azureOpenAI: {
            defaultAuth: "identity",
            deployments: {
                gpt_6_luna: {
                    endpoints: [
                        {
                            endpoint: ALLOWED_ENDPOINT,
                            region: "eastus",
                            mode: "PAYG",
                        },
                    ],
                },
            },
        },
        ...extra,
    };
}

function createEnvironment(root: string): NodeJS.ProcessEnv {
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    return {
        HOME: home,
        TYPEAGENT_USER_DATA_DIR: path.join(home, ".typeagent"),
        TYPEAGENT_API_BOOTSTRAP: HOSTED_API_PROFILE,
        TYPEAGENT_API_CONFIG_VAULT: "api-vault",
        TYPEAGENT_API_CONFIG_SECRET: HOSTED_API_SECRET_NAME,
    };
}

function fakeVault(
    secrets: Readonly<Record<string, string>>,
    requests: string[],
): KeyVaultFetcher {
    return async (vaultName, secretName) => {
        requests.push(`${vaultName}/${secretName}`);
        return secrets[secretName] ?? null;
    };
}

function serializedRuntime(
    env: NodeJS.ProcessEnv,
    config: Awaited<ReturnType<typeof loadHostedApiRuntimeConfig>>,
    logs: readonly string[],
): string {
    return JSON.stringify({
        env,
        config: {
            modelProvider: config.modelProvider,
            deployments: [...config.azureOpenAI.deployments.values()],
            extra: [...config.extra],
        },
        logs,
    });
}

describe("hosted API container bootstrap", () => {
    const roots: string[] = [];

    afterEach(() => {
        for (const root of roots.splice(0)) {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("fetches only the dedicated allowlisted routing secret", async () => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        env.TYPEAGENT_SHAREDVAULT = "shared-vault";
        env.TYPEAGENT_CONFIG_LOCAL = path.join(root, "legacy.yaml");
        env.OPENAI_ENDPOINT = "https://legacy-sentinel.invalid";
        env.AZURE_OPENAI_ENDPOINT = "https://stale-sentinel.invalid";
        env.AWS_S3_BUCKET_NAME = "aws-bucket-sentinel";
        env.AZURE_STORAGE_ACCOUNT = "storage-account-sentinel";
        env.COSMOSDB_ENDPOINT = "https://cosmosdb-routing-sentinel.invalid";
        env.WIKIPEDIA_ENDPOINT = "https://wikipedia-sentinel.invalid";
        fs.writeFileSync(
            env.TYPEAGENT_CONFIG_LOCAL,
            "openAI:\n  apiKey: legacy-file-sentinel\n",
        );

        const unrelatedSentinels = [
            "graph-client-secret-sentinel",
            "cosmosdb-connection-string-sentinel",
            "speech-key-sentinel",
            "unrelated-api-key-sentinel",
        ];
        const requests: string[] = [];
        const logs: string[] = [];
        const config = await loadHostedApiRuntimeConfig({
            env,
            fetcher: fakeVault(
                {
                    [HOSTED_API_SECRET_NAME]: JSON.stringify(hostedTree()),
                    "typeagent-config": JSON.stringify({
                        msGraph: { clientSecret: unrelatedSentinels[0] },
                        storage: {
                            database: {
                                cosmosDbConnectionString: unrelatedSentinels[1],
                            },
                        },
                        speech: { apiKey: unrelatedSentinels[2] },
                        openAI: { apiKey: unrelatedSentinels[3] },
                    }),
                },
                requests,
            ),
            log: (message) => logs.push(message),
            getUid: () => 10001,
            platform: "win32",
        });

        expect(requests).toEqual([`api-vault/${HOSTED_API_SECRET_NAME}`]);
        expect(config.modelProvider).toBe("azure");
        expect(
            config.azureOpenAI.deployments.get("gpt_6_luna")?.endpoints[0]
                .endpoint,
        ).toBe(ALLOWED_ENDPOINT);
        expect(env.TYPEAGENT_SHAREDVAULT).toBeUndefined();
        expect(env.TYPEAGENT_CONFIG_LOCAL).toBeUndefined();
        expect(env.OPENAI_ENDPOINT).toBeUndefined();
        expect(env.AZURE_OPENAI_ENDPOINT).toBe(ALLOWED_ENDPOINT);
        expect(env.AWS_S3_BUCKET_NAME).toBeUndefined();
        expect(env.AZURE_STORAGE_ACCOUNT).toBeUndefined();
        expect(env.COSMOSDB_ENDPOINT).toBeUndefined();
        expect(env.WIKIPEDIA_ENDPOINT).toBeUndefined();
        const runtime = serializedRuntime(env, config, logs);
        for (const sentinel of unrelatedSentinels) {
            expect(runtime).not.toContain(sentinel);
        }
        expect(fs.readdirSync(env.TYPEAGENT_USER_DATA_DIR as string)).toEqual(
            [],
        );
    });

    test("missing required configuration fails before a listener starts", async () => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        let listenerStarted = false;

        await expect(
            startAfterBootstrap(
                () =>
                    loadHostedApiRuntimeConfig({
                        env,
                        fetcher: async () => null,
                        getUid: () => 10001,
                        platform: "win32",
                    }),
                async () => {
                    listenerStarted = true;
                },
            ),
        ).rejects.toThrow(
            "Dedicated hosted API configuration secret is missing or empty.",
        );

        expect(listenerStarted).toBe(false);
        expect(fs.readdirSync(env.TYPEAGENT_USER_DATA_DIR as string)).toEqual(
            [],
        );
    });

    test("shared vault and legacy files never override the dedicated source", async () => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        const legacyDir = path.join(root, "legacy");
        fs.mkdirSync(legacyDir);
        fs.writeFileSync(
            path.join(legacyDir, ".env"),
            "AZURE_OPENAI_ENDPOINT=https://dotenv-sentinel.invalid\n",
        );
        fs.writeFileSync(
            path.join(legacyDir, "config.local.yaml"),
            "azureOpenAI:\n  defaultChat:\n    endpoint: https://local-sentinel.invalid\n",
        );
        env.TYPEAGENT_SHAREDVAULT = "shared-vault-sentinel";
        env.TYPEAGENT_CONFIG_DIR = legacyDir;
        env.TYPEAGENT_DOTENV = path.join(legacyDir, ".env");
        env.AZURE_OPENAI_ENDPOINT = "https://environment-sentinel.invalid";
        env.AZURE_CLIENT_ID = "ambient-client-id";
        env.TYPEAGENT_API_MANAGED_IDENTITY_CLIENT_ID = "dedicated-client-id";

        const requests: string[] = [];
        const config = await loadHostedApiRuntimeConfig({
            env,
            fetcher: fakeVault(
                {
                    [HOSTED_API_SECRET_NAME]: JSON.stringify(hostedTree()),
                    "typeagent-config": JSON.stringify({
                        azureOpenAI: {
                            defaultChat: {
                                endpoint:
                                    "https://shared-vault-sentinel.invalid",
                            },
                        },
                    }),
                },
                requests,
            ),
            getUid: () => 10001,
            platform: "win32",
        });

        expect(requests).toEqual([`api-vault/${HOSTED_API_SECRET_NAME}`]);
        expect(
            config.azureOpenAI.deployments.get("gpt_6_luna")?.endpoints[0]
                .endpoint,
        ).toBe(ALLOWED_ENDPOINT);
        expect(env.AZURE_OPENAI_ENDPOINT).toBe(ALLOWED_ENDPOINT);
        expect(env.TYPEAGENT_SHAREDVAULT).toBeUndefined();
        expect(env.TYPEAGENT_CONFIG_DIR).toBeUndefined();
        expect(env.TYPEAGENT_DOTENV).toBeUndefined();
        expect(env.AZURE_CLIENT_ID).toBe("dedicated-client-id");
    });

    test("rejects secret-shaped fields without logging their values", async () => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        const sentinel = "dedicated-secret-value-sentinel";
        const logs: string[] = [];
        const unsafe = hostedTree();
        const azure = unsafe.azureOpenAI as ConfigTree;
        azure.apiKey = sentinel;

        await expect(
            loadHostedApiRuntimeConfig({
                env,
                fetcher: async () => JSON.stringify(unsafe),
                log: (message) => logs.push(message),
                getUid: () => 10001,
                platform: "win32",
            }),
        ).rejects.toThrow(
            "Static credential field 'azureOpenAI.apiKey' is not allowed.",
        );
        expect(JSON.stringify({ env, logs })).not.toContain(sentinel);
    });

    test("rejects static credential environment variables", async () => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        env.OPENAI_API_KEY = "static-environment-secret-sentinel";

        await expect(
            loadHostedApiRuntimeConfig({
                env,
                fetcher: async () => JSON.stringify(hostedTree()),
                getUid: () => 10001,
                platform: "win32",
            }),
        ).rejects.toThrow(
            "Static credential environment variable 'OPENAI_API_KEY' is not allowed.",
        );
    });

    test("rejects the Cosmos DB connection string without leaking it", async () => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        const sentinel = "cosmosdb-environment-credential-sentinel";
        const previousProcessValue = process.env.COSMOSDB_CONNECTION_STRING;
        const logs: string[] = [];
        env.COSMOSDB_CONNECTION_STRING = sentinel;

        let failure = "";
        try {
            await loadHostedApiRuntimeConfig({
                env,
                fetcher: async () => JSON.stringify(hostedTree()),
                log: (message) => logs.push(message),
                getUid: () => 10001,
                platform: "win32",
            });
        } catch (error) {
            failure = String(error);
        }

        expect(failure).toContain(
            "Static credential environment variable 'COSMOSDB_CONNECTION_STRING' is not allowed.",
        );
        expect(failure).not.toContain(sentinel);
        expect(logs.join("\n")).not.toContain(sentinel);
        expect(process.env.COSMOSDB_CONNECTION_STRING).toBe(
            previousProcessValue,
        );
        expect(fs.readdirSync(env.TYPEAGENT_USER_DATA_DIR as string)).toEqual(
            [],
        );
    });

    test.each([
        "AWS_SECRET_ACCESS_KEY",
        "AZURE_STORAGE_CONNECTION_STRING",
        "MONGODB_CONNECTION_STRING",
        "WIKIPEDIA_CLIENT_SECRET",
    ])("rejects unrelated static credential %s", async (key) => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        env[key] = "unrelated-static-credential-sentinel";

        await expect(
            loadHostedApiRuntimeConfig({
                env,
                fetcher: async () => JSON.stringify(hostedTree()),
                getUid: () => 10001,
                platform: "win32",
            }),
        ).rejects.toThrow(
            `Static credential environment variable '${key}' is not allowed.`,
        );
    });

    test("sanitizes malformed dedicated secret errors", async () => {
        const root = createTempRoot();
        roots.push(root);
        const env = createEnvironment(root);
        const sentinel = "malformed-secret-sentinel";

        await expect(
            loadHostedApiRuntimeConfig({
                env,
                fetcher: async () => `profile: [${sentinel}`,
                getUid: () => 10001,
                platform: "win32",
            }),
        ).rejects.toThrow(
            "Failed to fetch or validate the dedicated hosted API configuration secret.",
        );

        try {
            await loadHostedApiRuntimeConfig({
                env,
                fetcher: async () => `profile: [${sentinel}`,
                getUid: () => 10001,
                platform: "win32",
            });
        } catch (error) {
            expect(String(error)).not.toContain(sentinel);
        }
    });

    test("rejects root and persistent Azure CLI account state", async () => {
        const root = createTempRoot();
        roots.push(root);
        const rootEnv = createEnvironment(path.join(root, "root-case"));
        await expect(
            loadHostedApiRuntimeConfig({
                env: rootEnv,
                fetcher: async () => JSON.stringify(hostedTree()),
                getUid: () => 0,
                platform: "linux",
            }),
        ).rejects.toThrow("Hosted API startup refuses to run as root.");

        const azureEnv = createEnvironment(path.join(root, "azure-case"));
        fs.mkdirSync(path.join(azureEnv.HOME as string, ".azure"));
        await expect(
            loadHostedApiRuntimeConfig({
                env: azureEnv,
                fetcher: async () => JSON.stringify(hostedTree()),
                getUid: () => 10001,
                platform: "win32",
            }),
        ).rejects.toThrow(
            "Hosted API startup refuses persistent Azure CLI credential state.",
        );
    });
});
