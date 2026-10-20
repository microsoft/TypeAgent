// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { compileRecipeProgram } from "../src/recipeCompiler.js";
import {
    configureRecipeExecutorAssets,
    RecipeExecutor,
} from "../src/recipeExecutor.js";
import { recipeDigest, recipeSchemaDigest } from "../src/recipeCore.js";
import type { RecipeExecutionContext } from "../src/recipeRouting.js";
import { recipeArtifact } from "./recipeCatalogFixtures.js";

const workerUrl = new URL("../recipeExecutorWorker.js", import.meta.url);
const source = `async function execute(api, params) {
    if (Reflect.has(globalThis, "privateValue")) throw Error("Leaked guest state");
    Reflect.set(globalThis, "privateValue", params);
    return params;
}`;

function program(text = source) {
    return recipeArtifact("warm", "capture", {
        source: { language: "typescript", text, digest: recipeDigest(text) },
        executable: compileRecipeProgram(text),
        inputSchema: { type: "string" },
        capabilities: [],
    });
}

function context(): RecipeExecutionContext {
    return {
        runId: "warm",
        signal: new AbortController().signal,
        binding: {
            workspaceId: "workspace",
            profileId: "profile",
            providerId: "test",
            accountId: "account",
            sessionId: "session",
            generation: "1",
        },
        host: {
            inspectCapability: async (capability) => ({
                status: "available",
                capability,
            }),
            invokeCapability: async () => ({
                status: "completed",
                value: "fresh",
            }),
            invokeSemantic: async () => ({
                status: "unsupported",
                code: "fixture",
                message: "No semantic calls",
            }),
        },
    };
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Expected concurrent progress")),
                    3_000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

describe("owned warm recipe workers", () => {
    let executor: RecipeExecutor;
    let directory: string;

    beforeEach(async () => {
        executor = new RecipeExecutor({ maxWorkers: 1 });
        directory = await mkdtemp(path.join(os.tmpdir(), "recipe-worker-"));
    });

    afterEach(async () => {
        await executor.close();
        configureRecipeExecutorAssets({ workerUrl });
        await rm(directory, { recursive: true, force: true });
    });

    it("initializes WASM once and isolates every private fixture context", async () => {
        const counter = path.join(directory, "initializations.txt");
        const loader = path.join(directory, "quickjs.cjs");
        const modulePath = createRequire(import.meta.url).resolve(
            "@tootallnate/quickjs-emscripten",
        );
        await writeFile(
            loader,
            `
            const original = require(${JSON.stringify(modulePath)});
            module.exports.newQuickJSWASMModule = async () => {
                require("node:fs").appendFileSync(${JSON.stringify(counter)}, "init\\n");
                return original.newQuickJSWASMModule();
            };
        `,
        );
        configureRecipeExecutorAssets({ workerUrl, quickjsModulePath: loader });
        const artifact = program();
        for (let index = 0; index < 6; index++) {
            const result = await executor.execute(
                artifact,
                `private-${index}`,
                context(),
            );
            expect(result.status).toBe("completed");
            expect(result.output).toBe(`private-${index}`);
            expect(result.performance?.workerReused).toBe(index > 0);
        }
        expect(await readFile(counter, "utf8")).toBe("init\n");
    });

    it.each([
        `async function execute(api, params): Promise<JsonValue> { throw Error("failed fixture"); }`,
        `async function execute(api, params): Promise<JsonValue> { while (true) {} }`,
        `async function execute(api, params): Promise<JsonValue> { const values = []; while (true) values.push("x".repeat(100000)); }`,
        `async function execute(api, params) { return new Promise<JsonValue>(() => {}); }`,
    ])(
        "replaces failed workers before subsequent execution: %s",
        async (text) => {
            expect(
                (await executor.execute(program(), "first", context())).status,
            ).toBe("completed");
            const failed = await executor.execute(
                program(text),
                "failed",
                context(),
                {
                    timeoutMs: 500,
                    memoryLimitBytes: 2 * 1024 * 1024,
                },
            );
            expect(failed.status).not.toBe("completed");
            const recovered = await executor.execute(
                program(),
                "fresh",
                context(),
            );
            expect(recovered.status).toBe("completed");
            expect(recovered.output).toBe("fresh");
            expect(recovered.performance?.workerReused).toBe(false);
        },
    );

    it("retires cached workers when assets change and recovers after a worker crash", async () => {
        const artifact = program();
        await executor.execute(artifact, "before", context());
        configureRecipeExecutorAssets({
            workerUrl: new URL("data:text/javascript,process.exit(2)"),
        });
        expect(
            (await executor.execute(artifact, "crash", context())).status,
        ).toBe("failed");
        configureRecipeExecutorAssets({ workerUrl });
        const recovered = await executor.execute(artifact, "after", context());
        expect(recovered.status).toBe("completed");
        expect(recovered.performance?.workerReused).toBe(false);
    });

    it("recovers from module initialization failures after asset repair", async () => {
        configureRecipeExecutorAssets({
            workerUrl,
            quickjsModulePath: path.join(directory, "missing-quickjs.cjs"),
        });
        expect(
            (await executor.execute(program(), "missing", context())).status,
        ).toBe("failed");
        configureRecipeExecutorAssets({ workerUrl });
        const recovered = await executor.execute(
            program(),
            "repaired",
            context(),
        );
        expect(recovered.output).toBe("repaired");
        expect(recovered.performance?.workerReused).toBe(false);
    });

    it.each([
        { kind: "result", text: "not-json" },
        {
            kind: "request",
            text: JSON.stringify({
                request: 2,
                kind: "tools",
                id: "read",
                input: null,
            }),
        },
    ])(
        "rejects malformed worker replies and replaces the worker: $kind",
        async (message) => {
            const script = `import { parentPort } from "node:worker_threads";
            parentPort.once("message", () => parentPort.postMessage(${JSON.stringify(message)}));`;
            configureRecipeExecutorAssets({
                workerUrl: new URL(
                    `data:text/javascript,${encodeURIComponent(script)}`,
                ),
            });
            expect(
                (await executor.execute(program(), "invalid", context()))
                    .status,
            ).toBe("failed");
            configureRecipeExecutorAssets({ workerUrl });
            expect(
                (await executor.execute(program(), "recovered", context()))
                    .output,
            ).toBe("recovered");
        },
    );

    function blockedRun() {
        const entered = deferred();
        const release = deferred();
        const execution = context();
        const capability = {
            id: "read",
            transport: "native" as const,
            providerId: "test",
            operation: "read",
            contractVersion: "1",
            inputSchema: { type: "null" as const },
            outputSchema: { type: "string" as const },
            schemaDigest: recipeSchemaDigest(
                { type: "null" },
                { type: "string" },
            ),
            compatibility: "exact" as const,
            effect: "read" as const,
        };
        const text = `async function execute(api, params) { return api.tools.call("read", null); }`;
        const base = program(text);
        const artifact = recipeArtifact("blocked", "capture", {
            source: base.source,
            executable: base.executable,
            inputSchema: { type: "string" },
            capabilities: [capability],
        });
        execution.host.invokeCapability = async () => {
            entered.resolve();
            await release.promise;
            return { status: "completed", value: "released" };
        };
        return { artifact, execution, entered, release };
    }

    it("bounds admission, cancels queued waits independently and records queue time", async () => {
        const block = blockedRun();
        const first = executor.execute(
            block.artifact,
            "first",
            block.execution,
        );
        await within(block.entered.promise);
        const controller = new AbortController();
        const cancelled = executor.execute(program(), "cancelled", {
            ...context(),
            signal: controller.signal,
        });
        const third = executor.execute(program(), "third", context());
        const expired = executor.execute(program(), "expired", context(), {
            timeoutMs: 100,
        });
        controller.abort();
        expect((await within(cancelled)).status).toBe("cancelled");
        expect((await within(expired)).status).toBe("limit_exceeded");
        block.release.resolve();
        expect((await first).status).toBe("completed");
        const result = await third;
        expect(result.output).toBe("third");
        expect(result.performance?.workerReused).toBe(true);
        expect(result.performance!.workerQueueMs).toBeGreaterThan(0);
    });

    it("retains the measured eight-run concurrent capacity", async () => {
        await executor.close();
        executor = new RecipeExecutor();
        const block = blockedRun();
        const entered = deferred();
        let active = 0;
        block.execution.host.invokeCapability = async () => {
            if (++active === 8) entered.resolve();
            await block.release.promise;
            return { status: "completed", value: "fresh" };
        };
        const runs = Array.from({ length: 8 }, () =>
            executor.execute(block.artifact, "parallel", block.execution),
        );
        try {
            await within(entered.promise);
            expect(active).toBe(8);
        } finally {
            block.release.resolve();
        }
        expect(
            (await Promise.all(runs)).every(
                (result) => result.status === "completed",
            ),
        ).toBe(true);
    });

    it("lets active work finish on its captured assets while queued work uses new assets", async () => {
        const block = blockedRun();
        const first = executor.execute(
            block.artifact,
            "first",
            block.execution,
        );
        await within(block.entered.promise);
        const next = executor.execute(program(), "next", context());
        configureRecipeExecutorAssets({ workerUrl });
        block.release.resolve();
        expect((await first).status).toBe("completed");
        const result = await next;
        expect(result.output).toBe("next");
        expect(result.performance?.workerReused).toBe(false);
    });

    it("rejects excess queued work explicitly instead of growing admission without bounds", async () => {
        const block = blockedRun();
        const first = executor.execute(
            block.artifact,
            "first",
            block.execution,
        );
        await within(block.entered.promise);
        const artifact = program();
        const queued = Array.from({ length: 65 }, () =>
            executor.execute(artifact, "queued", context()),
        );
        const overflow = await within(queued[64]);
        expect(overflow.status).toBe("failed");
        expect(overflow.message).toContain("admission queue is full");
        await executor.close();
        expect((await first).status).toBe("cancelled");
        expect(await Promise.all(queued.slice(0, 64))).toEqual(
            Array.from({ length: 64 }, () =>
                expect.objectContaining({ status: "cancelled" }),
            ),
        );
        block.release.resolve();
    });

    it("close cancels active and queued work and is idempotent", async () => {
        const block = blockedRun();
        const first = executor.execute(
            block.artifact,
            "first",
            block.execution,
        );
        await within(block.entered.promise);
        const queued = executor.execute(program(), "queued", context());
        await within(executor.close());
        expect((await first).status).toBe("cancelled");
        expect((await queued).status).toBe("cancelled");
        await executor.close();
        await expect(
            executor.execute(program(), "late", context()),
        ).rejects.toThrow("closed");
        expect(block.execution.signal.aborted).toBe(false);
        block.release.resolve();
    });

    it("keeps repeated fresh-context RSS growth within a 64 MiB soak budget", async () => {
        const artifact = program();
        const observations: number[] = [];
        for (let index = 0; index < 120; index++) {
            const result = await executor.execute(
                artifact,
                `private-${index}`,
                context(),
            );
            expect(result.output).toBe(`private-${index}`);
            if (index >= 20) {
                expect(result.performance?.workerReused).toBe(true);
                observations.push(process.memoryUsage().rss);
            }
        }
        expect(
            Math.max(...observations.slice(-20)) -
                Math.min(...observations.slice(0, 20)),
        ).toBeLessThanOrEqual(64 * 1024 * 1024);
    });
});
