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
    selectValidatedMatchAction,
    type GrammarReplayTarget,
} from "../src/replay/grammarResolver.js";
import type { ConstructionCacheLayer } from "../src/replay/constructionCacheResolver.js";
import {
    createWildcardMatchValidator,
    type ReplayAppAgentLoader,
    type ReplayValidatableAgent,
    type WildcardMatchValidator,
} from "../src/replay/wildcardValidator.js";
import type { MatchResult } from "agent-cache";

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

describe("createGrammarReplayResolver (construction-cache layer, L2)", () => {
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

    // A valid layer that "resolves" only the utterance "pause" from the cache.
    function stubLayer(): ConstructionCacheLayer {
        return {
            status: "valid",
            cacheFilePath: "/stub/constructions.json",
            schemaName: "demo",
            currentHash: "hash=",
            cachedHash: "hash=",
            match(utterance: string) {
                return utterance === "pause"
                    ? { schemaName: "demo", actionName: "pause" }
                    : undefined;
            },
        };
    }

    it("reports the layer status via constructionCacheStatus", () => {
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
            constructionCache: stubLayer(),
        });
        expect(resolver.constructionCacheStatus).toBe("valid");
    });

    it("working tree: a construction hit is reported as a cache hit", async () => {
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
            constructionCache: stubLayer(),
        });
        const res = await resolver.resolve(
            entry("c1", "pause"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("hit");
        expect(res.action).toEqual({ schemaName: "demo", actionName: "pause" });
    });

    it("working tree: a grammar-only resolution is reported as a miss", async () => {
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
            constructionCache: stubLayer(),
        });
        // "resume" is not in the stub cache but the grammar resolves it.
        const res = await resolver.resolve(
            entry("c2", "resume"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("miss");
        expect(res.action).toEqual({
            schemaName: "demo",
            actionName: "resume",
        });
    });

    it("git ref side never consults the cache (construction caches are live-only)", async () => {
        let consulted = false;
        const spyLayer: ConstructionCacheLayer = {
            ...stubLayer(),
            match(utterance: string) {
                consulted = true;
                return utterance === "pause"
                    ? { schemaName: "demo", actionName: "pause" }
                    : undefined;
            },
        };
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
            constructionCache: spyLayer,
        });
        // A git ref side must not touch the live cache, even for an utterance the
        // cache would resolve on the working tree. (The temp dir is not a git
        // repo, so the grammar build degrades to needs-explanation — that's fine;
        // the assertion here is purely that the cache was never consulted.)
        const res = await resolver.resolve(
            entry("c3", "pause"),
            { kind: "git", ref: "HEAD" },
            "B",
        );
        expect(consulted).toBe(false);
        expect(res.cacheState).not.toBe("miss");
    });

    it("a stale layer leaves behavior at L1 (grammar hit)", async () => {
        const stale: ConstructionCacheLayer = {
            ...stubLayer(),
            status: "stale",
        };
        const resolver = createGrammarReplayResolver({
            target: target(grammarPath),
            constructionCache: stale,
        });
        const res = await resolver.resolve(
            entry("c4", "pause"),
            { kind: "workingTree" },
            "A",
        );
        // Not consulted: a plain grammar hit, not a cache miss.
        expect(res.cacheState).toBe("hit");
        expect(res.action).toEqual({ schemaName: "demo", actionName: "pause" });
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

// ---------------------------------------------------------------------------
// Working-tree wildcard validation
// ---------------------------------------------------------------------------

// A grammar whose <PlayTrack> rule captures a greedy wildcard (so a match has
// wildcardCharCount > 0 and is subject to validateWildcardMatch), plus a
// non-wildcard <Pause> rule (validator never consulted).
const WILDCARD_GRAMMAR = [
    "<Start> = <PlayTrack> | <Pause>;",
    '<PlayTrack> = play $(trackName:wildcard) -> { actionName: "playTrack", parameters: { trackName } };',
    '<Pause> = pause -> { actionName: "pause" };',
].join("\n");

function wildcardLoader(agent: ReplayValidatableAgent): ReplayAppAgentLoader {
    return {
        async loadAppAgent() {
            return agent;
        },
        async unloadAppAgent() {},
    };
}

/** A validator (for "demo") that rejects a given track name. */
function rejectTrackValidator(reject: string): WildcardMatchValidator {
    const agent: ReplayValidatableAgent = {
        async validateWildcardMatch(a) {
            const params = (a as { parameters?: { trackName?: string } })
                .parameters;
            return params?.trackName !== reject;
        },
    };
    return createWildcardMatchValidator("demo", {
        loader: wildcardLoader(agent),
    });
}

describe("grammar resolver wildcard validation", () => {
    let dir: string;

    beforeEach(() => {
        dir = tempDir();
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function wildcardTarget(): GrammarReplayTarget {
        const grammarPath = path.join(dir, "demo.agr");
        writeFileSync(grammarPath, WILDCARD_GRAMMAR, "utf8");
        return {
            agent: "demo",
            schemaName: "demo",
            grammarFilePath: grammarPath,
        };
    }

    it("drops a wildcard match the agent rejects (→ needs-explanation)", async () => {
        const validator = rejectTrackValidator("despacito");
        const resolver = createGrammarReplayResolver({
            target: wildcardTarget(),
            wildcardValidator: validator,
        });
        await resolver.prepare(
            { kind: "workingTree" },
            { kind: "workingTree" },
        );
        const res = await resolver.resolve(
            entry("e1", "play despacito"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("needs-explanation");
        expect(res.action).toBeUndefined();
        expect(resolver.wildcardValidationApplied).toBe(true);
        await validator.dispose();
    });

    it("keeps a wildcard match the agent accepts", async () => {
        const validator = rejectTrackValidator("nope");
        const resolver = createGrammarReplayResolver({
            target: wildcardTarget(),
            wildcardValidator: validator,
        });
        await resolver.prepare(
            { kind: "workingTree" },
            { kind: "workingTree" },
        );
        const res = await resolver.resolve(
            entry("e1", "play despacito"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("hit");
        expect(res.action).toMatchObject({
            schemaName: "demo",
            actionName: "playTrack",
            parameters: { trackName: "despacito" },
        });
        await validator.dispose();
    });

    it("does not consult the validator for a non-wildcard match", async () => {
        const validator = rejectTrackValidator("despacito");
        const resolver = createGrammarReplayResolver({
            target: wildcardTarget(),
            wildcardValidator: validator,
        });
        await resolver.prepare(
            { kind: "workingTree" },
            { kind: "workingTree" },
        );
        const res = await resolver.resolve(
            entry("e1", "pause"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("hit");
        expect(res.action).toEqual({ schemaName: "demo", actionName: "pause" });
        // No wildcard match occurred, so validation never "applied".
        expect(resolver.wildcardValidationApplied).toBe(false);
        await validator.dispose();
    });

    it("behaves as plain top-match resolution when no validator is supplied", async () => {
        const resolver = createGrammarReplayResolver({
            target: wildcardTarget(),
        });
        await resolver.prepare(
            { kind: "workingTree" },
            { kind: "workingTree" },
        );
        const res = await resolver.resolve(
            entry("e1", "play despacito"),
            { kind: "workingTree" },
            "A",
        );
        expect(res.cacheState).toBe("hit");
        expect(res.action).toMatchObject({ actionName: "playTrack" });
        expect(resolver.wildcardValidationApplied).toBe(false);
    });
});

describe("selectValidatedMatchAction (ranked-list contract)", () => {
    function match(actionName: string, wildcardCharCount: number): MatchResult {
        return {
            type: "grammar",
            match: {
                actions: [{ action: { schemaName: "demo", actionName } }],
            },
            matchedCount: 1,
            wildcardCharCount,
            nonOptionalCount: 0,
            implicitParameterCount: 0,
            entityWildcardPropertyNames: [],
        } as unknown as MatchResult;
    }

    function rejectingValidator(
        rejectActionNames: string[],
    ): WildcardMatchValidator {
        const agent: ReplayValidatableAgent = {
            async validateWildcardMatch(a) {
                return !rejectActionNames.includes(
                    (a as { actionName: string }).actionName,
                );
            },
        };
        return createWildcardMatchValidator("demo", {
            loader: wildcardLoader(agent),
        });
    }

    it("falls through a rejected top wildcard match to a surviving candidate", async () => {
        // Top match (wildcard) is rejected; the 2nd wildcard match passes — so
        // this is NOT a lost match, mirroring the dispatcher's fall-back.
        const validator = rejectingValidator(["top"]);
        const result = await selectValidatedMatchAction(
            [match("top", 5), match("second", 3)],
            validator,
        );
        expect(result.consulted).toBe(true);
        expect(result.action).toMatchObject({ actionName: "second" });
    });

    it("returns no action when every wildcard candidate is rejected", async () => {
        const validator = rejectingValidator(["a", "b"]);
        const result = await selectValidatedMatchAction(
            [match("a", 2), match("b", 4)],
            validator,
        );
        expect(result.action).toBeUndefined();
        expect(result.consulted).toBe(true);
    });

    it("accepts a non-wildcard match without consulting the validator", async () => {
        const validator = rejectingValidator(["top"]);
        const result = await selectValidatedMatchAction(
            [match("top", 0)],
            validator,
        );
        expect(result.action).toMatchObject({ actionName: "top" });
        expect(result.consulted).toBe(false);
    });
});
