// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CorpusEntry, CorpusFilter } from "../src/corpus/types.js";
import {
    replayCorpus,
    type ReplayActionResolver,
    type ReplayCorpusProvider,
    type ReplayOptions,
} from "../src/replay/index.js";
import {
    createGrammarReplayResolver,
    normalizeGrammarAction,
    resolveGrammarReplayTarget,
    ReplayVersionBuildError,
    type GrammarReplayTarget,
} from "../src/replay/grammarResolver.js";

const GRAMMAR_V1 = [
    "<Start> = <Pause> | <Resume>;",
    '<Pause> = pause -> { actionName: "pause" };',
    '<Resume> = resume -> { actionName: "resume" };',
].join("\n");

// v2 drops the <Pause> rule: "pause" no longer resolves.
const GRAMMAR_V2 = [
    "<Start> = <Resume>;",
    '<Resume> = resume -> { actionName: "resume" };',
].join("\n");

function entry(id: string, utterance: string): CorpusEntry {
    return {
        id,
        utterance,
        agent: "demo",
        source: "in-repo",
        provenance: { sourceUri: `mem://${id}` },
    };
}

function target(grammarFilePath: string): GrammarReplayTarget {
    return { agent: "demo", schemaName: "demo", grammarFilePath };
}

function tempDir(): string {
    return mkdtempSync(path.join(tmpdir(), "grammar-replay-"));
}

function gitAvailable(): boolean {
    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function initGitRepo(dir: string): void {
    const run = (...args: string[]) =>
        execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    run("init");
    run("config", "user.email", "test@example.com");
    run("config", "user.name", "Test");
    run("config", "commit.gpgsign", "false");
}

describe("normalizeGrammarAction", () => {
    it("stamps schemaName and keeps the actionName", () => {
        expect(
            normalizeGrammarAction("player", { actionName: "pause" }),
        ).toEqual({ schemaName: "player", actionName: "pause" });
    });

    it("keeps non-empty parameters", () => {
        expect(
            normalizeGrammarAction("player", {
                actionName: "play",
                parameters: { trackNumber: 3 },
            }),
        ).toEqual({
            schemaName: "player",
            actionName: "play",
            parameters: { trackNumber: 3 },
        });
    });

    it("drops empty parameters so {} equals omitted", () => {
        expect(
            normalizeGrammarAction("player", {
                actionName: "pause",
                parameters: {},
            }),
        ).toEqual({ schemaName: "player", actionName: "pause" });
    });

    it("returns undefined for non-action values", () => {
        expect(normalizeGrammarAction("player", "pause")).toBeUndefined();
        expect(normalizeGrammarAction("player", null)).toBeUndefined();
        expect(normalizeGrammarAction("player", { foo: 1 })).toBeUndefined();
        expect(normalizeGrammarAction("player", [1, 2])).toBeUndefined();
    });
});

describe("createGrammarReplayResolver (working tree)", () => {
    let dir: string;
    let grammarPath: string;

    beforeEach(() => {
        dir = tempDir();
        grammarPath = path.join(dir, "schema.agr");
        writeFileSync(grammarPath, GRAMMAR_V1, "utf8");
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("resolves a matching utterance to a normalized action", async () => {
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
        });
        const res = await resolver.resolve(
            entry("e1", "pause"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("hit");
        expect(res.action).toEqual({ schemaName: "demo", actionName: "pause" });
    });

    it("reports needs-explanation for a grammar miss", async () => {
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
        });
        const res = await resolver.resolve(
            entry("e2", "teleport home"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("needs-explanation");
        expect(res.action).toBeUndefined();
    });

    it("prepare() throws ReplayVersionBuildError for an uncompilable side", async () => {
        writeFileSync(grammarPath, "this is @@@ not a grammar", "utf8");
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
        });
        await expect(
            resolver.prepare({ kind: "workingTree" }, { kind: "workingTree" }),
        ).rejects.toBeInstanceOf(ReplayVersionBuildError);
    });
});

const maybeDescribe = gitAvailable() ? describe : describe.skip;

maybeDescribe("createGrammarReplayResolver (git working-tree vs HEAD)", () => {
    let dir: string;
    let grammarPath: string;

    beforeEach(() => {
        dir = tempDir();
        grammarPath = path.join(dir, "schema.agr");
        writeFileSync(grammarPath, GRAMMAR_V1, "utf8");
        initGitRepo(dir);
        execFileSync("git", ["add", "schema.agr"], {
            cwd: dir,
            stdio: "ignore",
        });
        execFileSync("git", ["commit", "-m", "v1"], {
            cwd: dir,
            stdio: "ignore",
        });
        // Diverge the working tree: drop the <Pause> rule.
        writeFileSync(grammarPath, GRAMMAR_V2, "utf8");
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("materializes HEAD via git show and the live tree for working-tree", async () => {
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
        });
        await resolver.prepare(
            { kind: "git", ref: "HEAD" },
            { kind: "workingTree" },
        );

        const a = await resolver.resolve(
            entry("p", "pause"),
            { kind: "git", ref: "HEAD" },
            "A",
        );
        const b = await resolver.resolve(
            entry("p", "pause"),
            { kind: "workingTree" },
            "B",
        );

        // HEAD still maps "pause"; the edited working tree no longer does.
        expect(a.cacheState).toBe("hit");
        expect(a.action).toEqual({ schemaName: "demo", actionName: "pause" });
        expect(b.cacheState).toBe("needs-explanation");
    });

    it("drives a real lost-match row through replayCorpus", async () => {
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
        });
        await resolver.prepare(
            { kind: "git", ref: "HEAD" },
            { kind: "workingTree" },
        );

        const corpus: ReplayCorpusProvider = {
            async list(_agent: string, _filter: CorpusFilter) {
                return [entry("p", "pause"), entry("r", "resume")];
            },
        };
        const options: ReplayOptions = {
            agent: "demo",
            corpus: {},
            versionA: { kind: "git", ref: "HEAD" },
            versionB: { kind: "workingTree" },
            missPolicy: "needs-explanation",
        };

        const handle = replayCorpus(options, {
            corpus,
            resolver: resolver as ReplayActionResolver,
        });
        const summary = await handle.summary;

        // "resume" matches both versions (equal); "pause" matched HEAD only (lost).
        expect(summary.rowCount).toBe(2);
        expect(summary.equalCount).toBe(1);
        expect(summary.lostMatchCount).toBe(1);
        expect(summary.changedCount).toBe(0);
        expect(summary.newMatchCount).toBe(0);
    });
});

const DEMO_SCHEMA_TS = [
    "export type DemoActions = PlayTrackAction | PauseAction;",
    "",
    "// Play a track by name.",
    "export type PlayTrackAction = {",
    '    actionName: "playTrack";',
    "    parameters: {",
    "        trackName: string;",
    "    };",
    "};",
    "",
    "// Pause playback.",
    "export type PauseAction = {",
    '    actionName: "pause";',
    "};",
    "",
].join("\n");

const DEMO_PARAM_SPEC = JSON.stringify({
    paramSpec: { playTrack: { trackName: "checked_wildcard" } },
});

const DEMO_MANIFEST = JSON.stringify({
    schema: {
        originalSchemaFile: "./demoSchema.ts",
        schemaType: { action: "DemoActions" },
    },
});

/**
 * Scaffold a minimal single-schema agent package under
 * `<root>/agents/demo/src/agent/` so `resolveGrammarReplayTarget` can discover
 * the grammar AND the action schema for checked-variable enrichment.
 */
function scaffoldAgentPackage(root: string): { agentRoots: string[] } {
    const agentDir = path.join(root, "agents", "demo", "src", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, "demoSchema.agr"), GRAMMAR_V1, "utf8");
    writeFileSync(path.join(agentDir, "demoSchema.ts"), DEMO_SCHEMA_TS, "utf8");
    writeFileSync(
        path.join(agentDir, "demoSchema.json"),
        DEMO_PARAM_SPEC,
        "utf8",
    );
    writeFileSync(
        path.join(agentDir, "demoManifest.json"),
        DEMO_MANIFEST,
        "utf8",
    );
    return { agentRoots: [path.join(root, "agents")] };
}

describe("resolveGrammarReplayTarget + schema enrichment (L1)", () => {
    let dir: string;

    beforeEach(() => {
        dir = tempDir();
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("discovers the action schema and paramSpec config from the manifest", async () => {
        const { agentRoots } = scaffoldAgentPackage(dir);
        const target = await resolveGrammarReplayTarget(
            agentRoots,
            "demo",
            dir,
        );
        expect(target).toBeDefined();
        expect(target?.schema?.actionTypeName).toBe("DemoActions");
        expect(target?.schema?.sourceFilePath).toMatch(/demoSchema\.ts$/);
        expect(target?.schema?.paramSpecConfigPath).toMatch(
            /demoSchema\.json$/,
        );
    });

    it("builds an enriched resolver that still matches utterances", async () => {
        const { agentRoots } = scaffoldAgentPackage(dir);
        const target = await resolveGrammarReplayTarget(
            agentRoots,
            "demo",
            dir,
        );
        const resolver = createGrammarReplayResolver({ target: target! });
        await resolver.prepare(
            { kind: "workingTree" },
            { kind: "workingTree" },
        );
        expect(resolver.enriched).toBe(true);

        const res = await resolver.resolve(
            entry("e1", "pause"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("hit");
        expect(res.action).toEqual({ schemaName: "demo", actionName: "pause" });
    });

    it("falls back to a non-enriched resolver when no schema is discoverable", async () => {
        const grammarPath = path.join(dir, "schema.agr");
        writeFileSync(grammarPath, GRAMMAR_V1, "utf8");
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
        });
        await resolver.prepare(
            { kind: "workingTree" },
            { kind: "workingTree" },
        );
        expect(resolver.enriched).toBe(false);

        const res = await resolver.resolve(
            entry("e1", "resume"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("hit");
        expect(res.action).toEqual({
            schemaName: "demo",
            actionName: "resume",
        });
    });
});
