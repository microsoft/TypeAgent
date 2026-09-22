// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import type { MacroManager } from "@typeagent/copilot-macros";
import {
    SkillCatalog,
    type InstanceStorage,
    type SkillIdentity,
} from "@typeagent/skill-catalog";
import type { ConversationManager } from "../src/conversationManager.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";

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
        const { handler } = createAgentServerConnectionHandler({
            conversationManager: {} as ConversationManager,
            macroManager: {} as MacroManager,
            skillCatalog: new SkillCatalog(new MemoryStorage()),
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
            files: [{ path: "SKILL.md", content: "first" }],
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
});
