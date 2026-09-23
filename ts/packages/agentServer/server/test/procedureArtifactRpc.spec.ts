// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import { MacroManager, type CopilotToolMacro } from "@typeagent/copilot-macros";
import type {
    PersonalHowToService,
    ProcedureDocument,
    ProcedureVersion,
} from "@typeagent/memory-service";
import {
    LiveSkillCatalog,
    type InstanceStorage,
} from "@typeagent/skill-catalog";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { ConversationManager } from "../src/conversationManager.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import { ProcedureArtifactRpcService } from "../src/procedureArtifacts.js";

class MemoryStorage implements InstanceStorage {
    private readonly values = new Map<string, Uint8Array>();

    public async read(filePath: string): Promise<Uint8Array>;
    public async read(
        filePath: string,
        encoding: "utf8" | "base64",
    ): Promise<string>;
    public async read(
        filePath: string,
        encoding?: "utf8" | "base64",
    ): Promise<Uint8Array | string> {
        const value = this.values.get(filePath);
        if (value === undefined) throw new Error(`Not found: ${filePath}`);
        if (encoding === "utf8") return new TextDecoder().decode(value);
        if (encoding === "base64") return Buffer.from(value).toString("base64");
        return value.slice();
    }

    public async write(
        filePath: string,
        data: string,
        encoding?: "utf8" | "base64",
    ): Promise<void>;
    public async write(filePath: string, data: Uint8Array): Promise<void>;
    public async write(
        filePath: string,
        data: string | Uint8Array,
        encoding: "utf8" | "base64" = "utf8",
    ): Promise<void> {
        this.values.set(
            filePath,
            typeof data === "string"
                ? encoding === "base64"
                    ? Buffer.from(data, "base64")
                    : new TextEncoder().encode(data)
                : data.slice(),
        );
    }

    public async list(filePath: string): Promise<string[]> {
        const prefix = `${filePath}/`;
        return [
            ...new Set(
                [...this.values.keys()]
                    .filter((key) => key.startsWith(prefix))
                    .map((key) => key.slice(prefix.length).split("/")[0]),
            ),
        ];
    }

    public async exists(filePath: string): Promise<boolean> {
        return (
            this.values.has(filePath) ||
            [...this.values.keys()].some((key) =>
                key.startsWith(`${filePath}/`),
            )
        );
    }

    public async delete(filePath: string): Promise<void> {
        this.values.delete(filePath);
    }
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortJson(child)]),
        );
    }
    return value;
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function procedure(
    state: ProcedureVersion["state"] = "saved",
): ProcedureVersion {
    const macro: CopilotToolMacro = {
        schemaVersion: 1,
        macroId: "deploy-service",
        version: 1,
        name: "Deploy service",
        description: "Deploy the reviewed service.",
        state: "approved",
        executionClass: "replayable",
        inputs: [],
        steps: [
            {
                id: "deploy",
                toolName: "deploy",
                mcpServerName: "operations",
                arguments: { kind: "literal", value: { target: "staging" } },
                executionClass: "replayable",
                sourceToolCallId: "reviewed-call",
            },
        ],
        sourceTraceId: "replaced-by-lineage",
        createdAt: "2026-09-22T00:00:00.000Z",
        warnings: [],
    };
    const document: ProcedureDocument = {
        title: "Deploy service",
        summary: "Deploy the reviewed service.",
        steps: ["Build.", "Deploy."],
        citations: [{ sourceId: "runbook", revisionId: "7" }],
        additionalSections: [
            { heading: "Automation", content: JSON.stringify(macro) },
        ],
    };
    const canonicalJson = `${JSON.stringify(sortJson(document), undefined, 2)}\n`;
    const markdown = "# Deploy service\n";
    return {
        corpusId: "operations",
        procedureId: "deploy-service",
        version: 2,
        state,
        document,
        canonicalJson,
        markdown,
        createdAt: "2026-09-22T00:00:00.000Z",
        jsonHash: hash(canonicalJson),
        markdownHash: hash(markdown),
        previousVersion: 1,
    };
}

describe("procedure artifact RPC", () => {
    const root = path.join(
        process.cwd(),
        `.procedure-artifact-rpc-${randomUUID()}`,
    );

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("previews and idempotently promotes skills and macro drafts", async () => {
        let clientAdapter: ChannelProviderAdapter | undefined;
        const serverAdapter = createChannelProviderAdapter(
            "procedure-artifact-rpc:server",
            (message) => clientAdapter?.notifyMessage(message),
        );
        clientAdapter = createChannelProviderAdapter(
            "procedure-artifact-rpc:client",
            (message) => serverAdapter.notifyMessage(message),
        );
        const saved = procedure();
        const procedureService: Pick<PersonalHowToService, "getProcedure"> = {
            getProcedure: async (_corpusId, procedureId) =>
                procedureId === saved.procedureId ? saved : undefined,
        };
        const skillCatalog = await LiveSkillCatalog.create(new MemoryStorage());
        const macroManager = new MacroManager(root);
        const { handler } = createAgentServerConnectionHandler({
            conversationManager: {} as ConversationManager,
            macroManager,
            skillCatalog,
            procedureService,
            shutdown: () => {},
            getUserIdentity: () => ({
                username: "test",
                displayName: "Test",
                initial: "T",
            }),
        });
        handler(serverAdapter, () => {});
        const connection = createAgentServerConnection(clientAdapter, () => {});
        const reference = {
            corpusId: saved.corpusId,
            procedureId: saved.procedureId,
            version: saved.version,
        };
        const skillRequest = {
            ...reference,
            kind: "skill" as const,
            skill: {
                identity: {
                    scope: "user" as const,
                    origin: "memory",
                    name: "deploy-service",
                },
            },
        };

        const skillPreview =
            await connection.previewProcedureArtifact!(skillRequest);
        expect(skillPreview).toMatchObject({
            kind: "skill",
            lineage: {
                corpusId: "operations",
                procedureId: "deploy-service",
                version: 2,
            },
            skill: {
                identity: skillRequest.skill.identity,
                files: [{ path: "SKILL.md", encoding: "utf8" }],
            },
        });
        const firstSkill =
            await connection.promoteProcedureArtifact!(skillRequest);
        const secondSkill =
            await connection.promoteProcedureArtifact!(skillRequest);
        expect(firstSkill).toEqual(secondSkill);

        const macroRequest = { ...reference, kind: "macro" as const };
        const macroPreview =
            await connection.previewProcedureArtifact!(macroRequest);
        expect(macroPreview).toMatchObject({
            kind: "macro",
            result: {
                status: "ready",
                macro: { state: "draft" },
                lineage: { previousVersion: 1 },
            },
        });
        const firstMacro =
            await connection.promoteProcedureArtifact!(macroRequest);
        const secondMacro =
            await connection.promoteProcedureArtifact!(macroRequest);
        expect(firstMacro).toEqual(secondMacro);
        expect(firstMacro).toMatchObject({
            kind: "macro",
            lineage: {
                corpusId: "operations",
                procedureId: "deploy-service",
                version: 2,
            },
            macro: {
                macroId: "deploy-service",
                version: 1,
                state: "draft",
            },
        });
        expect(await macroManager.listMacros()).toHaveLength(1);
        if (firstMacro.kind !== "macro") throw new Error("Expected macro");
        await expect(
            macroManager.validateMacro(firstMacro.macro),
        ).resolves.toMatchObject({ valid: true });
    });

    it.each(["stale", "archived"] as const)(
        "rejects a %s procedure",
        async (state) => {
            const service = new ProcedureArtifactRpcService(
                { getProcedure: async () => procedure(state) },
                await LiveSkillCatalog.create(new MemoryStorage()),
                new MacroManager(path.join(root, state)),
            );
            await expect(
                service.preview({
                    corpusId: "operations",
                    procedureId: "deploy-service",
                    version: 2,
                    kind: "macro",
                }),
            ).rejects.toThrow(`cannot be promoted from ${state} state`);
        },
    );

    it("rejects a missing exact version", async () => {
        const service = new ProcedureArtifactRpcService(
            { getProcedure: async () => undefined },
            await LiveSkillCatalog.create(new MemoryStorage()),
            new MacroManager(path.join(root, "missing")),
        );
        await expect(
            service.promote({
                corpusId: "operations",
                procedureId: "missing",
                version: 9,
                kind: "macro",
            }),
        ).rejects.toThrow("Procedure not found: operations/missing@9");
    });
});
