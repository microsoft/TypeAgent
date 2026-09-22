// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SkillCatalog,
    qualifySkill,
    validateSkillPath,
    type SkillIdentity,
} from "../src/index.js";
import { MemoryStorage } from "./memoryStorage.js";

const userSkill: SkillIdentity = {
    scope: "user",
    origin: "local",
    name: "music",
};

function packageInput(content = "first", identity: SkillIdentity = userSkill) {
    return {
        identity,
        displayName: "Music",
        description: "Controls music",
        schemaFingerprint: "schema-v1",
        files: [
            { path: "skill.json", content },
            {
                path: "grammar/main.ag.json",
                content: new Uint8Array([1, 2, 3]),
            },
        ],
    };
}

describe("SkillCatalog", () => {
    it("publishes immutable, content-addressed revisions with full manifests", async () => {
        const storage = new MemoryStorage();
        const catalog = new SkillCatalog(storage);
        const first = await catalog.publish(packageInput());
        const repeated = await catalog.publish(packageInput());
        const second = await catalog.publish(packageInput("second"));

        expect(first.revision.revision).toHaveLength(64);
        expect(repeated.revision.revision).toBe(first.revision.revision);
        expect(second.revision.revision).not.toBe(first.revision.revision);
        expect(first.revision.manifest).toEqual([
            expect.objectContaining({ path: "grammar/main.ag.json", size: 3 }),
            expect.objectContaining({ path: "skill.json", size: 5 }),
        ]);
        expect(
            new TextDecoder().decode(
                await catalog.readFile(
                    userSkill,
                    first.revision.revision,
                    "skill.json",
                ),
            ),
        ).toBe("first");
    });

    it("enforces lifecycle, active pointers, and rollback", async () => {
        const catalog = new SkillCatalog(new MemoryStorage());
        const first = await catalog.publish(packageInput());
        const second = await catalog.publish(packageInput("second"));

        await expect(
            catalog.activate(userSkill, first.revision.revision),
        ).rejects.toThrow("Only approved");
        await catalog.transition(
            userSkill,
            first.revision.revision,
            "validated",
        );
        await catalog.transition(
            userSkill,
            first.revision.revision,
            "approved",
        );
        await catalog.activate(userSkill, first.revision.revision);
        await catalog.transition(
            userSkill,
            second.revision.revision,
            "validated",
        );
        await catalog.transition(
            userSkill,
            second.revision.revision,
            "approved",
        );
        await catalog.activate(userSkill, second.revision.revision);

        expect(
            (await catalog.get(userSkill, first.revision.revision))?.state,
        ).toBe("approved");
        expect((await catalog.get(userSkill))?.revision.revision).toBe(
            second.revision.revision,
        );
        expect(
            (await catalog.rollback(userSkill, first.revision.revision)).active,
        ).toBe(true);
        expect((await catalog.get(userSkill))?.revision.revision).toBe(
            first.revision.revision,
        );
    });

    it("supports disabling and terminal archival", async () => {
        const catalog = new SkillCatalog(new MemoryStorage());
        const entry = await catalog.publish(packageInput());
        await catalog.transition(
            userSkill,
            entry.revision.revision,
            "validated",
        );
        await catalog.transition(
            userSkill,
            entry.revision.revision,
            "approved",
        );
        await catalog.activate(userSkill, entry.revision.revision);
        await catalog.transition(
            userSkill,
            entry.revision.revision,
            "disabled",
        );
        expect(await catalog.get(userSkill)).toBeUndefined();
        await catalog.transition(
            userSkill,
            entry.revision.revision,
            "archived",
        );
        await expect(
            catalog.transition(userSkill, entry.revision.revision, "draft"),
        ).rejects.toThrow("Invalid catalog transition");
    });

    it("keeps scope and origin collisions distinct", async () => {
        const catalog = new SkillCatalog(new MemoryStorage());
        const project = { ...userSkill, scope: "project" as const };
        const otherOrigin = { ...userSkill, origin: "team/package" };
        await catalog.publish(packageInput("user", userSkill));
        await catalog.publish(packageInput("project", project));
        await catalog.publish(packageInput("origin", otherOrigin));

        expect(
            (await catalog.list()).map((entry) => entry.revision.qualifiedName),
        ).toEqual(
            [
                qualifySkill(project),
                qualifySkill(otherOrigin),
                qualifySkill(userSkill),
            ].sort(),
        );
    });

    it("uses exact search before a pluggable semantic provider", async () => {
        const catalog = new SkillCatalog(new MemoryStorage());
        await catalog.publish(packageInput());
        let semanticCalls = 0;
        const semantic = {
            search: async (
                _query: { text: string },
                candidates: Awaited<ReturnType<SkillCatalog["list"]>>,
            ) => {
                semanticCalls++;
                return [
                    {
                        entry: candidates[0],
                        score: 0.7,
                        source: "semantic" as const,
                    },
                ];
            },
        };
        expect(
            (await catalog.search({ text: "Music" }, semantic))[0].source,
        ).toBe("exact");
        expect(semanticCalls).toBe(0);
        expect(
            (await catalog.search({ text: "audio" }, semantic))[0].source,
        ).toBe("semantic");
    });

    it.each([
        "",
        "/absolute",
        "C:/absolute",
        "../escape",
        "a/../escape",
        "a\\b",
        "a//b",
        "./a",
    ])("rejects unsafe path %j", (path) => {
        expect(() => validateSkillPath(path)).toThrow("Unsafe");
    });

    it("does not expose partially staged publication", async () => {
        const storage = new MemoryStorage();
        storage.failWritesContaining = "/revisions/";
        const catalog = new SkillCatalog(storage);
        await expect(catalog.publish(packageInput())).rejects.toThrow(
            "Injected write failure",
        );
        expect(await catalog.list()).toEqual([]);
        expect(
            [...storage.values.keys()].some((key) => key.includes("/staging/")),
        ).toBe(false);
    });

    it("detects file tampering using the manifest", async () => {
        const storage = new MemoryStorage();
        const catalog = new SkillCatalog(storage);
        const entry = await catalog.publish(packageInput());
        const filePath = [...storage.values.keys()].find((path) =>
            path.endsWith("/files/skill.json"),
        );
        expect(filePath).toBeDefined();
        storage.values.set(filePath!, new TextEncoder().encode("wrong"));
        await expect(
            catalog.readFile(userSkill, entry.revision.revision, "skill.json"),
        ).rejects.toThrow("integrity");
    });
});
