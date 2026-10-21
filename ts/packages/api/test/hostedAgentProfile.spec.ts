// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createDispatcher,
    DefaultIndexingServiceRegistry,
} from "agent-dispatcher";
import {
    HOSTED_API_PROFILE,
    HOSTED_API_SECRET_NAME,
    loadHostedApiRuntimeConfig,
} from "../src/containerBootstrap.js";
import {
    HOSTED_API_AGENT_NAMES,
    loadHostedApiAgentProviders,
    resolveApiAgentProfile,
    validateHostedApiAgentCapabilities,
} from "../src/hostedAgentProfile.js";

const ENDPOINT =
    "https://hosted-api.openai.azure.com/openai/deployments/gpt-6-luna/chat/completions?api-version=2025-01-01-preview";

async function loadConfig(root: string) {
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    return loadHostedApiRuntimeConfig({
        env: {
            HOME: home,
            TYPEAGENT_USER_DATA_DIR: path.join(home, ".typeagent"),
            TYPEAGENT_API_BOOTSTRAP: HOSTED_API_PROFILE,
            TYPEAGENT_API_CONFIG_VAULT: "hosted-api-vault",
            TYPEAGENT_API_CONFIG_SECRET: HOSTED_API_SECRET_NAME,
        },
        fetcher: async () =>
            JSON.stringify({
                profile: HOSTED_API_PROFILE,
                modelProvider: "azure",
                azureOpenAI: {
                    defaultAuth: "identity",
                    deployments: {
                        gpt_6_luna: {
                            endpoints: [
                                {
                                    endpoint: ENDPOINT,
                                    region: "eastus",
                                    mode: "PAYG",
                                },
                            ],
                        },
                    },
                },
            }),
        getUid: () => 10001,
        platform: "win32",
    });
}

describe("hosted API agent profile", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "hosted-api-agents-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("registers only supported hosted agents and loads their manifests", async () => {
        const providers = await loadHostedApiAgentProviders();
        const names = providers
            .flatMap((provider) => provider.getAppAgentNames())
            .sort();

        expect(names).toEqual([...HOSTED_API_AGENT_NAMES].sort());
        expect(names).toEqual(
            expect.arrayContaining(["chat", "list", "timer"]),
        );
        expect(names).not.toEqual(
            expect.arrayContaining([
                "browser",
                "discord",
                "image",
                "mcpfilesystem",
                "photo",
                "video",
            ]),
        );

        const dispatcher = await createDispatcher("hosted-api-test", {
            appAgentProviders: providers,
            agents: names,
            indexingServiceRegistry: new DefaultIndexingServiceRegistry(),
        });
        try {
            const registeredAppAgentNames = (
                await dispatcher.getStatus()
            ).agents
                .map((agent) => agent.name)
                .filter(
                    (name) =>
                        name !== "dispatcher" &&
                        !name.startsWith("dispatcher.") &&
                        name !== "system" &&
                        !name.startsWith("system."),
                )
                .sort();
            expect(registeredAppAgentNames).toEqual(names);
        } finally {
            await dispatcher.close();
        }
    });

    test("requires the identity-backed GPT deployment used by every hosted agent", async () => {
        const config = await loadConfig(root);
        expect(() => validateHostedApiAgentCapabilities(config)).not.toThrow();

        const missingDeployment = {
            ...config,
            azureOpenAI: {
                ...config.azureOpenAI,
                deployments: new Map(),
            },
        };
        expect(() =>
            validateHostedApiAgentCapabilities(missingDeployment),
        ).toThrow(
            "Hosted API agents require an identity-authenticated gpt_6_luna deployment.",
        );
    });

    test("selects the hosted catalog only for the explicit container profile", () => {
        expect(
            resolveApiAgentProfile({
                TYPEAGENT_API_BOOTSTRAP: ` ${HOSTED_API_PROFILE} `,
            }),
        ).toBe("hosted");
        expect(resolveApiAgentProfile({})).toBe("default");
    });
});
