// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CollisionRegistry } from "../src/context/collisionRegistry.js";
import type {
    Neighborhood,
    NeighborhoodPreview,
} from "../src/neighborhoods/types.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-collreg-"));
}

function writePreview(dir: string, neighborhoods: Neighborhood[]): string {
    const preview: NeighborhoodPreview = {
        builtAt: new Date().toISOString(),
        sources: {
            similarityStrategy: "test",
            similarityThreshold: 0.5,
            minMisrouteCount: 1,
            includeSameSchema: true,
        },
        neighborhoods,
    };
    const file = path.join(dir, "neighborhoods.json");
    fs.writeFileSync(file, JSON.stringify(preview), "utf8");
    return file;
}

const sampleNeighborhood: Neighborhood = {
    id: "play-cluster",
    kind: "cross-schema",
    members: [
        { schemaName: "player", actionName: "play" },
        { schemaName: "video", actionName: "play" },
    ],
    evidence: {},
    sources: ["similarity"],
};

describe("collisionRegistry.CollisionRegistry", () => {
    it("empty() is empty", () => {
        const reg = CollisionRegistry.empty();
        expect(reg.isEmpty).toBe(true);
        expect(
            reg.isKnownAmbiguous({ schemaName: "player", actionName: "play" }),
        ).toBe(false);
    });

    it("load(undefined) yields an empty registry", () => {
        expect(CollisionRegistry.load(undefined).isEmpty).toBe(true);
    });

    it("load of a missing path yields an empty registry", () => {
        expect(
            CollisionRegistry.load("/no/such/neighborhoods.json").isEmpty,
        ).toBe(true);
    });

    it("loads neighborhoods and indexes members", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [sampleNeighborhood]);
            const reg = CollisionRegistry.load(file);
            expect(reg.isEmpty).toBe(false);
            expect(
                reg.isKnownAmbiguous({
                    schemaName: "player",
                    actionName: "play",
                }),
            ).toBe(true);
            expect(
                reg.isKnownAmbiguous({
                    schemaName: "list",
                    actionName: "addItems",
                }),
            ).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("siblingsOf returns co-members excluding self", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [sampleNeighborhood]);
            const reg = CollisionRegistry.load(file);
            const sibs = reg.siblingsOf({
                schemaName: "player",
                actionName: "play",
            });
            expect(sibs).toEqual([
                { schemaName: "video", actionName: "play" },
            ]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("siblingsOf is empty for an unknown member", () => {
        const dir = tmpdir();
        try {
            const file = writePreview(dir, [sampleNeighborhood]);
            const reg = CollisionRegistry.load(file);
            expect(
                reg.siblingsOf({ schemaName: "list", actionName: "addItems" }),
            ).toEqual([]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("load tolerates a malformed file", () => {
        const dir = tmpdir();
        try {
            const file = path.join(dir, "neighborhoods.json");
            fs.writeFileSync(file, "not json", "utf8");
            expect(CollisionRegistry.load(file).isEmpty).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
