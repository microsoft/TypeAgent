// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface, Interface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { Rect, Screenshot, TreeNode, WindowInfo } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Pending = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
};

export type HelperRpcError = Error & { code?: number };

export interface HelperClientOptions {
    binaryPath?: string;
    debug?: boolean;
}

/**
 * Resolves the helper binary path. Order:
 *   1. opts.binaryPath
 *   2. TYPEAGENT_UIA_HELPER env var
 *   3. Repo-relative dev path (for local development)
 */
function resolveBinary(opts: HelperClientOptions): string {
    if (opts.binaryPath) {
        return opts.binaryPath;
    }
    if (process.env.TYPEAGENT_UIA_HELPER) {
        return process.env.TYPEAGENT_UIA_HELPER;
    }
    // From dist/uiCapture/helperClient.js, repo root is six levels up.
    const repoRelative = path.resolve(
        __dirname,
        "../../../../../..",
        "dotnet/uiAutomationHelper/bin/Release/UiAutomationHelper.exe",
    );
    return repoRelative;
}

/**
 * JSON-RPC 2.0 client over stdio for the .NET UIA helper.
 *
 * Slice 1 surface: ping, app.launch/attach/list/kill, tree.dump, screenshot, do.invoke.
 * Single-flight is fine for slice 1; events and concurrent requests come later.
 */
export class HelperClient {
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private exited = false;
    private exitCode: number | null = null;

    private constructor(
        private readonly child: ChildProcess,
        private readonly stdoutLines: Interface,
        private readonly debug: boolean,
    ) {}

    static async start(opts: HelperClientOptions = {}): Promise<HelperClient> {
        const binary = resolveBinary(opts);
        if (!existsSync(binary)) {
            throw new Error(
                `Helper binary not found at ${binary}. ` +
                    `Build it via: dotnet build -c Release ` +
                    `dotnet/uiAutomationHelper/UiAutomationHelper.sln`,
            );
        }
        const child = spawn(binary, [], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        const stdoutLines = createInterface({
            input: child.stdout!,
            crlfDelay: Infinity,
        });
        const client = new HelperClient(child, stdoutLines, opts.debug ?? false);
        client.attach();
        // Verify the helper is actually responding before returning.
        await client.ping();
        return client;
    }

    private attach(): void {
        this.stdoutLines.on("line", (line) => this.handleLine(line));
        this.child.on("exit", (code) => {
            this.exited = true;
            this.exitCode = code;
            for (const [id, p] of this.pending.entries()) {
                p.reject(
                    new Error(
                        `Helper exited (code ${code}) before responding to request ${id}`,
                    ),
                );
            }
            this.pending.clear();
        });
        this.child.stderr!.on("data", (data: Buffer) => {
            if (this.debug) {
                process.stderr.write(`[uia-helper] ${data.toString()}`);
            }
        });
    }

    private handleLine(line: string): void {
        if (!line.trim()) {
            return;
        }
        let msg: {
            id?: number | string | null;
            result?: unknown;
            error?: { code: number; message: string; data?: unknown };
        };
        try {
            msg = JSON.parse(line);
        } catch {
            if (this.debug) {
                process.stderr.write(`[uia-helper bad-json] ${line}\n`);
            }
            return;
        }
        const id = typeof msg.id === "number" ? msg.id : null;
        if (id == null) {
            // Notifications not handled in slice 1.
            return;
        }
        const p = this.pending.get(id);
        if (!p) {
            return;
        }
        this.pending.delete(id);
        if (msg.error) {
            const err = new Error(
                `[${msg.error.code}] ${msg.error.message}`,
            ) as HelperRpcError;
            err.code = msg.error.code;
            p.reject(err);
        } else {
            p.resolve(msg.result);
        }
    }

    private call<T = unknown>(method: string, params?: unknown): Promise<T> {
        if (this.exited) {
            return Promise.reject(
                new Error(`Helper has exited (code ${this.exitCode})`),
            );
        }
        const id = this.nextId++;
        const req = { jsonrpc: "2.0", id, method, params };
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
            });
            this.child.stdin!.write(JSON.stringify(req) + "\n", (err) => {
                if (err) {
                    this.pending.delete(id);
                    reject(err);
                }
            });
        });
    }

    ping(): Promise<{ ok: true; version: string }> {
        return this.call("health.ping");
    }

    appLaunch(p: {
        aumid?: string;
        exePath?: string;
        args?: string[];
    }): Promise<{ pid: number; mainWindow: string }> {
        return this.call("app.launch", p);
    }

    appAttach(p: {
        pid?: number;
        windowTitle?: string;
    }): Promise<{ pid: number; mainWindow: string }> {
        return this.call("app.attach", p);
    }

    appList(): Promise<WindowInfo[]> {
        return this.call("app.list");
    }

    appKill(p: { pid: number }): Promise<{ ok: true }> {
        return this.call("app.kill", p);
    }

    treeDump(p: {
        root: string;
        maxDepth?: number;
        filter?: "actionable" | "all";
    }): Promise<TreeNode> {
        return this.call("tree.dump", p);
    }

    screenshot(p: { root: string }): Promise<Screenshot> {
        return this.call("screenshot", p);
    }

    doInvoke(p: { selector: string }): Promise<{ ok: true }> {
        return this.call("do.invoke", p);
    }

    doToggle(p: {
        selector: string;
        value?: boolean;
    }): Promise<{ ok: true; toggleState: string }> {
        return this.call("do.toggle", p);
    }

    doSetValue(p: {
        selector: string;
        value: string | number | boolean;
    }): Promise<{ ok: true }> {
        return this.call("do.setValue", p);
    }

    doSelect(p: {
        selector: string;
        item?: string | number;
    }): Promise<{ ok: true }> {
        return this.call("do.select", p);
    }

    doExpand(p: { selector: string; expand: boolean }): Promise<{ ok: true }> {
        return this.call("do.expand", p);
    }

    doScroll(p: {
        selector: string;
        direction: "up" | "down" | "left" | "right";
        amount?: "small" | "large";
    }): Promise<{ ok: true }> {
        return this.call("do.scroll", p);
    }

    doFocus(p: { selector: string }): Promise<{ ok: true }> {
        return this.call("do.focus", p);
    }

    doClick(p: {
        selector: string;
        button?: "left" | "right";
        position?: { x?: number; y?: number };
    }): Promise<{ ok: true }> {
        return this.call("do.click", p);
    }

    doSendKeys(p: {
        selector?: string;
        keys: string;
    }): Promise<{ ok: true }> {
        return this.call("do.sendKeys", p);
    }

    find(p: {
        selector: string;
        timeoutMs?: number;
    }): Promise<{ found: boolean; resolved?: string }> {
        return this.call("find", p);
    }

    eventsIdle(
        p: { debounceMs?: number; maxWaitMs?: number } = {},
    ): Promise<{ ok: true; idle: boolean; waitedMs: number }> {
        return this.call("events.idle", p);
    }

    /**
     * Close the helper's stdin and wait up to `timeoutMs` for graceful exit.
     * If it doesn't exit, send SIGKILL.
     */
    async dispose(timeoutMs = 2000): Promise<void> {
        if (this.exited) {
            return;
        }
        this.child.stdin!.end();
        const exited = new Promise<void>((res) =>
            this.child.once("exit", () => res()),
        );
        const timeout = new Promise<void>((res) => setTimeout(res, timeoutMs));
        await Promise.race([exited, timeout]);
        if (!this.exited) {
            this.child.kill("SIGKILL");
        }
    }
}

export type { Rect, Screenshot, TreeNode, WindowInfo };
