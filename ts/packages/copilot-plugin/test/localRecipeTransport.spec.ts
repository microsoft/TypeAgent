// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { localRecipeEndpoint } from "../src/shared/recipe-local-paths.js";
import {
    callLocalRecipe,
    startLocalRecipeBroker,
} from "../src/shared/recipe-transport.js";

let directory: string;
const original = process.env.TYPEAGENT_PLUGIN_DATA;
let broker: Awaited<ReturnType<typeof startLocalRecipeBroker>> | undefined;
const cwd = process.cwd();

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "local-recipe-ipc-"));
    process.env.TYPEAGENT_PLUGIN_DATA = directory;
});
afterEach(async () => {
    await broker?.close();
    broker = undefined;
    if (original === undefined) delete process.env.TYPEAGENT_PLUGIN_DATA;
    else process.env.TYPEAGENT_PLUGIN_DATA = original;
    await rm(directory, { recursive: true, force: true });
});
const report = (message: string) => {
    throw new Error(message);
};

test("correlates bounded requests without connecting to TypeAgent", async () => {
    process.env.TYPEAGENT_PLUGIN_DATA = join(
        directory,
        "long-profile-".repeat(3),
    );
    const dispatch = jest.fn(async (method: string, args: unknown[]) => ({
        method,
        args,
    }));
    broker = await startLocalRecipeBroker(cwd, "session", dispatch, report);
    const endpoint = JSON.parse(
        await readFile(localRecipeEndpoint(cwd, "session"), "utf8"),
    ) as { address: string };
    if (process.platform !== "win32")
        expect(Buffer.byteLength(endpoint.address)).toBeLessThanOrEqual(103);
    await expect(
        callLocalRecipe(cwd, "session", "inspect", [
            { text: "007 雪", nested: [false, null] },
        ]),
    ).resolves.toEqual({
        method: "inspect",
        args: [{ text: "007 雪", nested: [false, null] }],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(
        callLocalRecipe(`${cwd}\\another`, "session", "inspect", []),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
        callLocalRecipe(cwd, "another-session", "inspect", []),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
        callLocalRecipe(cwd, "session", "inspect", [
            "x".repeat(8 * 1024 * 1024),
        ]),
    ).rejects.toThrow("exceeds");
    expect(dispatch).toHaveBeenCalledTimes(1);
});

test("rejects an unauthenticated envelope before invoking operations", async () => {
    const dispatch = jest.fn(async () => "never");
    broker = await startLocalRecipeBroker(cwd, "session", dispatch, report);
    const descriptor = JSON.parse(
        await readFile(localRecipeEndpoint(cwd, "session"), "utf8"),
    ) as { address: string };
    const reply = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(descriptor.address);
        let text = "";
        socket.setEncoding("utf8");
        socket.on("error", reject);
        socket.on("data", (chunk) => {
            text += chunk;
        });
        socket.on("end", () => resolve(text));
        socket.on("connect", () =>
            socket.write(
                `${JSON.stringify({ id: "unauthorized", token: "0".repeat(64), sessionId: "session", method: "inspect", args: [] })}\n`,
            ),
        );
    });
    expect(JSON.parse(reply)).toMatchObject({
        ok: false,
        error: expect.stringContaining("not bound"),
    });
    expect(dispatch).not.toHaveBeenCalled();
});

test("holds a single workspace/profile writer across sessions, then transfers on close", async () => {
    broker = await startLocalRecipeBroker(
        cwd,
        "first",
        async () => "first",
        report,
    );
    await expect(
        startLocalRecipeBroker(cwd, "second", async () => "second", report),
    ).rejects.toThrow("live recipe owner");
    await broker.close();
    broker = await startLocalRecipeBroker(
        cwd,
        "second",
        async () => "second",
        report,
    );
    await expect(callLocalRecipe(cwd, "second", "inspect", [])).resolves.toBe(
        "second",
    );
});

test("waits for accepted dispatch before releasing ownership; a lost reply is never retried", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const dispatch = jest.fn(async () => {
        entered();
        await blocked;
        return "done";
    });
    broker = await startLocalRecipeBroker(cwd, "session", dispatch, () => {});
    const result = callLocalRecipe(cwd, "session", "run", []).catch(
        (error) => error,
    );
    await started;
    let closed = false;
    const closing = broker.close().then(() => {
        closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    await expect(
        startLocalRecipeBroker(cwd, "other", async () => {}, report),
    ).rejects.toThrow("live recipe owner");
    finish();
    await closing;
    const failure: unknown = await result;
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error))
        throw new Error("A lost reply must fail explicitly.");
    expect(failure.message).toContain("do not retry");
    expect(dispatch).toHaveBeenCalledTimes(1);
});

test("the OS releases a crashed owner's lock without PID guessing or deleting its store", async () => {
    const module = new URL("../shared/recipe-transport.js", import.meta.url)
        .href;
    const script = `import {startLocalRecipeBroker} from ${JSON.stringify(module)}; await startLocalRecipeBroker(${JSON.stringify(cwd)}, "crashed", async()=>null, console.error); console.log("ready");`;
    const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
        diagnostic = `${diagnostic}${String(chunk)}`.slice(-4096);
    });
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    reject(
                        new Error("Child recipe broker did not become ready."),
                    ),
                10_000,
            );
            child.once("error", reject);
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(
                    new Error(
                        `Child recipe broker exited before ready: ${code}. ${diagnostic}`,
                    ),
                );
            });
            child.stdout.on("data", (chunk) => {
                if (String(chunk).includes("ready")) {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });
        await expect(
            startLocalRecipeBroker(cwd, "other", async () => {}, report),
        ).rejects.toThrow("live recipe owner");
        const exited = once(child, "exit");
        child.kill();
        await exited;
        broker = await startLocalRecipeBroker(
            cwd,
            "replacement",
            async () => "recovered",
            report,
        );
        await expect(
            callLocalRecipe(cwd, "replacement", "inspect", []),
        ).resolves.toBe("recovered");
    } finally {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill();
            await exited;
        }
    }
});
