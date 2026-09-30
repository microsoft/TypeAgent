// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { CopilotSession } from "@github/copilot-sdk";
import type { JoinSessionConfig } from "@github/copilot-sdk/extension";
import type {
    AgentServerConnection,
    CatalogEntry,
    SkillIdentity,
} from "@typeagent/agent-server-client";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { joinTypeAgentSession } from "../src/extension/session-host.js";

const identity: SkillIdentity = {
    scope: "project",
    origin: "c:/src/project",
    name: "calendar",
};
const revision = "a".repeat(64);
const skillContent = Buffer.from("# Calendar\n");

function entry(): CatalogEntry {
    return {
        state: "active",
        active: true,
        revision: {
            identity,
            qualifiedName: "project:c%3A%2Fsrc%2Fproject:calendar",
            revision,
            displayName: "Calendar",
            description: "Calendar skill",
            schemaFingerprint: "schema-1",
            createdAt: "2026-09-22T00:00:00.000Z",
            manifest: [
                {
                    path: "SKILL.md",
                    size: skillContent.byteLength,
                    sha256: createHash("sha256")
                        .update(skillContent)
                        .digest("hex"),
                },
            ],
        },
    };
}

function connection(): AgentServerConnection {
    return {
        getSkill: jest.fn(async () => entry()),
        readSkillFile: jest.fn(async () => ({
            content: skillContent.toString("base64"),
            encoding: "base64" as const,
            mimeType: "text/markdown",
        })),
        close: jest.fn(async () => {}),
    } as unknown as AgentServerConnection;
}

function sdkSession() {
    let shutdown: (() => void) | undefined;
    const disconnect = jest.fn(async () => {});
    const session = {
        disconnect,
        on: jest.fn((event: string, handler: () => void) => {
            if (event === "session.shutdown") shutdown = handler;
            return () => {};
        }),
    } as unknown as CopilotSession;
    return { session, disconnect, shutdown: () => shutdown?.() };
}

describe("live extension skill session integration", () => {
    let temporaryRoot: string;

    beforeEach(async () => {
        temporaryRoot = await mkdtemp(
            path.join(tmpdir(), "typeagent-extension-session-test-"),
        );
    });

    afterEach(async () => {
        await rm(temporaryRoot, { recursive: true, force: true });
    });

    it("passes only verified selected skills to the live SDK join", async () => {
        const sdk = sdkSession();
        let joinedConfig: JoinSessionConfig | undefined;
        const lifecycle = await joinTypeAgentSession(
            { requestedEnvironmentVariables: ["TYPEAGENT_TUNNEL_TOKEN"] },
            {
                getSelections: () => [{ identity }],
                join: jest.fn(async (config: JoinSessionConfig) => {
                    joinedConfig = config;
                    return sdk.session;
                }),
                materialization: {
                    connect: async () => connection(),
                    serverIdentity: "ws://server.example:8999",
                    temporaryRoot,
                },
            },
        );

        expect(joinedConfig).toMatchObject({
            requestedEnvironmentVariables: ["TYPEAGENT_TUNNEL_TOKEN"],
            enableConfigDiscovery: false,
            enableFileHooks: false,
            enableSkills: true,
            includedBuiltinSkills: [],
            pluginDirectories: [],
            skillDirectories: [expect.any(String)],
        });
        expect(
            await readFile(
                path.join(joinedConfig!.skillDirectories![0], "SKILL.md"),
                "utf8",
            ),
        ).toBe("# Calendar\n");

        await lifecycle.close();

        expect(sdk.disconnect).toHaveBeenCalledTimes(1);
        expect(await readdir(temporaryRoot)).toEqual([]);
    });

    it("cleans materialized files when joining the SDK session fails", async () => {
        await expect(
            joinTypeAgentSession(
                {},
                {
                    getSelections: () => [{ identity }],
                    join: jest.fn(async () => {
                        throw new Error("join failed");
                    }),
                    materialization: {
                        connect: async () => connection(),
                        serverIdentity: "ws://server.example:8999",
                        temporaryRoot,
                    },
                },
            ),
        ).rejects.toThrow("join failed");

        expect(await readdir(temporaryRoot)).toEqual([]);
    });

    it("preserves the existing join configuration with no selections", async () => {
        const sdk = sdkSession();
        const join = jest.fn(async () => sdk.session);

        const lifecycle = await joinTypeAgentSession(
            { enableConfigDiscovery: true },
            {
                getSelections: () => [],
                join,
            },
        );

        expect(join).toHaveBeenCalledWith({ enableConfigDiscovery: true });
        await lifecycle.close();
    });

    it("cleans materialized files when the live session shuts down", async () => {
        const sdk = sdkSession();
        await joinTypeAgentSession(
            {},
            {
                getSelections: () => [{ identity }],
                join: async () => sdk.session,
                materialization: {
                    connect: async () => connection(),
                    serverIdentity: "ws://server.example:8999",
                    temporaryRoot,
                },
            },
        );

        sdk.shutdown();
        await delay(20);

        expect(await readdir(temporaryRoot)).toEqual([]);
    });
});
