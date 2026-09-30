// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    CopilotClientOptions,
    CopilotSession,
    SessionConfig,
} from "@github/copilot-sdk";
import type {
    AgentServerConnection,
    CatalogEntry,
    SkillIdentity,
} from "@typeagent/agent-server-client";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    createApprovedSkillSession,
    type ApprovedSkillSessionDependencies,
    type CopilotClientLike,
} from "../src/extension/skill-session.js";

const identity: SkillIdentity = {
    scope: "project",
    origin: "c:/src/project",
    name: "calendar",
};
const revision = "a".repeat(64);

function digest(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

function catalogEntry(
    files: ReadonlyArray<{ path: string; content: Buffer }>,
    state: CatalogEntry["state"] = "active",
): CatalogEntry {
    return {
        state,
        active: state === "active",
        revision: {
            identity,
            qualifiedName: "project:c%3A%2Fsrc%2Fproject:calendar",
            revision,
            displayName: "Calendar",
            description: "Calendar skill",
            schemaFingerprint: "schema-1",
            createdAt: "2026-09-22T00:00:00.000Z",
            manifest: files.map((file) => ({
                path: file.path,
                sha256: digest(file.content),
                size: file.content.byteLength,
            })),
        },
    };
}

function sessionMock() {
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

function testDependencies(
    temporaryRoot: string,
    entries: CatalogEntry[],
    contents: ReadonlyMap<string, Buffer>,
) {
    let getIndex = 0;
    const connection = {
        getSkill: jest.fn(async () => entries[getIndex++] ?? entries.at(-1)),
        readSkillFile: jest.fn(async ({ path: filePath }) => ({
            content: contents.get(filePath)!.toString("base64"),
            encoding: "base64" as const,
            mimeType: "application/octet-stream",
        })),
        close: jest.fn(async () => {}),
    } as unknown as AgentServerConnection;
    const sdk = sessionMock();
    let clientOptions: CopilotClientOptions | undefined;
    let sessionConfig: SessionConfig | undefined;
    const client: CopilotClientLike = {
        createSession: jest.fn(async (config: SessionConfig) => {
            sessionConfig = config;
            return sdk.session;
        }),
        stop: jest.fn(async () => []),
    };
    const dependencies: ApprovedSkillSessionDependencies = {
        connect: jest.fn(async () => connection),
        createClient: (options) => {
            clientOptions = options;
            return client;
        },
        serverIdentity: "ws://catalog.example:8999",
        temporaryRoot,
    };
    return {
        client,
        connection,
        dependencies,
        sdk,
        getClientOptions: () => clientOptions!,
        getSessionConfig: () => sessionConfig!,
    };
}

describe("approved Copilot skill sessions", () => {
    let temporaryRoot: string;

    beforeEach(async () => {
        temporaryRoot = await mkdtemp(
            path.join(tmpdir(), "typeagent-skill-session-test-"),
        );
    });

    afterEach(async () => {
        await rm(temporaryRoot, { recursive: true, force: true });
    });

    it("verifies every file and exposes only selected skill directories", async () => {
        const files = [
            { path: "SKILL.md", content: Buffer.from("# Calendar\n") },
            { path: "references/guide.md", content: Buffer.from("Guide\n") },
        ];
        const entry = catalogEntry(files);
        const harness = testDependencies(
            temporaryRoot,
            [entry],
            new Map(files.map((file) => [file.path, file.content])),
        );

        const managed = await createApprovedSkillSession(
            {
                skills: [{ identity }],
                session: {
                    enableConfigDiscovery: true,
                    skillDirectories: ["untrusted"],
                } as never,
            },
            harness.dependencies,
        );

        expect(harness.connection.readSkillFile).toHaveBeenCalledTimes(2);
        expect(
            await readFile(
                path.join(managed.skillDirectories[0], "SKILL.md"),
                "utf8",
            ),
        ).toBe("# Calendar\n");
        expect(managed.skillDirectories[0]).toContain(
            createHash("sha256")
                .update(harness.dependencies.serverIdentity)
                .digest("hex"),
        );
        expect(harness.getClientOptions()).toMatchObject({
            mode: "empty",
            baseDirectory: expect.stringContaining("typeagent-skill-session-"),
        });
        expect(harness.getSessionConfig()).toMatchObject({
            availableTools: [],
            enableConfigDiscovery: false,
            enableFileHooks: false,
            enableSessionStore: false,
            enableSkills: true,
            includedBuiltinSkills: [],
            pluginDirectories: [],
            remoteSession: "off",
            skillDirectories: managed.skillDirectories,
        });

        await managed.session.disconnect();
        await managed.close();

        expect(harness.sdk.disconnect).toHaveBeenCalledTimes(1);
        expect(harness.client.stop).toHaveBeenCalledTimes(1);
        expect(await readdir(temporaryRoot)).toEqual([]);
    });

    it.each(["draft", "validated", "disabled", "archived"] as const)(
        "refuses a %s revision before reading files",
        async (state) => {
            const file = { path: "SKILL.md", content: Buffer.from("skill") };
            const harness = testDependencies(
                temporaryRoot,
                [catalogEntry([file], state)],
                new Map([[file.path, file.content]]),
            );

            await expect(
                createApprovedSkillSession(
                    {
                        skills: [{ identity, revision }],
                    },
                    harness.dependencies,
                ),
            ).rejects.toThrow(`is ${state}`);

            expect(harness.connection.readSkillFile).not.toHaveBeenCalled();
            expect(await readdir(temporaryRoot)).toEqual([]);
        },
    );

    it("allows an explicitly selected approved revision", async () => {
        const file = { path: "SKILL.md", content: Buffer.from("skill") };
        const approved = catalogEntry([file], "approved");
        const harness = testDependencies(
            temporaryRoot,
            [approved],
            new Map([[file.path, file.content]]),
        );

        const managed = await createApprovedSkillSession(
            { skills: [{ identity, revision }] },
            harness.dependencies,
        );

        expect(harness.client.createSession).toHaveBeenCalledTimes(1);
        await managed.close();
    });

    it.each([
        ["size", { size: 1 }, "Size mismatch"],
        ["digest", { sha256: "b".repeat(64) }, "Digest mismatch"],
    ])("rejects a manifest %s mismatch", async (_name, change, message) => {
        const file = { path: "SKILL.md", content: Buffer.from("skill") };
        const entry = catalogEntry([file]);
        Object.assign(
            entry.revision.manifest[0] as { size: number; sha256: string },
            change,
        );
        const harness = testDependencies(
            temporaryRoot,
            [entry],
            new Map([[file.path, file.content]]),
        );

        await expect(
            createApprovedSkillSession(
                { skills: [{ identity }] },
                harness.dependencies,
            ),
        ).rejects.toThrow(message);

        expect(await readdir(temporaryRoot)).toEqual([]);
    });

    it("fails closed when approval changes during materialization", async () => {
        const file = { path: "SKILL.md", content: Buffer.from("skill") };
        const harness = testDependencies(
            temporaryRoot,
            [catalogEntry([file]), catalogEntry([file], "disabled")],
            new Map([[file.path, file.content]]),
        );

        await expect(
            createApprovedSkillSession(
                { skills: [{ identity }] },
                harness.dependencies,
            ),
        ).rejects.toThrow("is disabled");

        expect(await readdir(temporaryRoot)).toEqual([]);
    });

    it("removes materialized files when SDK session creation fails", async () => {
        const file = { path: "SKILL.md", content: Buffer.from("skill") };
        const harness = testDependencies(
            temporaryRoot,
            [catalogEntry([file])],
            new Map([[file.path, file.content]]),
        );
        harness.client.createSession = jest.fn(async () => {
            throw new Error("SDK unavailable");
        });

        await expect(
            createApprovedSkillSession(
                { skills: [{ identity }] },
                harness.dependencies,
            ),
        ).rejects.toThrow("SDK unavailable");

        expect(harness.client.stop).toHaveBeenCalledTimes(1);
        expect(await readdir(temporaryRoot)).toEqual([]);
    });
});
