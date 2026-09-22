// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import type { MacroManager } from "@typeagent/copilot-macros";
import {
    LiveSkillCatalog,
    type ProcessRunner,
    type SkillAcquisitionProvider,
    type SkillAcquisitionSource,
    type InstanceStorage,
    type SkillIdentity,
} from "@typeagent/skill-catalog";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ConversationManager } from "../src/conversationManager.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import { createLocalSkillServices } from "../src/skillCatalog.js";

class MemoryStorage implements InstanceStorage {
    private readonly values = new Map<string, Uint8Array>();

    public async read(path: string): Promise<Uint8Array>;
    public async read(
        path: string,
        encoding: "utf8" | "base64",
    ): Promise<string>;
    public async read(
        path: string,
        encoding?: "utf8" | "base64",
    ): Promise<Uint8Array | string> {
        const value = this.values.get(path);
        if (value === undefined) throw new Error(`Not found: ${path}`);
        if (encoding === "utf8") return new TextDecoder().decode(value);
        if (encoding === "base64") return Buffer.from(value).toString("base64");
        return value.slice();
    }

    public async write(
        path: string,
        data: string,
        encoding?: "utf8" | "base64",
    ): Promise<void>;
    public async write(path: string, data: Uint8Array): Promise<void>;
    public async write(
        path: string,
        data: string | Uint8Array,
        encoding: "utf8" | "base64" = "utf8",
    ): Promise<void> {
        this.values.set(
            path,
            typeof data === "string"
                ? encoding === "base64"
                    ? Buffer.from(data, "base64")
                    : new TextEncoder().encode(data)
                : data.slice(),
        );
    }

    public async list(
        path: string,
        options?: { dirs?: boolean; fullPath?: boolean },
    ): Promise<string[]> {
        const prefix = `${path}/`;
        return [
            ...new Set(
                [...this.values.keys()]
                    .filter((key) => key.startsWith(prefix))
                    .map((key) => key.slice(prefix.length).split("/")[0]),
            ),
        ].filter((name) =>
            options?.dirs
                ? [...this.values.keys()].some((key) =>
                      key.startsWith(`${prefix}${name}/`),
                  )
                : true,
        );
    }

    public async exists(path: string): Promise<boolean> {
        return (
            this.values.has(path) ||
            [...this.values.keys()].some((key) => key.startsWith(`${path}/`))
        );
    }

    public async delete(path: string): Promise<void> {
        this.values.delete(path);
    }
}

describe("skill catalog RPC", () => {
    it("publishes, discovers, reads, activates, and rolls back revisions", async () => {
        let clientAdapter: ChannelProviderAdapter | undefined;
        const serverAdapter = createChannelProviderAdapter(
            "skills-rpc:server",
            (message) => clientAdapter?.notifyMessage(message),
        );
        clientAdapter = createChannelProviderAdapter(
            "skills-rpc:client",
            (message) => serverAdapter.notifyMessage(message),
        );
        const skillCatalog = await LiveSkillCatalog.create(new MemoryStorage());
        const { handler } = createAgentServerConnectionHandler({
            conversationManager: {} as ConversationManager,
            macroManager: {} as MacroManager,
            skillCatalog,
            shutdown: () => {},
            getUserIdentity: () => ({
                username: "test",
                displayName: "Test",
                initial: "T",
            }),
        });
        handler(serverAdapter, () => {});
        const connection = createAgentServerConnection(clientAdapter, () => {});
        const identity: SkillIdentity = {
            scope: "project",
            origin: "test-project",
            name: "calendar",
        };

        const first = await connection.publishSkill!({
            identity,
            displayName: "Calendar",
            schemaFingerprint: "schema-1",
            files: [
                { path: "SKILL.md", content: "first" },
                {
                    path: "routing/main.ag.json",
                    content: JSON.stringify({
                        rules: [
                            {
                                parts: [
                                    {
                                        type: "string",
                                        value: ["pause"],
                                        partId: 0,
                                    },
                                ],
                                value: { type: "literal", value: true },
                            },
                        ],
                        ruleArrays: [[0]],
                    }),
                },
            ],
        });
        const second = await connection.publishSkill!({
            identity,
            displayName: "Calendar",
            schemaFingerprint: "schema-1",
            files: [{ path: "SKILL.md", content: "second" }],
        });
        expect(
            await connection.listSkills!({ scopes: ["project"] }),
        ).toHaveLength(2);
        expect(
            (await connection.searchSkills!({ query: "calendar" })).length,
        ).toBe(2);
        expect(
            await connection.getSkill!({
                identity,
                revision: first.revision.revision,
            }),
        ).toMatchObject({ state: "draft" });
        await connection.changeSkillState!({
            identity,
            revision: first.revision.revision,
            state: "validated",
        });
        await connection.changeSkillState!({
            identity,
            revision: first.revision.revision,
            state: "approved",
        });
        await connection.activateSkill!({
            identity,
            revision: first.revision.revision,
        });
        expect(await connection.searchSkills!({ query: "pause" })).toEqual([
            expect.objectContaining({
                source: "grammar",
                entry: {
                    revision: expect.objectContaining({
                        revision: first.revision.revision,
                    }),
                    state: "active",
                    active: true,
                },
            }),
        ]);
        expect(await connection.matchSkillGrammar!("pause")).toMatchObject({
            outcome: { status: "match" },
        });
        await connection.changeSkillState!({
            identity,
            revision: second.revision.revision,
            state: "validated",
        });
        await connection.changeSkillState!({
            identity,
            revision: second.revision.revision,
            state: "approved",
        });
        await connection.activateSkill!({
            identity,
            revision: second.revision.revision,
        });
        expect(
            (
                await connection.rollbackSkill!({
                    identity,
                    revision: first.revision.revision,
                })
            ).active,
        ).toBe(true);
        const file = await connection.readSkillFile!({
            identity,
            revision: first.revision.revision,
            path: "SKILL.md",
        });
        expect(file).toEqual({
            content: Buffer.from("first").toString("base64"),
            encoding: "base64",
            mimeType: "text/markdown",
        });
        await connection.close();
    });

    it("previews, checks, acquires, and updates through an injected provider", async () => {
        const instanceDir = path.join(
            process.cwd(),
            `.skill-acquisition-rpc-test-${randomUUID()}`,
        );
        const runner = new OfflineProcessRunner();
        const provider = new FixtureGitProvider(instanceDir);
        try {
            const { skillCatalog, skillAcquirer } =
                await createLocalSkillServices(instanceDir, {
                    processRunner: runner,
                    providers: [provider],
                });
            let clientAdapter: ChannelProviderAdapter | undefined;
            const serverAdapter = createChannelProviderAdapter(
                "skill-acquisition-rpc:server",
                (message) => clientAdapter?.notifyMessage(message),
            );
            clientAdapter = createChannelProviderAdapter(
                "skill-acquisition-rpc:client",
                (message) => serverAdapter.notifyMessage(message),
            );
            const { handler } = createAgentServerConnectionHandler({
                conversationManager: {} as ConversationManager,
                macroManager: {} as MacroManager,
                skillCatalog,
                skillAcquirer,
                shutdown: () => {},
                getUserIdentity: () => ({
                    username: "test",
                    displayName: "Test",
                    initial: "T",
                }),
            });
            handler(serverAdapter, () => {});
            const connection = createAgentServerConnection(
                clientAdapter,
                () => {},
            );
            const request = {
                identity: {
                    scope: "project" as const,
                    origin: "offline-test",
                    name: "calendar",
                },
                schemaFingerprint: "schema-1",
                source: {
                    type: "git" as const,
                    repository: "https://example.invalid/skills.git",
                    ref: "main",
                },
            };

            const preview = await connection.previewSkillAcquisition!(request);
            expect(preview).toMatchObject({
                sourceFingerprint: "commit-one",
                manifest: expect.arrayContaining([
                    expect.objectContaining({ path: "SKILL.md" }),
                ]),
            });
            expect(await connection.checkSkillUpdate!(request)).toMatchObject({
                updateAvailable: true,
                sourceFingerprint: "commit-one",
            });
            const first = await connection.acquireAndPublishSkill!(request);
            expect(first).toMatchObject({
                updated: true,
                revision: first.entry.revision.revision,
                state: "draft",
                active: false,
                sourceFingerprint: "commit-one",
                entry: { state: "draft", active: false },
            });
            await approveAndActivate(
                connection,
                request.identity,
                first.entry.revision.revision,
            );
            expect(await connection.searchSkills!({ query: "pause" })).toEqual([
                expect.objectContaining({ source: "grammar" }),
            ]);
            expect(await connection.checkSkillUpdate!(request)).toMatchObject({
                updateAvailable: false,
                currentState: "active",
            });

            provider.fingerprint = "commit-two";
            provider.utterance = "resume";
            expect(await connection.checkSkillUpdate!(request)).toMatchObject({
                updateAvailable: true,
                sourceChanged: true,
                contentChanged: true,
            });
            const second = await connection.updateSkill!(request);
            expect(second).toMatchObject({
                updated: true,
                sourceFingerprint: "commit-two",
                entry: { state: "draft", active: false },
            });
            expect(second.entry.revision.revision).not.toBe(
                first.entry.revision.revision,
            );
            await approveAndActivate(
                connection,
                request.identity,
                second.entry.revision.revision,
            );
            expect(await connection.searchSkills!({ query: "resume" })).toEqual(
                [expect.objectContaining({ source: "grammar" })],
            );
            await expect(
                connection.previewSkillAcquisition!({
                    ...request,
                    source: { ...request.source, ref: "" },
                }),
            ).rejects.toThrow(/explicit/);
            expect(runner.calls).toBeGreaterThan(0);
            expect(provider.stagedInsideOwnedRoot).toBe(true);
            await connection.close();
        } finally {
            await rm(instanceDir, {
                recursive: true,
                force: true,
            });
        }
    });
});

type GitSource = Extract<SkillAcquisitionSource, { type: "git" }>;

class FixtureGitProvider implements SkillAcquisitionProvider<GitSource> {
    public readonly type = "git" as const;
    public fingerprint = "commit-one";
    public utterance = "pause";
    public stagedInsideOwnedRoot = false;

    public constructor(private readonly instanceDir: string) {}

    public async stage(
        source: GitSource,
        context: Parameters<SkillAcquisitionProvider<GitSource>["stage"]>[1],
    ) {
        expect(source).toMatchObject({
            repository: "https://example.invalid/skills.git",
            ref: "main",
        });
        this.stagedInsideOwnedRoot = context.stagingDirectory.startsWith(
            path.join(this.instanceDir, "skill-acquisition-staging"),
        );
        await context.processRunner.run("offline-fixture", [], {
            timeoutMs: context.limits.processTimeoutMs,
            maxOutputBytes: context.limits.maxProcessOutputBytes,
        });
        const root = path.join(context.stagingDirectory, "content");
        await mkdir(path.join(root, "routing"), { recursive: true });
        await writeFile(
            path.join(root, "SKILL.md"),
            "---\nname: calendar\ndescription: Offline calendar\n---\n",
        );
        await writeFile(
            path.join(root, "routing", "main.ag.json"),
            JSON.stringify({
                rules: [
                    {
                        parts: [
                            {
                                type: "string",
                                value: [this.utterance],
                                partId: 0,
                            },
                        ],
                        value: { type: "literal", value: true },
                    },
                ],
                ruleArrays: [[0]],
            }),
        );
        return {
            root,
            sourceFingerprint: this.fingerprint,
            sourceDescription: `${source.repository}#${source.ref}`,
        };
    }
}

class OfflineProcessRunner implements ProcessRunner {
    public calls = 0;

    public async run() {
        this.calls++;
        return {
            stdout: new Uint8Array(),
            stderr: new Uint8Array(),
        };
    }
}

async function approveAndActivate(
    connection: ReturnType<typeof createAgentServerConnection>,
    identity: SkillIdentity,
    revision: string,
): Promise<void> {
    await connection.changeSkillState!({
        identity,
        revision,
        state: "validated",
    });
    await connection.changeSkillState!({
        identity,
        revision,
        state: "approved",
    });
    await connection.activateSkill!({ identity, revision });
}
