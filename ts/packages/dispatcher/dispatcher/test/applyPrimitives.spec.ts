// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    appendExampleTag,
    checksumFile,
    markDeprecated,
    replaceManifestDescription,
    writeActionConfigOverride,
} from "../src/neighborhoods/optimize/apply.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-apply-prim-"));
}

function writeAgent(
    sandboxDir: string,
    schemaName: string,
    files: Record<string, string>,
): void {
    const dir = path.join(sandboxDir, "agents", schemaName);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content);
    }
}

describe("replaceManifestDescription", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("rewrites schema.description and preserves other fields", () => {
        const manifest = {
            emojiChar: "🎧",
            description: "Agent",
            schema: {
                description: "Old description.",
                schemaType: "PlayerActions",
                schemaFile: "./schema.ts",
            },
        };
        const manifestJson = JSON.stringify(manifest, undefined, 2);
        writeAgent(sandbox, "player", {
            "manifest.json": manifestJson,
        });

        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "manifest.json"),
        );
        replaceManifestDescription({
            sandboxDir: sandbox,
            schemaName: "player",
            newDescription: "New, wider description.",
            originalChecksum: checksum,
        });

        const updated = JSON.parse(
            fs.readFileSync(
                path.join(sandbox, "agents", "player", "manifest.json"),
                "utf-8",
            ),
        );
        expect(updated.schema.description).toBe("New, wider description.");
        expect(updated.schema.schemaType).toBe("PlayerActions");
        expect(updated.schema.schemaFile).toBe("./schema.ts");
        expect(updated.emojiChar).toBe("🎧");
    });

    it("throws on checksum mismatch", () => {
        writeAgent(sandbox, "player", {
            "manifest.json": JSON.stringify({
                schema: {
                    description: "x",
                    schemaType: "X",
                    schemaFile: "./s.ts",
                },
            }),
        });
        expect(() =>
            replaceManifestDescription({
                sandboxDir: sandbox,
                schemaName: "player",
                newDescription: "y",
                originalChecksum: "not-the-real-hash",
            }),
        ).toThrow(/drift detected/i);
    });
});

describe("appendExampleTag (ts)", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("appends User:/Agent: lines above the existing comment block", () => {
        const schemaTs = [
            "// One-line identity.",
            "export interface PlayTrackAction {",
            "    actionName: 'playTrack';",
            "}",
            "",
        ].join("\n");
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.ts": schemaTs,
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.ts"),
        );
        appendExampleTag({
            sandboxDir: sandbox,
            schemaName: "player",
            sourceKind: "ts",
            target: "PlayTrackAction",
            examples: [{ user: "play Yellow Submarine", agent: "playing it" }],
            originalChecksum: checksum,
        });
        const updated = fs.readFileSync(
            path.join(sandbox, "agents", "player", "schema.ts"),
            "utf-8",
        );
        const lines = updated.split("\n");
        // Examples inserted ABOVE the existing identity comment.
        const exampleIdx = lines.findIndex((l) =>
            l.includes("User: play Yellow Submarine"),
        );
        const identityIdx = lines.findIndex((l) =>
            l.includes("One-line identity."),
        );
        const interfaceIdx = lines.findIndex((l) =>
            l.startsWith("export interface PlayTrackAction"),
        );
        expect(exampleIdx).toBeGreaterThanOrEqual(0);
        expect(exampleIdx).toBeLessThan(identityIdx);
        expect(identityIdx).toBeLessThan(interfaceIdx);
    });

    it("works even when the interface has no existing comment block", () => {
        const schemaTs = [
            "export interface PlayTrackAction {",
            "    actionName: 'playTrack';",
            "}",
            "",
        ].join("\n");
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.ts": schemaTs,
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.ts"),
        );
        appendExampleTag({
            sandboxDir: sandbox,
            schemaName: "player",
            sourceKind: "ts",
            target: "PlayTrackAction",
            examples: [{ user: "play X", agent: "ok" }],
            originalChecksum: checksum,
        });
        const updated = fs.readFileSync(
            path.join(sandbox, "agents", "player", "schema.ts"),
            "utf-8",
        );
        expect(updated).toMatch(/User: play X/);
        expect(updated).toMatch(/Agent: ok/);
    });
});

describe("appendExampleTag (pas)", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("appends User:/Agent: lines to the action's comments array", () => {
        const pas = {
            version: 1,
            entry: {},
            types: {
                PlayTrackAction: {
                    name: "PlayTrackAction",
                    comments: ["Play a track."],
                    fields: {
                        actionName: { typeEnum: ["playTrack"] },
                    },
                },
            },
        };
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.pas.json": JSON.stringify(pas, undefined, 2),
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.pas.json"),
        );
        appendExampleTag({
            sandboxDir: sandbox,
            schemaName: "player",
            sourceKind: "pas",
            target: "playTrack",
            pasActionName: "playTrack",
            examples: [{ user: "play X", agent: "playing X" }],
            originalChecksum: checksum,
        });
        const updated = JSON.parse(
            fs.readFileSync(
                path.join(sandbox, "agents", "player", "schema.pas.json"),
                "utf-8",
            ),
        );
        expect(updated.types.PlayTrackAction.comments).toEqual([
            "Play a track.",
            "User: play X",
            "Agent: playing X",
        ]);
    });

    it("throws when sourceKind is pas but pasActionName missing", () => {
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.pas.json": "{}",
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.pas.json"),
        );
        expect(() =>
            appendExampleTag({
                sandboxDir: sandbox,
                schemaName: "player",
                sourceKind: "pas",
                target: "ignored",
                examples: [],
                originalChecksum: checksum,
            }),
        ).toThrow(/pasActionName is required/);
    });
});

describe("markDeprecated (ts)", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("inserts @deprecated line at top of comment block", () => {
        const schemaTs = [
            "// Identity line.",
            "export interface PlayTrackAction {",
            "    actionName: 'playTrack';",
            "}",
            "",
        ].join("\n");
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.ts": schemaTs,
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.ts"),
        );
        markDeprecated({
            sandboxDir: sandbox,
            schemaName: "player",
            sourceKind: "ts",
            target: "PlayTrackAction",
            reason: "absorbed by playSong",
            originalChecksum: checksum,
        });
        const updated = fs.readFileSync(
            path.join(sandbox, "agents", "player", "schema.ts"),
            "utf-8",
        );
        expect(updated).toMatch(/@deprecated absorbed by playSong/);
        // Identity line still present after the deprecated tag.
        expect(updated).toMatch(/Identity line\./);
    });

    it("is idempotent — re-applying with the original checksum noops", () => {
        const schemaTs = [
            "// @deprecated already gone",
            "// Identity.",
            "export interface PlayTrackAction { actionName: 'playTrack'; }",
            "",
        ].join("\n");
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.ts": schemaTs,
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.ts"),
        );
        const result = markDeprecated({
            sandboxDir: sandbox,
            schemaName: "player",
            sourceKind: "ts",
            target: "PlayTrackAction",
            reason: "x",
            originalChecksum: checksum,
        });
        // No files written = idempotent no-op.
        expect(result.filesWritten).toEqual([]);
    });
});

describe("markDeprecated (pas)", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("prepends [DEPRECATED] prefix to the action's first comment", () => {
        const pas = {
            version: 1,
            entry: {},
            types: {
                PlayTrackAction: {
                    name: "PlayTrackAction",
                    comments: ["Play a track."],
                    fields: { actionName: { typeEnum: ["playTrack"] } },
                },
            },
        };
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.pas.json": JSON.stringify(pas, undefined, 2),
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.pas.json"),
        );
        markDeprecated({
            sandboxDir: sandbox,
            schemaName: "player",
            sourceKind: "pas",
            target: "playTrack",
            pasActionName: "playTrack",
            reason: "absorbed by playSong",
            originalChecksum: checksum,
        });
        const updated = JSON.parse(
            fs.readFileSync(
                path.join(sandbox, "agents", "player", "schema.pas.json"),
                "utf-8",
            ),
        );
        expect(updated.types.PlayTrackAction.comments[0]).toMatch(
            /^\[DEPRECATED\] absorbed by playSong/,
        );
    });

    it("is idempotent for already-deprecated PAS actions", () => {
        const pas = {
            version: 1,
            entry: {},
            types: {
                PlayTrackAction: {
                    name: "PlayTrackAction",
                    comments: ["[DEPRECATED] absorbed by playSong. Play."],
                    fields: { actionName: { typeEnum: ["playTrack"] } },
                },
            },
        };
        writeAgent(sandbox, "player", {
            "manifest.json": "{}",
            "schema.pas.json": JSON.stringify(pas, undefined, 2),
        });
        const checksum = checksumFile(
            path.join(sandbox, "agents", "player", "schema.pas.json"),
        );
        const result = markDeprecated({
            sandboxDir: sandbox,
            schemaName: "player",
            sourceKind: "pas",
            target: "playTrack",
            pasActionName: "playTrack",
            reason: "again",
            originalChecksum: checksum,
        });
        expect(result.filesWritten).toEqual([]);
    });
});

describe("writeActionConfigOverride", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("writes overrides/<schema>.actionConfig.json with sorted droppedActions", () => {
        writeActionConfigOverride({
            sandboxDir: sandbox,
            schemaName: "player",
            droppedActions: ["pause", "stop", "playTrack"],
        });
        const overridePath = path.join(
            sandbox,
            "overrides",
            "player.actionConfig.json",
        );
        expect(fs.existsSync(overridePath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(overridePath, "utf-8"));
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.droppedActions).toEqual(["pause", "playTrack", "stop"]);
    });

    it("creates the overrides directory if missing", () => {
        // Sandbox has no overrides dir yet.
        writeActionConfigOverride({
            sandboxDir: sandbox,
            schemaName: "player",
            droppedActions: ["a"],
        });
        expect(
            fs.existsSync(
                path.join(sandbox, "overrides", "player.actionConfig.json"),
            ),
        ).toBe(true);
    });
});
