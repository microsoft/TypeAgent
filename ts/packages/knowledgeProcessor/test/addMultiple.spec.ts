// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "path";
import { cleanDir } from "typeagent";
import { createEntityIndexOnStorage } from "../src/conversation/entities.js";
import { createActionIndexOnStorage } from "../src/conversation/actions.js";
import {
    ExtractedEntity,
    ExtractedAction,
} from "../src/conversation/knowledge.js";
import { createFileSystemStorageProvider } from "../src/storageProvider.js";
import { TextIndexSettings } from "../src/textIndex.js";

const settings: TextIndexSettings = {
    caseSensitive: false,
    semanticIndex: false,
    concurrency: 2,
};

function testRootPath(name: string) {
    return path.join(os.tmpdir(), "knowProc-tests", name);
}

function makeEntity(name: string, type: string): ExtractedEntity<string> {
    return {
        value: { name, type: [type] },
        sourceIds: [`src-${name}`],
    };
}

function makeAction(
    verbs: string[],
    subject: string,
    object: string,
): ExtractedAction<string> {
    return {
        value: {
            verbs,
            verbTense: "present",
            subjectEntityName: subject,
            objectEntityName: object,
            indirectObjectEntityName: "none",
        },
        sourceIds: [`src-${verbs.join("-")}`],
    };
}

describe("EntityIndex.addMultiple (parallelized)", () => {
    const rootPath = testRootPath("entityAddMultiple");

    beforeAll(async () => {
        await cleanDir(rootPath);
    });

    test("adds single entity", async () => {
        const provider = createFileSystemStorageProvider(rootPath);
        const index = await createEntityIndexOnStorage<string>(
            settings,
            rootPath,
            provider,
        );

        const entity = makeEntity("Alice", "person");
        const ids = await index.addMultiple([entity]);

        expect(ids).toHaveLength(1);
        const stored = await index.get(ids[0]);
        expect(stored?.value.name).toBe("Alice");
    });

    test("adds multiple entities and retrieves them all", async () => {
        const subRoot = path.join(rootPath, "multi");
        await cleanDir(subRoot);
        const provider = createFileSystemStorageProvider(subRoot);
        const index = await createEntityIndexOnStorage<string>(
            settings,
            subRoot,
            provider,
        );

        const entities = [
            makeEntity("Alice", "person"),
            makeEntity("Bach", "composer"),
            makeEntity("Berlin", "city"),
            makeEntity("Piano", "instrument"),
        ];

        const ids = await index.addMultiple(entities);

        expect(ids).toHaveLength(entities.length);
        // All entities should be retrievable by id
        for (let i = 0; i < entities.length; i++) {
            const stored = await index.get(ids[i]);
            expect(stored?.value.name).toBe(entities[i].value.name);
        }
    });

    test("returns empty array for empty input", async () => {
        const subRoot = path.join(rootPath, "empty");
        await cleanDir(subRoot);
        const provider = createFileSystemStorageProvider(subRoot);
        const index = await createEntityIndexOnStorage<string>(
            settings,
            subRoot,
            provider,
        );

        const ids = await index.addMultiple([]);
        expect(ids).toHaveLength(0);
    });
});

describe("ActionIndex.addMultiple (parallelized)", () => {
    const rootPath = testRootPath("actionAddMultiple");

    beforeAll(async () => {
        await cleanDir(rootPath);
    });

    test("adds multiple actions and retrieves them all", async () => {
        const subRoot = path.join(rootPath, "multi");
        await cleanDir(subRoot);

        // Action index requires a getEntityNameIndex callback — use a shared entity index
        const entityRoot = path.join(subRoot, "entities");
        const entityProvider = createFileSystemStorageProvider(entityRoot);
        const entityIndex = await createEntityIndexOnStorage<string>(
            settings,
            entityRoot,
            entityProvider,
        );
        const getEntityNameIndex = async () => ({
            nameIndex: entityIndex.nameIndex,
            nameAliases: entityIndex.nameAliases,
        });

        const actionProvider = createFileSystemStorageProvider(subRoot);
        const index = await createActionIndexOnStorage<string>(
            settings,
            getEntityNameIndex,
            subRoot,
            actionProvider,
        );

        const actions = [
            makeAction(["play"], "Alice", "Piano"),
            makeAction(["compose"], "Bach", "Symphony"),
            makeAction(["visit"], "Traveler", "Berlin"),
        ];

        const ids = await index.addMultiple(actions);

        expect(ids).toHaveLength(actions.length);
        const stored = await index.getActions(ids);
        expect(stored).toHaveLength(actions.length);

        const verbs = stored.map((a) => a.verbs[0]).sort();
        expect(verbs).toEqual(["compose", "play", "visit"]);
    });

    test("returns empty array for empty input", async () => {
        const subRoot = path.join(rootPath, "empty");
        await cleanDir(subRoot);

        const entityRoot = path.join(subRoot, "entities");
        const entityProvider = createFileSystemStorageProvider(entityRoot);
        const entityIndex = await createEntityIndexOnStorage<string>(
            settings,
            entityRoot,
            entityProvider,
        );
        const getEntityNameIndex = async () => ({
            nameIndex: entityIndex.nameIndex,
            nameAliases: entityIndex.nameAliases,
        });

        const actionProvider = createFileSystemStorageProvider(subRoot);
        const index = await createActionIndexOnStorage<string>(
            settings,
            getEntityNameIndex,
            subRoot,
            actionProvider,
        );

        const ids = await index.addMultiple([]);
        expect(ids).toHaveLength(0);
    });
});
