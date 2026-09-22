// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    AgentServerConnection,
    CatalogEntry,
    SkillIdentity,
} from "@typeagent/agent-server-client";
import {
    SkillsCatalogAdapter,
    parseSkillResourceUri,
    skillResourceUri,
} from "../src/mcp/skillsServer.js";

const identity: SkillIdentity = {
    scope: "project",
    origin: "c:/src/project",
    name: "calendar",
};

const entry: CatalogEntry = {
    state: "active",
    active: true,
    revision: {
        identity,
        qualifiedName: "project:c%3A%2Fsrc%2Fproject:calendar",
        revision: "a".repeat(64),
        displayName: "Calendar",
        description: "Calendar skill",
        schemaFingerprint: "schema-1",
        createdAt: "2026-09-22T00:00:00.000Z",
        manifest: [
            {
                path: "docs/SKILL.md",
                sha256: "b".repeat(64),
                size: 5,
            },
        ],
    },
};

function connection(overrides: Partial<AgentServerConnection> = {}) {
    return {
        close: jest.fn(async () => {}),
        listSkills: jest.fn(async () => [entry]),
        ...overrides,
    } as unknown as AgentServerConnection;
}

describe("skills MCP adapter", () => {
    it("lists and searches through short-lived agent-server connections", async () => {
        const client = connection({
            searchSkills: jest.fn(async () => [
                { entry, score: 1, source: "exact" as const },
            ]),
        });
        const adapter = new SkillsCatalogAdapter({
            connect: jest.fn(async () => client),
        });

        const listed = await adapter.listSkills({ activeOnly: true });
        const searched = await adapter.searchSkills({ query: "calendar" });

        expect(listed.isError).toBeUndefined();
        expect(listed.content[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining("Calendar"),
        });
        expect(searched.content[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining('"source": "exact"'),
        });
        expect(client.close).toHaveBeenCalledTimes(2);
    });

    it("discovers file resources and reads base64 content", async () => {
        const readSkillFile = jest.fn(async () => ({
            content: Buffer.from("hello").toString("base64"),
            encoding: "base64" as const,
            mimeType: "text/markdown",
        }));
        const client = connection({ readSkillFile });
        const adapter = new SkillsCatalogAdapter({
            connect: jest.fn(async () => client),
        });

        const listed = await adapter.listResources();
        const uri = listed.resources[0].uri;
        const read = await adapter.readResource(new URL(uri));

        expect(listed.resources[0]).toMatchObject({
            name: expect.stringContaining("docs/SKILL.md"),
            mimeType: "text/markdown",
        });
        expect(parseSkillResourceUri(new URL(uri))).toEqual({
            identity,
            revision: "a".repeat(64),
            path: "docs/SKILL.md",
        });
        expect(read.contents[0]).toMatchObject({
            blob: Buffer.from("hello").toString("base64"),
            mimeType: "text/markdown",
        });
        expect(readSkillFile).toHaveBeenCalledWith({
            identity,
            revision: "a".repeat(64),
            path: "docs/SKILL.md",
        });
    });

    it("round-trips collision-safe origin-qualified resource identities", () => {
        const other = { ...identity, origin: "c:/src/other:project" };
        const uri = skillResourceUri(
            other,
            "c".repeat(64),
            "references/guide.md",
        );
        expect(parseSkillResourceUri(new URL(uri))).toEqual({
            identity: other,
            revision: "c".repeat(64),
            path: "references/guide.md",
        });
    });

    it("returns Skills extension entries with verbatim frontmatter and digests", async () => {
        const activeEntry: CatalogEntry = {
            ...entry,
            active: true,
            revision: {
                ...entry.revision,
                manifest: [
                    {
                        path: "SKILL.md",
                        sha256: "d".repeat(64),
                        size: 84,
                    },
                    {
                        path: "references/guide.md",
                        sha256: "e".repeat(64),
                        size: 12,
                    },
                ],
            },
        };
        const skillMarkdown = [
            "---",
            "name: calendar",
            "description: Calendar skill",
            "metadata:",
            "  team: productivity",
            "---",
            "# Calendar",
            "",
        ].join("\n");
        const client = connection({
            listSkills: jest.fn(async () => [activeEntry]),
            getSkill: jest.fn(async () => activeEntry),
            readSkillFile: jest.fn(async () => ({
                content: Buffer.from(skillMarkdown).toString("base64"),
                encoding: "base64" as const,
                mimeType: "text/markdown",
            })),
        });
        const adapter = new SkillsCatalogAdapter({
            connect: jest.fn(async () => client),
        });

        const listed = await adapter.listProtocolSkills();
        const fetched = await adapter.getProtocolSkill(listed.skills[0].uri);

        expect(listed).toMatchObject({
            resultType: "complete",
            ttlMs: 300_000,
            cacheScope: "private",
            skills: [
                {
                    frontmatter: {
                        name: "calendar",
                        description: "Calendar skill",
                        metadata: { team: "productivity" },
                    },
                    resources: [
                        { digest: `sha256:${"d".repeat(64)}`, size: 84 },
                        { digest: `sha256:${"e".repeat(64)}`, size: 12 },
                    ],
                },
            ],
        });
        expect(fetched.skill).toEqual(listed.skills[0]);
    });

    it("rejects traversal in skill resource URIs", () => {
        expect(() =>
            skillResourceUri(identity, "c".repeat(64), "../literal"),
        ).toThrow("Unsafe skill file path");
    });

    it("returns MCP tool errors and still closes the connection", async () => {
        const client = connection({
            getSkill: jest.fn(async () => {
                throw new Error("catalog unavailable");
            }),
        });
        const adapter = new SkillsCatalogAdapter({
            connect: jest.fn(async () => client),
        });

        await expect(adapter.getSkill({ identity })).resolves.toMatchObject({
            isError: true,
            content: [
                expect.objectContaining({
                    text: "catalog unavailable",
                }),
            ],
        });
        expect(client.close).toHaveBeenCalledTimes(1);
    });
});
