// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    CorpusEntryNotFoundError,
    ExternalSourceExistsError,
    FileCorpusService,
    InvalidAgentNameError,
    computeEntryId,
    formatJsonl,
    parseJsonl,
    type CorpusEntry,
    type CorpusWritable,
} from "../src/corpus/index.js";

async function makeTempRoot(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "typeagent-core-corpus-"));
}

/**
 * Read the entries staged under the private captures area for an agent. The
 * captures area is not part of the federated `list` view, so promote/append
 * tests inspect it directly.
 */
async function readCaptures(
    profileDir: string,
    agent: string,
): Promise<CorpusEntry[]> {
    const dir = path.join(profileDir, "captures", agent);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const out: CorpusEntry[] = [];
    for (const f of files.filter((n) => n.endsWith(".jsonl")).sort()) {
        const text = await fs.readFile(path.join(dir, f), "utf8");
        for (const line of text.split("\n").filter((l) => l.trim())) {
            out.push(JSON.parse(line) as CorpusEntry);
        }
    }
    return out;
}

function entry(
    utterance: string,
    agent: string,
    overrides: Partial<CorpusEntry> = {},
): CorpusEntry {
    const provenance = overrides.provenance ?? { sourceUri: "<test>" };
    const result: CorpusEntry = {
        id: overrides.id ?? computeEntryId(utterance, agent),
        utterance,
        agent,
        source: overrides.source ?? "in-repo",
        provenance,
    };
    if (overrides.expectedAction !== undefined) {
        result.expectedAction = overrides.expectedAction;
    }
    if (overrides.feedback !== undefined) {
        result.feedback = overrides.feedback;
    }
    if (overrides.tags !== undefined) {
        result.tags = overrides.tags;
    }
    return result;
}

describe("computeEntryId", () => {
    it("is deterministic for the same tuple", () => {
        const a = computeEntryId("play music", "player");
        const b = computeEntryId("play music", "player");
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{16}$/);
    });

    it("differs when requestId differs", () => {
        const a = computeEntryId("play music", "player", "r1");
        const b = computeEntryId("play music", "player", "r2");
        expect(a).not.toBe(b);
    });

    it("differs across agents and utterances", () => {
        expect(computeEntryId("x", "a")).not.toBe(computeEntryId("x", "b"));
        expect(computeEntryId("x", "a")).not.toBe(computeEntryId("y", "a"));
    });
});

describe("JSONL parse/format round-trip", () => {
    it("round-trips a list of entries", () => {
        const entries = [
            entry("play music", "player"),
            entry("what's on my calendar", "calendar", {
                tags: ["smoke"],
                provenance: { sourceUri: "/x" },
            }),
        ];
        const text = formatJsonl(entries);
        const parsed = parseJsonl(text);
        expect(parsed).toEqual(entries);
    });

    it("formats empty list as the empty string", () => {
        expect(formatJsonl([])).toBe("");
    });

    it("skips blank lines", () => {
        const text = `\n${JSON.stringify(entry("x", "a"))}\n\n`;
        expect(parseJsonl(text)).toHaveLength(1);
    });

    it("throws on malformed JSON with line number", () => {
        expect(() => parseJsonl("{not-json}\n", "f.jsonl")).toThrow(
            /f\.jsonl:1/,
        );
    });

    it("throws on objects that don't shape-check", () => {
        expect(() => parseJsonl(`{"id":"x"}\n`)).toThrow(/shape-check/);
    });
});

describe("FileCorpusService — list", () => {
    let repoRoot: string;
    let profileDir: string;
    let svc: FileCorpusService;

    beforeEach(async () => {
        repoRoot = await makeTempRoot();
        profileDir = await makeTempRoot();
        svc = new FileCorpusService({ repoRoot, profileDir });
    });

    afterEach(async () => {
        await fs.rm(repoRoot, { recursive: true, force: true });
        await fs.rm(profileDir, { recursive: true, force: true });
    });

    it("returns the empty list when no sources exist", async () => {
        expect(await svc.list("player")).toEqual([]);
    });

    it("federates in-repo + external + feedback, deduped by id", async () => {
        // in-repo
        const inRepo = entry("play jazz", "player", { source: "in-repo" });
        await fs.mkdir(path.join(repoRoot, "corpus"), { recursive: true });
        await fs.writeFile(
            path.join(repoRoot, "corpus", "player.utterances.jsonl"),
            JSON.stringify(inRepo) + "\n",
            "utf8",
        );

        // external
        const extPath = path.join(profileDir, "ext.jsonl");
        const external = entry("skip", "player", {
            source: "external",
            provenance: { sourceUri: extPath },
        });
        await fs.writeFile(extPath, JSON.stringify(external) + "\n", "utf8");
        await svc.addExternalSource({
            name: "ext1",
            agent: "player",
            kind: "jsonl-file",
            filePath: extPath,
        });

        // feedback provider
        const feedback = entry("resume", "player", {
            source: "feedback",
            provenance: { sourceUri: "<fb>" },
        });
        svc = new FileCorpusService({
            repoRoot,
            profileDir,
            feedbackProvider: async () => [feedback],
        });

        const all = await svc.list("player");
        const utterances = all.map((e) => e.utterance).sort();
        expect(utterances).toEqual(["play jazz", "resume", "skip"]);
    });

    it("dedupes by id across sources", async () => {
        const e = entry("play", "player", { source: "in-repo" });
        await fs.mkdir(path.join(repoRoot, "corpus"), { recursive: true });
        await fs.writeFile(
            path.join(repoRoot, "corpus", "player.utterances.jsonl"),
            JSON.stringify(e) + "\n",
            "utf8",
        );
        svc = new FileCorpusService({
            repoRoot,
            profileDir,
            feedbackProvider: async () => [{ ...e, source: "feedback" }],
        });
        const all = await svc.list("player");
        expect(all).toHaveLength(1);
        // First-source-wins: in-repo wins because it's loaded first.
        expect(all[0].source).toBe("in-repo");
    });
});

describe("FileCorpusService — filter", () => {
    let repoRoot: string;
    let profileDir: string;
    let svc: FileCorpusService;

    beforeEach(async () => {
        repoRoot = await makeTempRoot();
        profileDir = await makeTempRoot();
        const entries: CorpusEntry[] = [
            entry("Play jazz", "player", {
                id: "a",
                tags: ["music"],
                provenance: { sourceUri: "x", capturedAt: 100 },
            }),
            entry("Pause", "player", {
                id: "b",
                tags: ["control", "music"],
                provenance: { sourceUri: "x", capturedAt: 200 },
                feedback: { rating: "down", recordedAt: 250 },
            }),
            entry("Skip song", "player", {
                id: "c",
                tags: ["control"],
                provenance: { sourceUri: "x", capturedAt: 300 },
                feedback: { rating: "up", recordedAt: 350 },
            }),
        ];
        await fs.mkdir(path.join(repoRoot, "corpus"), { recursive: true });
        await fs.writeFile(
            path.join(repoRoot, "corpus", "player.utterances.jsonl"),
            entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
            "utf8",
        );
        svc = new FileCorpusService({ repoRoot, profileDir });
    });

    afterEach(async () => {
        await fs.rm(repoRoot, { recursive: true, force: true });
        await fs.rm(profileDir, { recursive: true, force: true });
    });

    it("filters by utteranceContains (case-insensitive)", async () => {
        const r = await svc.list("player", { utteranceContains: "play" });
        expect(r.map((e) => e.id)).toEqual(["a"]);
    });

    it("filters by tagsAny", async () => {
        const r = await svc.list("player", { tagsAny: ["music"] });
        expect(r.map((e) => e.id).sort()).toEqual(["a", "b"]);
    });

    it("filters by tagsAll", async () => {
        const r = await svc.list("player", {
            tagsAll: ["control", "music"],
        });
        expect(r.map((e) => e.id)).toEqual(["b"]);
    });

    it("filters by hasFeedback", async () => {
        const yes = await svc.list("player", { hasFeedback: true });
        expect(yes.map((e) => e.id).sort()).toEqual(["b", "c"]);
        const no = await svc.list("player", { hasFeedback: false });
        expect(no.map((e) => e.id)).toEqual(["a"]);
    });

    it("filters by feedbackRating", async () => {
        const r = await svc.list("player", { feedbackRating: "down" });
        expect(r.map((e) => e.id)).toEqual(["b"]);
    });

    it("filters by since/until on capturedAt", async () => {
        const r = await svc.list("player", { since: 150, until: 250 });
        expect(r.map((e) => e.id)).toEqual(["b"]);
    });

    it("filters by source", async () => {
        const r = await svc.list("player", { sources: ["captures"] });
        expect(r).toEqual([]);
    });
});

describe("FileCorpusService — append / promote / export", () => {
    let repoRoot: string;
    let profileDir: string;
    let svc: FileCorpusService;
    let clock: number;

    beforeEach(async () => {
        repoRoot = await makeTempRoot();
        profileDir = await makeTempRoot();
        clock = 1_700_000_000_000;
        svc = new FileCorpusService({
            repoRoot,
            profileDir,
            now: () => clock,
        });
    });

    afterEach(async () => {
        await fs.rm(repoRoot, { recursive: true, force: true });
        await fs.rm(profileDir, { recursive: true, force: true });
    });

    it("append writes a timestamped JSONL into captures/<agent>/", async () => {
        const e = entry("play", "player", { source: "in-repo" });
        const file = await svc.append("player", [e]);
        expect(
            file.startsWith(path.join(profileDir, "captures", "player")),
        ).toBe(true);
        expect(file.endsWith(".jsonl")).toBe(true);

        const staged = await readCaptures(profileDir, "player");
        expect(staged).toHaveLength(1);
        expect(staged[0].source).toBe("captures");
        expect(staged[0].provenance.capturedAt).toBe(clock);
    });

    it("promote moves entries from captures into the in-repo file and removes them from captures", async () => {
        const e1 = entry("play", "player");
        const e2 = entry("pause", "player");
        await svc.append("player", [e1, e2]);

        const moved = await svc.promote("player", [e1.id], "in-repo");
        expect(moved).toBe(1);

        const inRepoText = await fs.readFile(
            path.join(repoRoot, "corpus", "player.utterances.jsonl"),
            "utf8",
        );
        expect(inRepoText).toContain('"play"');
        expect(inRepoText).not.toContain('"pause"');

        const remaining = await readCaptures(profileDir, "player");
        expect(remaining.map((e) => e.utterance)).toEqual(["pause"]);
        const promoted = await svc.list("player", { sources: ["in-repo"] });
        expect(promoted.map((e) => e.utterance)).toEqual(["play"]);
        expect(promoted[0].source).toBe("in-repo");
    });

    it("promote throws CorpusEntryNotFoundError for unknown ids and leaves files unchanged", async () => {
        await svc.append("player", [entry("play", "player")]);
        const beforeCaptures = await readCaptures(profileDir, "player");
        await expect(
            svc.promote("player", ["nope"], "in-repo"),
        ).rejects.toBeInstanceOf(CorpusEntryNotFoundError);
        const afterCaptures = await readCaptures(profileDir, "player");
        expect(afterCaptures).toEqual(beforeCaptures);
        const inRepo = await svc.list("player", { sources: ["in-repo"] });
        expect(inRepo).toEqual([]);
    });

    it("promote dedupes against entries already in the in-repo file", async () => {
        const e = entry("play", "player");
        // Pre-seed in-repo with the same entry.
        await fs.mkdir(path.join(repoRoot, "corpus"), { recursive: true });
        await fs.writeFile(
            path.join(repoRoot, "corpus", "player.utterances.jsonl"),
            JSON.stringify({ ...e, source: "in-repo" }) + "\n",
            "utf8",
        );
        await svc.append("player", [e]);

        await svc.promote("player", [e.id], "in-repo");
        const inRepoText = await fs.readFile(
            path.join(repoRoot, "corpus", "player.utterances.jsonl"),
            "utf8",
        );
        const lines = inRepoText
            .trim()
            .split("\n")
            .filter((l) => l.length > 0);
        expect(lines).toHaveLength(1);
    });

    it("exportJsonl writes filtered entries to a Writable", async () => {
        const e1 = entry("play", "player");
        const e2 = entry("pause", "player");
        await svc.append("player", [e1, e2]);
        await svc.promote("player", [e1.id, e2.id], "in-repo");
        const chunks: string[] = [];
        let ended = false;
        const out: CorpusWritable = {
            write: (c) => {
                chunks.push(c);
                return true;
            },
            end: () => {
                ended = true;
            },
        };
        const n = await svc.exportJsonl("player", out, {
            utteranceContains: "play",
        });
        expect(n).toBe(1);
        expect(ended).toBe(true);
        expect(chunks.join("")).toContain('"play"');
        expect(chunks.join("")).not.toContain('"pause"');
    });
});

describe("FileCorpusService — external sources", () => {
    let repoRoot: string;
    let profileDir: string;
    let svc: FileCorpusService;

    beforeEach(async () => {
        repoRoot = await makeTempRoot();
        profileDir = await makeTempRoot();
        svc = new FileCorpusService({ repoRoot, profileDir });
    });

    afterEach(async () => {
        await fs.rm(repoRoot, { recursive: true, force: true });
        await fs.rm(profileDir, { recursive: true, force: true });
    });

    it("adds, lists, and removes external sources", async () => {
        const spec = {
            name: "team",
            agent: "player",
            kind: "jsonl-file" as const,
            filePath: "/x.jsonl",
        };
        await svc.addExternalSource(spec);
        expect(await svc.listExternalSources("player")).toEqual([spec]);
        expect(await svc.listExternalSources("calendar")).toEqual([]);

        await svc.removeExternalSource("player", "team");
        expect(await svc.listExternalSources()).toEqual([]);
    });

    it("rejects duplicate (agent, name) registrations", async () => {
        const spec = {
            name: "team",
            agent: "player",
            kind: "jsonl-file" as const,
            filePath: "/x.jsonl",
        };
        await svc.addExternalSource(spec);
        await expect(svc.addExternalSource(spec)).rejects.toBeInstanceOf(
            ExternalSourceExistsError,
        );
    });

    it("persists external source registrations to .typeagent/studio.json", async () => {
        await svc.addExternalSource({
            name: "team",
            agent: "player",
            kind: "jsonl-file",
            filePath: "/x.jsonl",
        });
        const text = await fs.readFile(
            path.join(repoRoot, ".typeagent", "studio.json"),
            "utf8",
        );
        expect(JSON.parse(text).externalSources).toHaveLength(1);
    });

    it("seedInRepoCorpus creates an empty in-repo file when absent and is idempotent", async () => {
        const expected = path.join(
            repoRoot,
            "corpus",
            "player.utterances.jsonl",
        );

        const first = await svc.seedInRepoCorpus("player");
        expect(first.created).toBe(true);
        expect(path.normalize(first.path)).toBe(path.normalize(expected));
        expect(await fs.readFile(expected, "utf8")).toBe("");

        // Second call must not clobber existing content.
        await fs.writeFile(expected, '{"utterance":"hi"}\n', "utf8");
        const second = await svc.seedInRepoCorpus("player");
        expect(second.created).toBe(false);
        expect(await fs.readFile(expected, "utf8")).toBe(
            '{"utterance":"hi"}\n',
        );
    });

    it("rejects agent names that would escape the corpus root (path traversal)", async () => {
        for (const bad of ["../evil", "..", "a/b", "a\\b", ".", ""]) {
            await expect(svc.seedInRepoCorpus(bad)).rejects.toBeInstanceOf(
                InvalidAgentNameError,
            );
            // Read paths are guarded too.
            await expect(svc.list(bad)).rejects.toBeInstanceOf(
                InvalidAgentNameError,
            );
        }
        // Nothing was written outside the corpus directory.
        await expect(
            fs.readFile(path.join(repoRoot, "evil.utterances.jsonl"), "utf8"),
        ).rejects.toThrow();
    });
});
