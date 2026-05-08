// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Cross-process smoke driver for `@typeagent/port-registry`.
 *
 * Spawns real Node child processes that act as agent servers (via
 * `fakeAgentServer.ts`) and verifies the registry layer end-to-end —
 * allocation, discovery, liveness GC, and self-promotion failover.
 *
 * Not part of CI. Run on demand:
 *
 *   pnpm -F @typeagent/port-registry run smoke
 *
 * Each test allocates a unique registry port via TYPEAGENT_PORT_REGISTRY_PORT
 * so this driver does not collide with a developer's running stack.
 */

import { ChildProcess, spawn } from "node:child_process";
import * as net from "node:net";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { StatusEntry } from "@typeagent/port-registry";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_PATH = path.join(SCRIPT_DIR, "fakeAgentServer.js");

interface ReadyMessage {
    kind: "ready";
    pid: number;
    workspace: string;
    port: number;
    slotId: string;
}

interface LookupMessage {
    kind: "lookup";
    workspace: string;
    result: { slotId?: string; ports: number[] | null };
}

class TestEnv {
    public readonly registryPort: number;
    private children: ChildProcess[] = [];

    private constructor(registryPort: number) {
        this.registryPort = registryPort;
    }

    static async create(): Promise<TestEnv> {
        const registryPort = await reserveEphemeralPort();
        return new TestEnv(registryPort);
    }

    /**
     * Spawn a fake agent server and resolve once it prints its `ready`
     * line. The child is tracked for cleanup.
     */
    async spawnFake(
        workspace: string,
        opts: { clientOnly?: boolean } = {},
    ): Promise<{ child: ChildProcess; ready: ReadyMessage }> {
        const args = ["--workspace", workspace];
        if (opts.clientOnly) args.push("--client-only");
        const child = spawn("node", [FAKE_PATH, ...args], {
            env: {
                ...process.env,
                TYPEAGENT_USE_PORT_REGISTRY: "1",
                TYPEAGENT_PORT_REGISTRY_PORT: String(this.registryPort),
            },
            stdio: ["ignore", "pipe", "inherit"],
        });
        this.children.push(child);
        const ready = await readJsonLine<ReadyMessage>(child, 8000);
        if (ready.kind !== "ready") {
            throw new Error(`expected ready, got ${JSON.stringify(ready)}`);
        }
        return { child, ready };
    }

    /**
     * Run the fake in `--client-only` mode (no server eligibility).
     * It does a single lookup then exits. Resolves with the result.
     */
    async lookupFromClient(workspace: string): Promise<LookupMessage> {
        const child = spawn(
            "node",
            [FAKE_PATH, "--workspace", workspace, "--client-only"],
            {
                env: {
                    ...process.env,
                    TYPEAGENT_USE_PORT_REGISTRY: "1",
                    TYPEAGENT_PORT_REGISTRY_PORT: String(this.registryPort),
                },
                stdio: ["ignore", "pipe", "inherit"],
            },
        );
        return readJsonLine<LookupMessage>(child, 8000);
    }

    /** Hit the registry's /status endpoint directly. */
    async status(): Promise<{ entries: StatusEntry[] }> {
        const url = `http://127.0.0.1:${this.registryPort}/status`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        return (await res.json()) as { entries: StatusEntry[] };
    }

    /** True if anyone is currently bound to the well-known registry port. */
    async registryReachable(): Promise<boolean> {
        try {
            await this.status();
            return true;
        } catch {
            return false;
        }
    }

    async kill(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
        if (child.exitCode !== null || child.killed) return;
        await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                resolve();
            };
            child.once("exit", finish);
            child.once("close", finish);
            child.kill(signal);
            // Windows fallback: if neither event fires within 1s, give up.
            setTimeout(finish, 1000).unref();
        });
    }

    async cleanup(): Promise<void> {
        await Promise.allSettled(
            this.children.map(async (c) => {
                if (c.exitCode === null) await this.kill(c, "SIGKILL");
            }),
        );
    }
}

async function reserveEphemeralPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address();
            if (!addr || typeof addr === "string") {
                reject(new Error("no address"));
                return;
            }
            const port = addr.port;
            srv.close(() => resolve(port));
        });
    });
}

async function readJsonLine<T>(
    child: ChildProcess,
    timeoutMs: number,
): Promise<T> {
    return new Promise((resolve, reject) => {
        let buf = "";
        const stdout = child.stdout!;
        const onData = (chunk: Buffer) => {
            buf += chunk.toString("utf-8");
            const nl = buf.indexOf("\n");
            if (nl !== -1) {
                stdout.off("data", onData);
                clearTimeout(timer);
                try {
                    resolve(JSON.parse(buf.slice(0, nl)));
                } catch (e) {
                    reject(e);
                }
            }
        };
        const timer = setTimeout(() => {
            stdout.off("data", onData);
            reject(new Error(`timed out waiting for child JSON line (${buf})`));
        }, timeoutMs);
        stdout.on("data", onData);
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (buf.indexOf("\n") === -1) {
                clearTimeout(timer);
                reject(
                    new Error(
                        `child exited (code=${code}, signal=${signal}) before emitting JSON line; got: ${buf}`,
                    ),
                );
            }
        });
    });
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

interface TestResult {
    name: string;
    pass: boolean;
    error?: string;
}

const tests: { name: string; run: () => Promise<void> }[] = [];
function test(name: string, run: () => Promise<void>) {
    tests.push({ name, run });
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(`assert: ${msg}`);
}

// -----------------------------------------------------------------
// Tests
// -----------------------------------------------------------------

test("single allocation: a fake registers, registry shows the slot", async () => {
    const env = await TestEnv.create();
    try {
        const { ready } = await env.spawnFake("ws-1");
        const status = await env.status();
        assert(
            status.entries.some((e) => e.resources.includes("ws-1")),
            `expected slot for ws-1, got ${JSON.stringify(status)}`,
        );
        assert(typeof ready.port === "number", "fake reported a port");
    } finally {
        await env.cleanup();
    }
});

test("client-only lookup: a separate process discovers an existing slot", async () => {
    const env = await TestEnv.create();
    try {
        const { ready } = await env.spawnFake("ws-lookup");
        const reply = await env.lookupFromClient("ws-lookup");
        assert(
            reply.result.slotId === ready.slotId,
            `lookup slotId mismatch: ${reply.result.slotId} vs ${ready.slotId}`,
        );
        assert(
            reply.result.ports?.[0] === ready.port,
            `lookup port mismatch: ${JSON.stringify(reply.result.ports)} vs ${ready.port}`,
        );
    } finally {
        await env.cleanup();
    }
});

test("different workspace keys: each gets its own slot and port", async () => {
    const env = await TestEnv.create();
    try {
        const a = await env.spawnFake("ws-a");
        const b = await env.spawnFake("ws-b");
        assert(
            a.ready.slotId !== b.ready.slotId,
            "slots must be distinct across workspaces",
        );
        assert(a.ready.port !== b.ready.port, "ports must be distinct");
    } finally {
        await env.cleanup();
    }
});

test("liveness GC: killed slot owner is swept from the registry", async () => {
    const env = await TestEnv.create();
    try {
        // Spawn the survivor first so it wins the bind race and is
        // the registry server. The owner we kill is then a client of
        // it, and its slot gets GC'd on the next lookup.
        const { child: host } = await env.spawnFake("ws-gc-host");
        const owner = await env.spawnFake("ws-gc");
        // SIGKILL the owner so the slot is orphaned (no clean release).
        await env.kill(owner.child, "SIGKILL");

        // Trigger lookups to force GC sweep on the surviving registry.
        let cleared = false;
        for (let i = 0; i < 30; i++) {
            const reply = await env.lookupFromClient("ws-gc");
            if (reply.result.ports === null || reply.result.ports.length === 0) {
                cleared = true;
                break;
            }
            await sleep(200);
        }
        assert(cleared, "expected ws-gc slot to be GC'd within 6s");
        // Other slot survives.
        const survivor = await env.lookupFromClient("ws-gc-host");
        assert(
            survivor.result.slotId !== undefined,
            "host slot should still be present",
        );
        void host;
    } finally {
        await env.cleanup();
    }
});

test("client-only handle never binds the well-known port", async () => {
    const env = await TestEnv.create();
    try {
        // No server-eligible process is alive. A client-only lookup
        // should fail (nobody bound the port, client cannot promote).
        const child = spawn(
            "node",
            [FAKE_PATH, "--workspace", "ws-x", "--client-only"],
            {
                env: {
                    ...process.env,
                    TYPEAGENT_USE_PORT_REGISTRY: "1",
                    TYPEAGENT_PORT_REGISTRY_PORT: String(env.registryPort),
                },
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
        const exit = await new Promise<number | null>((resolve) =>
            child.once("exit", (code) => resolve(code)),
        );
        assert(
            exit !== 0,
            `client-only lookup with no server should fail; got exit=${exit}`,
        );
        // Confirm the registry port is still free (no zombie listener).
        assert(
            !(await env.registryReachable()),
            "registry port must remain unbound after a client-only failure",
        );
    } finally {
        await env.cleanup();
    }
});

// -----------------------------------------------------------------
// Runner
// -----------------------------------------------------------------

async function run() {
    const results: TestResult[] = [];
    const t0 = Date.now();
    for (const t of tests) {
        const start = Date.now();
        process.stdout.write(`[smoke] ${t.name} ... `);
        try {
            await t.run();
            const ms = Date.now() - start;
            console.log(`PASS (${ms}ms)`);
            results.push({ name: t.name, pass: true });
        } catch (err) {
            const ms = Date.now() - start;
            const msg =
                err instanceof Error ? (err.stack ?? err.message) : String(err);
            console.log(`FAIL (${ms}ms)\n        ${msg}`);
            results.push({ name: t.name, pass: false, error: msg });
        }
    }
    const total = Date.now() - t0;
    const passed = results.filter((r) => r.pass).length;
    console.log(
        `\n[smoke] ${passed}/${results.length} passed in ${total}ms`,
    );
    if (passed !== results.length) process.exit(1);
}

void run();
