// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SkillCorrectionStore, type SkillIdentity } from "../src/index.js";
import { MemoryStorage } from "./memoryStorage.js";

describe("SkillCorrectionStore", () => {
    it("stores immutable corrections outside package revisions", async () => {
        const storage = new MemoryStorage();
        const store = new SkillCorrectionStore(storage);
        const skill: SkillIdentity = {
            scope: "project",
            origin: "c:/project",
            name: "calendar",
        };
        const correction = {
            skill,
            skillRevision: "revision-1",
            schemaFingerprint: "schema-1",
            grammar: { rules: [], ruleArrays: [] },
        };
        const first = await store.add(correction);
        const repeated = await store.add(correction);
        const rules = await store.grammarRules(skill, "revision-1");

        expect(repeated.id).toBe(first.id);
        expect(await store.list(skill, "revision-1")).toHaveLength(1);
        expect(rules).toEqual([
            expect.objectContaining({
                id: first.id,
                source: "userCorrection",
                skillRevision: "revision-1",
            }),
        ]);
        expect(
            [...storage.values.keys()].every(
                (path) =>
                    path.includes("/corrections/") &&
                    !path.includes("/revisions/"),
            ),
        ).toBe(true);
        expect(repeated.createdAt).toBe(first.createdAt);
    });

    it("rejects revisions that could escape correction storage", async () => {
        const store = new SkillCorrectionStore(new MemoryStorage());
        await expect(
            store.add({
                skill: {
                    scope: "user",
                    origin: "local",
                    name: "unsafe",
                },
                skillRevision: "../revision",
                schemaFingerprint: "schema",
                grammar: { rules: [], ruleArrays: [] },
            }),
        ).rejects.toThrow("Invalid skill revision");
    });
});
