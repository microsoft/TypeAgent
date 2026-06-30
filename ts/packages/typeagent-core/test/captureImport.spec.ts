// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    FileCorpusService,
    computeEntryId,
    importCaptureEntries,
    importDisplayLogs,
    type CaptureLogEntry,
    type CorpusEntry,
} from "../src/corpus/index.js";

async function makeTempRoot(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "typeagent-core-import-"));
}

function makeCorpus(root: string): FileCorpusService {
    return new FileCorpusService({
        repoRoot: path.join(root, "repo"),
        profileDir: path.join(root, "profile"),
        now: () => 1000,
    });
}

function capture(
    utterance: string,
    agent: string,
    action: unknown,
): CorpusEntry {
    return {
        id: computeEntryId(utterance, agent),
        utterance,
        agent,
        source: "captures",
        provenance: { sourceUri: "<test>", capturedAt: 1000 },
        expectedAction: action,
    };
}

async function writeLog(
    file: string,
    entries: CaptureLogEntry[],
): Promise<string> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(entries), "utf8");
    return file;
}

describe("importCaptureEntries", () => {
    test("appends entries bucketed per agent", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const res = await importCaptureEntries(corpus, [
            capture("play jazz", "player", { actionName: "play" }),
            capture("add milk", "list", { actionName: "addItem" }),
        ]);
        expect(res.total).toBe(2);
        expect(res.perAgent).toEqual({ player: 1, list: 1 });
        expect((await corpus.list("player")).map((e) => e.utterance)).toEqual([
            "play jazz",
        ]);
    });

    test("writes a single capture file per agent (no name collision)", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        await importCaptureEntries(corpus, [
            capture("a", "player", { actionName: "a" }),
            capture("b", "player", { actionName: "b" }),
        ]);
        const dir = path.join(root, "profile", "captures", "player");
        const files = (await fs.readdir(dir)).filter((f) =>
            f.endsWith(".jsonl"),
        );
        expect(files).toHaveLength(1);
        expect(await corpus.list("player")).toHaveLength(2);
    });

    test("dedupes within the batch by logical id", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const res = await importCaptureEntries(corpus, [
            capture("same", "player", { actionName: "old" }),
            capture("same", "player", { actionName: "new" }),
        ]);
        expect(res.total).toBe(1);
        expect(res.skipped).toEqual({ player: 1 });
        const stored = await corpus.list("player");
        expect(stored).toHaveLength(1);
        expect(stored[0].expectedAction).toEqual({ actionName: "new" });
    });

    test("skips entries already present in the corpus", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        await importCaptureEntries(corpus, [
            capture("first", "player", { actionName: "a" }),
        ]);
        const res = await importCaptureEntries(corpus, [
            capture("first", "player", { actionName: "a" }),
            capture("second", "player", { actionName: "b" }),
        ]);
        expect(res.total).toBe(1);
        expect(res.perAgent).toEqual({ player: 1 });
        expect(res.skipped).toEqual({ player: 1 });
        expect(await corpus.list("player")).toHaveLength(2);
    });
});

describe("importDisplayLogs", () => {
    const log = (id: string, command: string, agent: string, action: unknown) =>
        [
            {
                type: "user-request",
                seq: 0,
                requestId: { requestId: id },
                command,
            },
            {
                type: "set-display-info",
                seq: 1,
                requestId: { requestId: id },
                source: agent,
                action,
            },
        ] as CaptureLogEntry[];

    test("reads a displayLog file and writes corpus entries", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const file = await writeLog(path.join(root, "displayLog.json"), [
            ...log("r1", "play jazz", "player", { actionName: "play" }),
            ...log("r2", "add milk", "list", { actionName: "addItem" }),
        ]);
        const res = await importDisplayLogs(corpus, [file]);
        expect(res.total).toBe(2);
        expect(res.files).toEqual([file]);
        expect(res.perAgent).toEqual({ player: 1, list: 1 });
    });

    test("preserves the raw displayLog path in provenance after append", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const file = await writeLog(path.join(root, "displayLog.json"), [
            ...log("r1", "play jazz", "player", { actionName: "play" }),
        ]);
        await importDisplayLogs(corpus, [file]);
        const [entry] = await corpus.list("player");
        // append overwrites sourceUri with the captures file, but the raw path
        // survives.
        expect(entry.provenance.rawSourceUri).toBe(file);
        expect(entry.provenance.sourceUri).not.toBe(file);
        expect(entry.provenance.sourceUri).toContain("captures");
    });

    test("applies an agent allowlist", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const file = await writeLog(path.join(root, "displayLog.json"), [
            ...log("r1", "keep", "player", { actionName: "a" }),
            ...log("r2", "drop", "dispatcher", { actionName: "b" }),
        ]);
        const res = await importDisplayLogs(corpus, [file], {
            agents: ["player"],
        });
        expect(res.perAgent).toEqual({ player: 1 });
        expect(await corpus.list("dispatcher")).toHaveLength(0);
    });

    test("dedupes the same utterance across multiple files", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const f1 = await writeLog(path.join(root, "a", "displayLog.json"), [
            ...log("r1", "same words", "player", { actionName: "old" }),
        ]);
        const f2 = await writeLog(path.join(root, "b", "displayLog.json"), [
            ...log("r2", "same words", "player", { actionName: "new" }),
        ]);
        const res = await importDisplayLogs(corpus, [f1, f2]);
        expect(res.total).toBe(1);
        expect(await corpus.list("player")).toHaveLength(1);
    });

    test("is idempotent when re-importing the same file", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const file = await writeLog(path.join(root, "displayLog.json"), [
            ...log("r1", "once", "player", { actionName: "a" }),
        ]);
        await importDisplayLogs(corpus, [file]);
        const res = await importDisplayLogs(corpus, [file]);
        expect(res.total).toBe(0);
        expect(res.skipped).toEqual({ player: 1 });
        expect(await corpus.list("player")).toHaveLength(1);
    });

    test("target in-repo promotes straight into the shared corpus with no staging", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const file = await writeLog(path.join(root, "displayLog.json"), [
            ...log("r1", "play jazz", "player", { actionName: "play" }),
        ]);
        const res = await importDisplayLogs(corpus, [file], {
            target: "in-repo",
        });
        expect(res.total).toBe(1);

        const [entry] = await corpus.list("player");
        expect(entry.source).toBe("in-repo");

        // Nothing left behind in the private captures staging area.
        const capturesDir = path.join(root, "profile", "captures", "player");
        const staged = await fs
            .readdir(capturesDir)
            .catch(() => [] as string[]);
        expect(staged.filter((f) => f.endsWith(".jsonl"))).toHaveLength(0);

        // Landed in the committed in-repo file.
        const inRepo = path.join(
            root,
            "repo",
            "corpus",
            "player.utterances.jsonl",
        );
        expect((await fs.readFile(inRepo, "utf8")).includes("play jazz")).toBe(
            true,
        );
    });

    test("skips missing and malformed files", async () => {
        const root = await makeTempRoot();
        const corpus = makeCorpus(root);
        const bad = path.join(root, "bad.json");
        await fs.writeFile(bad, "{ not json", "utf8");
        const notArray = path.join(root, "obj.json");
        await fs.writeFile(notArray, JSON.stringify({ a: 1 }), "utf8");
        const res = await importDisplayLogs(corpus, [
            path.join(root, "missing.json"),
            bad,
            notArray,
        ]);
        expect(res.total).toBe(0);
        expect(res.files).toEqual([]);
    });
});
