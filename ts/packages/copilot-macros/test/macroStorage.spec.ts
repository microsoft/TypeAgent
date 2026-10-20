// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    appendFile,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { MacroManager } from "../src/macroManager.js";
import { readProgramJournal, runMacroProgram } from "../src/macroProgramRun.js";
import {
    publishImmutable,
    RevisionRecords,
    withRecordLock,
} from "../src/revisionRecords.js";
import type {
    CopilotToolMacro,
    MacroProgramRuntime,
} from "../src/contracts.js";
import type { RecipeEffectCheckpoint } from "../src/recipeContracts.js";
import { recipeArtifact } from "./recipeCatalogFixtures.js";
import { induceMacroFromTrace } from "../src/macroDefinition.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const jest = (import.meta as ImportMeta & { jest: typeof globalThis.jest })
    .jest;

let directory: string;
beforeEach(async () => {
    directory = await mkdtemp(path.join(process.cwd(), ".macro-storage-"));
});
afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
});

async function draft(id = "macro"): Promise<CopilotToolMacro> {
    const trace = {
        schemaVersion: 1 as const,
        sessionId: "session",
        cwd: directory,
        prompt: "read file",
        response: "answer",
        startedAt: "2026-10-19T00:00:00Z",
        completedAt: "2026-10-19T00:00:01Z",
        toolCalls: [
            {
                toolCallId: "read",
                name: "read",
                mcpServerName: "files",
                arguments: { path: "alpha.txt" },
                result: "contents",
                status: "completed" as const,
            },
        ],
    };
    const macro = await induceMacroFromTrace(
        "procedure:test",
        trace,
        id,
        id,
        "read file",
        trace.completedAt,
        {
            inspectTool: async () => ({
                toolName: "read",
                mcpServerName: "files",
                schemaFingerprint: "v1",
            }),
            callTool: async () => {
                throw new Error("Not dispatched");
            },
        },
    );
    macro.executionKind = "program";
    macro.program = recipeArtifact(id, "procedure:test", {
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
        provenance: {
            captureId: "procedure:test",
            taskId: "procedure:test",
            tokenId: "procedure:test",
            evidenceIds: ["evidence"],
            legacySource: { macroId: id, version: macro.version },
        },
    });
    return macro;
}

describe("active macro record publication", () => {
    it("does not expose staged revisions, survives interrupted publication, and retries the same immutable version", async () => {
        const manager = new MacroManager(directory);
        const macro = await draft();
        const pointer = path.join(
            directory,
            "copilot-macros",
            "catalog",
            "macro.json",
        );
        const publish = jest
            .spyOn(
                manager as unknown as {
                    upsertSummary(macro: CopilotToolMacro): Promise<void>;
                },
                "upsertSummary",
            )
            .mockRejectedValueOnce(new Error("interrupted publication"));
        await expect(manager.saveDraft(macro)).rejects.toThrow();
        publish.mockRestore();
        expect(await manager.listMacros()).toEqual([]);
        await manager.saveDraft(macro);
        const version = path.join(
            directory,
            "copilot-macros",
            "macros",
            "macro",
            "versions",
            "1.json",
        );
        const retained = await readFile(version, "utf8");
        const interrupted = {
            ...macro,
            version: 2,
            description: "never published",
        };
        await publishImmutable(
            path.join(path.dirname(version), "2.json"),
            JSON.stringify(interrupted),
        );
        await writeFile(
            `${pointer}.interrupted.tmp`,
            JSON.stringify({ schemaVersion: 2, summary: interrupted }),
        );
        const reopened = new MacroManager(directory);
        expect(
            (await reopened.inspectMacro({ macroId: "macro" })).version,
        ).toBe(1);
        expect(await readFile(version, "utf8")).toBe(retained);
        await manager.deleteMacro({ macroId: "macro" });
        expect(await reopened.listMacros()).toEqual([]);
        await expect(readFile(version)).rejects.toMatchObject({
            code: "ENOENT",
        });
        await expect(
            readFile(`${pointer}.interrupted.tmp`),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await manager.close();
        await reopened.close();
    });

    it("updates one production catalog pointer without rewriting other macros or version history", async () => {
        const manager = new MacroManager(directory);
        const macros = await Promise.all(
            Array.from({ length: 100 }, (_, index) => draft(`macro-${index}`)),
        );
        for (const macro of macros) await manager.saveDraft(macro);
        const root = path.join(directory, "copilot-macros", "catalog");
        const files = await readdir(root);
        const before = new Map(
            await Promise.all(
                files.map(
                    async (file) =>
                        [
                            file,
                            await readFile(path.join(root, file), "utf8"),
                        ] as const,
                ),
            ),
        );
        await manager.saveDraft({ ...macros[0], version: 2 });
        const changed = [];
        for (const file of files)
            if (
                before.get(file) !==
                (await readFile(path.join(root, file), "utf8"))
            )
                changed.push(file);
        expect(changed).toEqual(["macro-0.json"]);
        const candidateBytes = (await stat(path.join(root, "macro-0.json")))
            .size;
        const baselineBytes = Buffer.byteLength(
            JSON.stringify(
                await manager.listMacros({ limit: 500 }),
                undefined,
                2,
            ),
        );
        expect(candidateBytes).toBeLessThan(baselineBytes / 50);
        process.stdout.write(
            JSON.stringify({
                workload: "one-catalog-entry-among-100",
                baselineJsonBytes: baselineBytes,
                candidateJsonBytes: candidateBytes,
                baselinePointerWrites: 1,
                candidatePointerWrites: 1,
                unrelatedPointersRewritten: 0,
            }) + "\n",
        );
        await manager.close();
    });

    it("rejects incompatible canonical catalogs, learning state and child records without deleting bytes", async () => {
        const root = path.join(directory, "copilot-macros");
        await mkdir(root);
        const legacy = path.join(root, "index.json");
        await writeFile(legacy, "[]");
        await expect(new MacroManager(directory).listMacros()).rejects.toThrow(
            "reset/reimport",
        );
        expect(await readFile(legacy, "utf8")).toBe("[]");
        for (const file of ["learning.json", "child-authoring.json"]) {
            const destination = path.join(root, file);
            const bytes = JSON.stringify({ schemaVersion: 1, jobs: [] });
            await writeFile(destination, bytes);
            await expect(
                new RevisionRecords(destination).load(),
            ).rejects.toThrow("reset/reimport");
            expect(await readFile(destination, "utf8")).toBe(bytes);
        }
    });

    it("publishes competing writers once, rejects stale revisions, and leaves failed payloads unselected", async () => {
        const file = path.join(directory, "records.json");
        const first = new RevisionRecords(file);
        const second = new RevisionRecords(file);
        await Promise.all([first.load(), second.load()]);
        const results = await Promise.allSettled([
            first.commit(new Map([["first", { value: "first" }]])),
            second.commit(new Map([["second", { value: "second" }]])),
        ]);
        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        const current = new RevisionRecords(file);
        const records = await current.load();
        expect(records.size).toBe(1);
        const orphan = JSON.stringify({ value: "interrupted payload" });
        const digest = createHash("sha256").update(orphan).digest("hex");
        await publishImmutable(
            path.join(`${file}.records`, `${digest}.json`),
            orphan,
        );
        expect([
            ...(await new RevisionRecords(file).load()).values(),
        ]).not.toContainEqual(JSON.parse(orphan));
        await current.purgeUnreferenced();
        await expect(
            readFile(path.join(`${file}.records`, `${digest}.json`)),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("releases the owner transaction on failed mutation", async () => {
        const file = path.join(directory, "owner");
        await expect(
            withRecordLock(file, async () => {
                throw new Error("interrupted");
            }),
        ).rejects.toThrow("interrupted");
        expect(await withRecordLock(file, async () => "recovered")).toBe(
            "recovered",
        );
    });

    it("recovers the owner lock after process death inside a publication transaction", async () => {
        const file = path.join(directory, "terminated-owner");
        const module = new URL("../revisionRecords.js", import.meta.url).href;
        const { stdout } = await promisify(execFile)(process.execPath, [
            "--no-warnings",
            "--input-type=module",
            "-e",
            `import { withRecordLock } from ${JSON.stringify(module)}; await withRecordLock(${JSON.stringify(file)}, async () => { process.stdout.write("locked"); process.exit(0); });`,
        ]);
        expect(stdout).toBe("locked");
        expect(await withRecordLock(file, async () => "recovered")).toBe(
            "recovered",
        );
    });

    it("mutates one active production job without rewriting unrelated retained job payloads", async () => {
        const root = path.join(directory, "copilot-macros");
        const file = path.join(root, "learning.json");
        const store = new RevisionRecords(file);
        const cwd = path.resolve(directory).toLowerCase();
        const now = "2026-10-19T00:00:00Z";
        const jobs = Array.from({ length: 100 }, (_, index) => ({
            jobId: createHash("sha256").update(String(index)).digest("hex"),
            fingerprint: createHash("sha256")
                .update(`fingerprint-${index}`)
                .digest("hex"),
            traceId: `trace-${index}`,
            cwd,
            sessionId: "source",
            mode: "all",
            status: "failed",
            preferenceRevision: 1,
            attempts: {},
            verifierAnswers: {
                ["0".repeat(64)]: "retained verifier answer ".repeat(350),
            },
            createdAt: now,
            updatedAt: now,
        }));
        const metadata = {
            schemaVersion: 1,
            preferences: [{ cwd, mode: "all", revision: 1 }],
            suppressed: [],
            suppressedMacroIds: [],
        };
        await store.commit(
            new Map<string, unknown>([
                ["$state", metadata],
                ...jobs.map((job) => [job.jobId, job] as [string, unknown]),
            ]),
        );
        const manager = new MacroManager(directory);
        await manager.getMacroLearningJob(jobs[0].jobId);
        const before = JSON.parse(await readFile(file, "utf8")) as {
            records: Record<string, string>;
        };
        const filesBefore = new Set(await readdir(`${file}.records`));
        await manager.cancelMacroLearningJob(jobs[0].jobId);
        const after = JSON.parse(await readFile(file, "utf8")) as {
            records: Record<string, string>;
        };
        expect(
            Object.keys(after.records).filter(
                (key) => before.records[key] !== after.records[key],
            ),
        ).toEqual([jobs[0].jobId]);
        const added = (await readdir(`${file}.records`)).filter(
            (entry) => !filesBefore.has(entry),
        );
        expect(added).toHaveLength(1);
        const afterBytes =
            (await stat(file)).size +
            (await stat(path.join(`${file}.records`, added[0]))).size;
        const changed = JSON.parse(
            await readFile(path.join(`${file}.records`, added[0]), "utf8"),
        );
        const baselineBytes = Buffer.byteLength(
            JSON.stringify({ ...metadata, jobs: [changed, ...jobs.slice(1)] }),
        );
        expect(afterBytes).toBeLessThan(baselineBytes / 10);
        process.stdout.write(
            JSON.stringify({
                workload: "one-job-among-100",
                baselineJsonBytes: baselineBytes,
                candidateJsonBytes: afterBytes,
                baselineJsonWrites: 1,
                candidateJsonWrites: 2,
                unrelatedPayloadsRewritten: 0,
            }) + "\n",
        );
        await manager.close();
    });
});

describe("append-only production program journal", () => {
    it("measures cumulative bytes against the previous full-snapshot algorithm while preserving durable dispatch and run identity", async () => {
        const macro = await draft();
        const runId = "measured";
        const baseline = {
            macroId: macro.macroId,
            version: macro.version,
            runId,
            startedAt: new Date().toISOString(),
            checkpoints: [] as RecipeEffectCheckpoint[],
        };
        let baselineBytes = Buffer.byteLength(JSON.stringify(baseline));
        let checkpoints = 0;
        let calls = 0;
        const runtime: MacroProgramRuntime = {
            async execute(artifact, _input, context) {
                for (let index = 0; index < 100; index++) {
                    for (const phase of ["dispatched", "completed"] as const) {
                        const checkpoint: RecipeEffectCheckpoint = {
                            callId: `call-${index}`,
                            capabilityId: "read",
                            effect: "read",
                            phase,
                        };
                        await context.onCheckpoint(checkpoint);
                        const durable = await readProgramJournal(
                            directory,
                            runId,
                        );
                        expect(durable.runId).toBe(runId);
                        expect(durable.checkpoints[index]).toEqual(checkpoint);
                        if (phase === "dispatched") calls++;
                        if (phase === "dispatched")
                            baseline.checkpoints.push(checkpoint);
                        else baseline.checkpoints[index] = checkpoint;
                        baselineBytes += Buffer.byteLength(
                            JSON.stringify(baseline),
                        );
                        checkpoints++;
                    }
                }
                return {
                    runId,
                    recipeId: artifact.recipeId,
                    revision: artifact.revision,
                    accepted: true,
                    status: "completed",
                    checkpoints: baseline.checkpoints,
                    completedCallIds: baseline.checkpoints.map(
                        (checkpoint) => checkpoint.callId,
                    ),
                    semanticEvidence: [],
                    fallback: "never",
                };
            },
        };
        const run = await runMacroProgram(
            directory,
            macro,
            {
                macroId: macro.macroId,
                version: macro.version,
                runId,
                inputs: {},
            },
            runtime,
            new AbortController().signal,
            async () => {},
        );
        expect(run.status).toBe("completed");
        expect(calls).toBe(100);
        const candidateBytes = (
            await stat(path.join(directory, "program-runs", `${runId}.json`))
        ).size;
        expect(candidateBytes).toBeLessThan(baselineBytes / 20);
        process.stdout.write(
            JSON.stringify({
                workload: "100-two-phase-calls",
                baselineJsonBytes: baselineBytes,
                candidateJsonBytes: candidateBytes,
                baselineWrites: checkpoints + 1,
                candidateWrites: checkpoints + 1,
                baselineRenames: checkpoints,
                candidateRenames: 0,
                durableDispatches: calls,
            }) + "\n",
        );
        await expect(
            runMacroProgram(
                directory,
                macro,
                {
                    macroId: macro.macroId,
                    version: macro.version,
                    runId,
                    inputs: {},
                },
                runtime,
                new AbortController().signal,
                async () => {},
            ),
        ).rejects.toMatchObject({ code: "EEXIST" });
    });

    it("ignores only an interrupted trailing checkpoint and recovers dispatched effects as uncertain", async () => {
        const root = path.join(directory, "copilot-macros");
        const journalDirectory = path.join(root, "program-runs");
        await mkdir(journalDirectory, { recursive: true });
        const file = path.join(journalDirectory, "interrupted.json");
        const header = {
            schemaVersion: 2,
            macroId: "macro",
            version: 1,
            runId: "interrupted",
            startedAt: new Date().toISOString(),
            checkpoints: [],
        };
        const checkpoint = {
            callId: "call",
            capabilityId: "read",
            effect: "read",
            phase: "dispatched",
        };
        await writeFile(
            file,
            `${JSON.stringify(header)}\n${JSON.stringify({ checkpoint })}\n{"checkpoint":{"callId":"call","phase":"completed"`,
        );
        const manager = new MacroManager(directory);
        expect(await manager.getMacroRun("interrupted")).toMatchObject({
            runId: "interrupted",
            error: { code: "execution_uncertain" },
            result: { checkpoints: [checkpoint] },
        });
        const retained = `${file}.retained`;
        await rename(file, retained);
        await writeFile(file, JSON.stringify({ ...header, schemaVersion: 1 }));
        await expect(readProgramJournal(root, "interrupted")).rejects.toThrow(
            "reset/reimport",
        );
        await rm(file);
        await rename(retained, file);
        await appendFile(file, "\n");
        await expect(readProgramJournal(root, "interrupted")).rejects.toThrow();
        await manager.close();
    });
});
