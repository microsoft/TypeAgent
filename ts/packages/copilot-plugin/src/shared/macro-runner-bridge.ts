// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomBytes } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { getConfigDir } from "./plugin-config.js";
import type { AgentHandoff } from "@typeagent/agent-sdk";
import { z } from "zod";

const requestSchema = z.object({
    agentName: z.literal("typeagent-macro-runner"),
    payload: z.record(z.unknown()),
    submittedAt: z.number().finite().positive(),
    capability: z.string(),
});
const responseSchema = z.union([
    z.object({ response: z.string() }),
    z.object({ error: z.string() }),
]);
const maxMessageBytes = 4 * 1024 * 1024;
const hostLeaseSchema = z.object({
    pid: z.number().int().positive(),
    capability: z.string().min(1),
});

function createHostLease(sessionId: string, capability: string): void {
    const file = capabilityFile(sessionId);
    try {
        writeFileSync(file, JSON.stringify({ pid: process.pid, capability }), {
            flag: "wx",
            mode: 0o600,
        });
        return;
    } catch (error) {
        if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            error.code !== "EEXIST"
        )
            throw error;
    }
    const owner = hostLeaseSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    try {
        process.kill(owner.pid, 0);
    } catch (error) {
        if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            error.code !== "ESRCH"
        )
            throw error;
        rmSync(file);
        if (process.platform !== "win32")
            rmSync(endpoint(sessionId), { force: true });
        writeFileSync(file, JSON.stringify({ pid: process.pid, capability }), {
            flag: "wx",
            mode: 0o600,
        });
        return;
    }
    throw new Error("A live macro host already owns this native session.");
}

function runnerMarker(sessionId: string): string {
    return join(
        getConfigDir(),
        "macro-runner-sessions",
        createHash("sha256").update(sessionId).digest("hex") + ".json",
    );
}

export function markMacroRunnerSession(sessionId: string): void {
    mkdirSync(join(getConfigDir(), "macro-runner-sessions"), {
        recursive: true,
        mode: 0o700,
    });
    writeFileSync(
        runnerMarker(sessionId),
        JSON.stringify({ sessionId, role: "typeagent-macro-runner" }),
        { mode: 0o600 },
    );
}

export function clearMacroRunnerSession(sessionId: string): void {
    rmSync(runnerMarker(sessionId), { force: true });
}

export function isMacroRunnerSession(sessionId: string): boolean {
    let content: string;
    try {
        content = readFileSync(runnerMarker(sessionId), "utf8");
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
        )
            return false;
        throw error;
    }
    const value = z
        .object({
            sessionId: z.literal(sessionId),
            role: z.literal("typeagent-macro-runner"),
        })
        .parse(JSON.parse(content));
    return value.role === "typeagent-macro-runner";
}

function hostDirectory(): string {
    return join(getConfigDir(), "macro-runner-hosts");
}

function capabilityFile(sessionId: string): string {
    return join(
        hostDirectory(),
        createHash("sha256").update(sessionId).digest("hex") + ".key",
    );
}

function endpoint(sessionId: string): string {
    const key = createHash("sha256").update(sessionId).digest("hex");
    return process.platform === "win32"
        ? `\\\\.\\pipe\\typeagent-macro-${key}`
        : join(hostDirectory(), `${key.slice(0, 32)}.sock`);
}

function readMessage(socket: Socket): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let message = "";
        let finished = false;
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
            if (finished) return;
            message += chunk;
            if (Buffer.byteLength(message) > maxMessageBytes) {
                finished = true;
                reject(new Error("Macro host message exceeds the size limit."));
                socket.destroy();
            } else if (message.endsWith("\n")) {
                finished = true;
                try {
                    resolve(JSON.parse(message));
                } catch (error) {
                    reject(error);
                }
            }
        });
        socket.on("error", reject);
        socket.on("end", () =>
            reject(new Error("Macro host disconnected before replying.")),
        );
    });
}

export async function requestMacroRunner(
    sessionId: string,
    handoff: AgentHandoff,
    submittedAt = Date.now(),
): Promise<string> {
    let content: string;
    try {
        content = readFileSync(capabilityFile(sessionId), "utf8");
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            throw new Error(
                "Native macro host is unavailable. Load the TypeAgent native extension (--experimental on Copilot CLI 1.0.89). Do not repeat the request.",
            );
        }
        throw error;
    }
    const { capability } = hostLeaseSchema.parse(JSON.parse(content));
    const socket = createConnection(endpoint(sessionId));
    socket.setTimeout(290000, () =>
        socket.destroy(
            new Error("Macro host execution timed out; do not retry."),
        ),
    );
    try {
        const response = readMessage(socket);
        socket.write(
            JSON.stringify(
                requestSchema.parse({ ...handoff, submittedAt, capability }),
            ) + "\n",
        );
        const value = responseSchema.parse(await response);
        if ("error" in value) throw new Error(value.error);
        return value.response;
    } finally {
        socket.destroy();
    }
}

export async function startMacroRunnerBridge(
    sessionId: string,
    execute: (
        handoff: AgentHandoff,
        submittedAt: number,
        signal: AbortSignal,
    ) => Promise<string>,
    logError: (message: string) => void,
): Promise<() => void> {
    mkdirSync(hostDirectory(), { recursive: true, mode: 0o700 });
    const capability = randomBytes(32).toString("hex");
    createHostLease(sessionId, capability);
    let active = false;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
        sockets.add(socket);
        const abort = new AbortController();
        let finished = false;
        socket.on("close", () => {
            sockets.delete(socket);
            if (!finished) abort.abort();
        });
        socket.setTimeout(290000, () => socket.destroy());
        void (async () => {
            const handoff = requestSchema.parse(await readMessage(socket));
            if (handoff.capability !== capability)
                throw new Error("Unauthorized macro host request.");
            if (active) throw new Error("A macro runner is already active.");
            active = true;
            try {
                const response = await execute(
                    { agentName: handoff.agentName, payload: handoff.payload },
                    handoff.submittedAt,
                    abort.signal,
                );
                finished = true;
                socket.end(JSON.stringify({ response }) + "\n");
            } finally {
                active = false;
            }
        })().catch((error: unknown) => {
            const message =
                error instanceof Error ? error.message : String(error);
            logError(`[macro-host] ${message}`);
            socket.end(JSON.stringify({ error: message }) + "\n");
        });
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(endpoint(sessionId), resolve);
        });
    } catch (error) {
        rmSync(capabilityFile(sessionId), { force: true });
        throw error;
    }
    server.on("error", (error) => logError(`[macro-host] ${error.message}`));
    let closed = false;
    return () => {
        if (closed) return;
        closed = true;
        for (const socket of sockets) socket.destroy();
        server.close();
        rmSync(capabilityFile(sessionId), { force: true });
    };
}
