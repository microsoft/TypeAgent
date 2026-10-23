// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { recipeSchemaDigest } from "@typeagent/copilot-macros/recipeCore";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DurableRecipeCatalog } from "../src/recipeCatalog.js";
import {
    recipeArtifact,
    recipeCapture,
    recipeJob,
    recipeScope,
} from "./recipeCatalogFixtures.js";

let directory: string;
let catalog: DurableRecipeCatalog;

beforeEach(async () => {
    directory = path.resolve(".recipe-catalog-tests", randomUUID());
    await mkdir(directory, { recursive: true });
    catalog = new DurableRecipeCatalog(directory);
});
afterEach(async () => {
    catalog.close();
    await rm(directory, { recursive: true, force: true });
});

function child(operation: string, identity: string, expectedCode = 0) {
    return new Promise<string>((resolve, reject) => {
        const process = spawn(
            globalThis.process.execPath,
            [
                "--no-warnings",
                fileURLToPath(
                    new URL("./recipeCatalogProcess.js", import.meta.url),
                ),
                directory,
                operation,
                identity,
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "";
        let error = "";
        process.stdout.on(
            "data",
            (data: Buffer) => (output += data.toString()),
        );
        process.stderr.on("data", (data: Buffer) => (error += data.toString()));
        process.once("error", reject);
        process.once("exit", (code) =>
            code === expectedCode
                ? resolve(output)
                : reject(new Error(`${code}: ${error}`)),
        );
    });
}

async function seed(mode: ReturnType<typeof recipeCapture>["mode"] = "all") {
    const artifact = recipeArtifact();
    await catalog.transact(recipeScope, 0, (tx) => {
        tx.enqueueCapture(recipeCapture("capture", mode), recipeJob());
        tx.putImmutable(artifact);
        tx.publish(
            artifact,
            "capture",
            mode === "prepare" ? "prepared" : "ready",
        );
    });
    return artifact;
}

test("restart preserves immutable program, capture, job and scope isolation", async () => {
    const artifact = await seed();
    catalog.close();
    catalog = new DurableRecipeCatalog(directory);
    expect(await catalog.getArtifact(recipeScope, artifact)).toEqual(artifact);
    expect(await catalog.getCapture(recipeScope, "capture")).toEqual(
        recipeCapture(),
    );
    expect(await catalog.getJob(recipeScope, "job-capture")).toEqual(
        recipeJob(),
    );
    expect(
        (await catalog.snapshot({ ...recipeScope, profileId: "other" }))
            .entries,
    ).toEqual([]);
});

test("two independent processes publish captures without lost writes", async () => {
    await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
            child("enqueue", `capture-${index}`),
        ),
    );
    expect(await catalog.listJobs(recipeScope)).toHaveLength(6);
    expect((await catalog.snapshot(recipeScope)).catalogRevision).toBe(6);
});

test("independent concurrent publication atomically supersedes prior revisions", async () => {
    await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
            child("publish", `publication-${index}`),
        ),
    );
    const snapshot = await catalog.snapshot(recipeScope);
    expect(snapshot.entries).toHaveLength(4);
    expect(
        snapshot.entries.filter((entry) => entry.state === "ready"),
    ).toHaveLength(1);
    expect(
        snapshot.entries.filter((entry) => entry.state === "superseded"),
    ).toHaveLength(3);
    for (const entry of snapshot.entries)
        expect(
            await catalog.getCapture(recipeScope, entry.captureId),
        ).toBeDefined();
});

test("opt-in subpath imports without SQLite and reports an actionable construction error", async () => {
    const script = `
        import { DurableRecipeCatalog } from "@typeagent/copilot-macros/recipeCatalog";
        process.stdout.write("imported:");
        try { new DurableRecipeCatalog(${JSON.stringify(directory)}); process.exitCode=1; }
        catch(error) { process.stdout.write(error.message); }
    `;
    const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ["--no-experimental-sqlite", "--input-type=module", "-e", script],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "";
        child.stdout.on("data", (data: Buffer) => (output += data.toString()));
        child.once("error", reject);
        child.once("exit", (code) =>
            code === 0 ? resolve(output) : reject(new Error(`Exit ${code}`)),
        );
    });
    expect(output).toContain(
        "imported:Local recipe storage requires Node >=22.13",
    );
});

test("concurrent independent claims grant exactly one fenced lease", async () => {
    await seed();
    const outputs = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
            child("claim", `worker-${index}`),
        ),
    );
    expect(
        outputs.map((value) => JSON.parse(value).claimed).filter(Boolean),
    ).toHaveLength(1);
    expect((await catalog.getJob(recipeScope, "job-capture"))?.attempt).toBe(1);
});

test("a killed transaction rolls back completely and restart recovers", async () => {
    await child("crash", "crashed", 17);
    expect(await catalog.getJob(recipeScope, "job-crashed")).toBeUndefined();
    expect((await catalog.snapshot(recipeScope)).catalogRevision).toBe(0);
    await child("enqueue", "recovered");
    expect(await catalog.getJob(recipeScope, "job-recovered")).toBeDefined();
});

test("deduplicates capture identity, rejects capture collisions and rolls back callback failure", async () => {
    await seed();
    await catalog.transact(recipeScope, 1, (tx) => {
        expect(tx.enqueueCapture(recipeCapture(), recipeJob())).toBe(
            "existing",
        );
        expect(
            tx.enqueueCapture(
                { ...recipeCapture(), captureId: "duplicate" },
                recipeJob("duplicate"),
            ),
        ).toBe("existing");
    });
    await expect(
        catalog.transact(recipeScope, 2, (tx) => {
            tx.enqueueCapture(
                { ...recipeCapture(), request: "different" },
                recipeJob(),
            );
        }),
    ).rejects.toThrow("collision");
    await expect(
        catalog.transact(recipeScope, 2, (tx) => {
            tx.enqueueCapture(recipeCapture("new"), recipeJob("new"));
            throw new Error("rollback");
        }),
    ).rejects.toThrow("rollback");
    expect(await catalog.listJobs(recipeScope)).toHaveLength(1);
});

test("expired lease recovers with new token and rejects the old worker", async () => {
    await seed();
    let first: ReturnType<typeof recipeJob> | undefined;
    await catalog.transact(recipeScope, 1, (tx) => {
        first = tx.claimJob(
            "job-capture",
            "first",
            "2000-01-01T00:00:00Z",
            "2000-01-01T00:01:00Z",
        );
    });
    let second: ReturnType<typeof recipeJob> | undefined;
    await catalog.transact(recipeScope, 2, (tx) => {
        second = tx.claimJob(
            "job-capture",
            "second",
            new Date().toISOString(),
            new Date(Date.now() + 60000).toISOString(),
        );
    });
    expect(second?.attempt).toBe(2);
    expect(second?.claim?.token).not.toBe(first?.claim?.token);
    await expect(
        catalog.transact(recipeScope, 3, (tx) =>
            tx.updateJob({ ...first!, state: "ready" }, first!.claim!.token),
        ),
    ).rejects.toThrow("Stale");
    await catalog.transact(recipeScope, 3, (tx) =>
        tx.updateJob({ ...second!, state: "prepared" }, second!.claim!.token),
    );
    expect(
        (await catalog.getJob(recipeScope, "job-capture"))?.claim,
    ).toBeUndefined();
});

test("prepare/off/read-only modes guard publication and explicit approval is local", async () => {
    const artifact = await seed("prepare");
    expect((await catalog.list(recipeScope))[0].state).toBe("prepared");
    await expect(
        catalog.transact(recipeScope, 1, (tx) =>
            tx.publish(artifact, "capture", "ready"),
        ),
    ).rejects.toThrow("mode");
    await catalog.approve(recipeScope, artifact);
    expect((await catalog.list(recipeScope))[0].state).toBe("ready");
    await catalog.setLearningMode(recipeScope, "off");
    const revision = (await catalog.snapshot(recipeScope)).catalogRevision;
    await expect(
        catalog.transact(recipeScope, revision, (tx) =>
            tx.enqueueCapture(recipeCapture("off"), recipeJob("off")),
        ),
    ).rejects.toThrow("admission");
});

test("immutable replacement/CAS/invalidation cannot corrupt publication", async () => {
    const artifact = await seed();
    expect(
        await catalog.transact(recipeScope, 0, () => {
            throw new Error("must not run");
        }),
    ).toEqual({ status: "conflict", catalogRevision: 1 });
    await expect(
        catalog.transact(recipeScope, 1, (tx) =>
            tx.putImmutable({ ...artifact, name: "tampered" }),
        ),
    ).rejects.toThrow();
    await child(
        "disable",
        JSON.stringify({
            recipeId: artifact.recipeId,
            revision: artifact.revision,
        }),
    );
    expect((await catalog.list(recipeScope))[0].state).toBe("disabled");
    await catalog.delete(recipeScope, artifact);
    expect((await catalog.list(recipeScope))[0].state).toBe("deleted");
});

test("read-only learning retains effectful candidates as prepared, never ready", async () => {
    const schema = { type: "string" as const };
    const artifact = recipeArtifact("write", "capture", {
        capabilities: [
            {
                id: "write",
                transport: "native",
                providerId: "fixture",
                operation: "write",
                contractVersion: "1",
                inputSchema: schema,
                schemaDigest: recipeSchemaDigest(schema),
                compatibility: "exact",
                effect: "write",
            },
        ],
    });
    await catalog.transact(recipeScope, 0, (tx) => {
        tx.enqueueCapture(recipeCapture("capture", "read-only"), recipeJob());
        tx.putImmutable(artifact);
        tx.publish(artifact, "capture", "prepared");
    });
    await expect(
        catalog.transact(recipeScope, 1, (tx) =>
            tx.publish(artifact, "capture", "ready"),
        ),
    ).rejects.toThrow("mode");
    expect((await catalog.list(recipeScope))[0].state).toBe("prepared");
});

test("cancel fences a claimed job and unknown/finished work is not success", async () => {
    await seed();
    await catalog.cancelJob(recipeScope, "job-capture");
    expect((await catalog.getJob(recipeScope, "job-capture"))?.state).toBe(
        "blocked",
    );
    await expect(catalog.cancelJob(recipeScope, "missing")).rejects.toThrow(
        "Unknown",
    );
    await expect(catalog.cancelJob(recipeScope, "job-capture")).rejects.toThrow(
        "no active",
    );
});
