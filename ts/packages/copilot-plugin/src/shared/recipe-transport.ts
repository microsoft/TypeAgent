// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
    localRecipeDirectory,
    localRecipeEndpoint,
    localRecipeScope,
    localRecipeSessionEndpoint,
} from "./recipe-local-paths.js";

const maxPacketBytes = 8 * 1024 * 1024;
interface Endpoint {
    version: 1;
    address: string;
    token: string;
    sessionId: string;
    pid: number;
    workspaceId: string;
    profileId: string;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEndpoint(text: string): Endpoint {
    if (Buffer.byteLength(text) > 16_384)
        throw new Error("Oversized local recipe endpoint.");
    const value: unknown = JSON.parse(text);
    if (
        !record(value) ||
        value.version !== 1 ||
        typeof value.address !== "string" ||
        typeof value.token !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.token) ||
        typeof value.sessionId !== "string" ||
        typeof value.workspaceId !== "string" ||
        !value.workspaceId.trim() ||
        typeof value.profileId !== "string" ||
        typeof value.pid !== "number" ||
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0
    )
        throw new Error("Invalid local recipe endpoint.");
    return {
        version: 1,
        address: value.address,
        token: value.token,
        sessionId: value.sessionId,
        pid: value.pid,
        workspaceId: value.workspaceId,
        profileId: value.profileId,
    };
}

export async function resolveLocalRecipeWorkspace(
    sessionId: string,
): Promise<string> {
    const endpoint = parseEndpoint(
        await readFile(localRecipeSessionEndpoint(sessionId), "utf8"),
    );
    if (
        endpoint.sessionId !== sessionId ||
        endpoint.profileId !== localRecipeScope(process.cwd()).profileId
    )
        throw new Error("Local recipe session/profile binding changed.");
    return endpoint.workspaceId;
}

function readPacket(socket: Socket, consume: (value: unknown) => void): void {
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
        text += chunk;
        if (Buffer.byteLength(text) > maxPacketBytes) {
            socket.destroy(new Error("Local recipe packet exceeds its limit."));
            return;
        }
        const end = text.indexOf("\n");
        if (end < 0) return;
        socket.removeAllListeners("data");
        try {
            consume(JSON.parse(text.slice(0, end)));
        } catch (error) {
            socket.destroy(
                error instanceof SyntaxError
                    ? new Error("Invalid local recipe JSON.")
                    : error instanceof Error
                      ? error
                      : new Error(String(error)),
            );
        }
    });
}

export async function callLocalRecipe(
    cwd: string,
    sessionId: string,
    method: string,
    args: unknown[],
): Promise<unknown> {
    const endpoint = parseEndpoint(
        await readFile(localRecipeEndpoint(cwd, sessionId), "utf8"),
    );
    if (endpoint.sessionId !== sessionId)
        throw new Error("Local recipe session binding changed.");
    const scope = localRecipeScope(cwd);
    if (
        endpoint.workspaceId !== scope.workspaceId ||
        endpoint.profileId !== scope.profileId
    )
        throw new Error("Local recipe workspace/profile binding changed.");
    const validAddress =
        process.platform === "win32"
            ? /^\\\\\.\\pipe\\typeagent-recipes-[a-f0-9-]{36}$/.test(
                  endpoint.address,
              )
            : dirname(endpoint.address) === localRecipeDirectory(cwd) &&
              endpoint.address.endsWith(".sock");
    if (!validAddress)
        throw new Error(
            "Local recipe endpoint is outside its private transport scope.",
        );
    const id = randomUUID();
    const packet = JSON.stringify({
        id,
        token: endpoint.token,
        sessionId,
        method,
        args,
    });
    if (Buffer.byteLength(packet) > maxPacketBytes)
        throw new Error("Local recipe request exceeds its limit.");
    return new Promise((resolve, reject) => {
        let replied = false;
        const socket = createConnection(endpoint.address);
        const fail = (error: Error) => {
            socket.destroy();
            reject(
                new Error(
                    `Local recipe request ${id} failed; do not retry accepted work automatically: ${error.message}`,
                ),
            );
        };
        socket.on("error", fail);
        socket.setTimeout(75_000, () =>
            fail(new Error("The local recipe host timed out.")),
        );
        socket.on("connect", () => socket.write(`${packet}\n`));
        readPacket(socket, (reply) => {
            if (
                !record(reply) ||
                reply.id !== id ||
                typeof reply.ok !== "boolean"
            ) {
                fail(new Error("Invalid correlated local recipe response."));
                return;
            }
            replied = true;
            socket.end();
            if (reply.ok) resolve(reply.value);
            else
                reject(
                    new Error(
                        typeof reply.error === "string"
                            ? reply.error
                            : "Local recipe operation failed.",
                    ),
                );
        });
        socket.on("close", () => {
            if (!replied)
                fail(
                    new Error(
                        "Connection closed without an outcome; reconcile any accepted execution.",
                    ),
                );
        });
    });
}

export async function startLocalRecipeBroker(
    cwd: string,
    sessionId: string,
    dispatch: (method: string, args: unknown[]) => Promise<unknown>,
    report: (message: string) => void,
) {
    const directory = localRecipeDirectory(cwd);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const endpointFile = localRecipeEndpoint(cwd, sessionId);
    const sessionFile = localRecipeSessionEndpoint(sessionId);
    const token = randomBytes(32).toString("hex");
    const address =
        process.platform === "win32"
            ? `\\\\.\\pipe\\typeagent-recipes-${randomUUID()}`
            : join(directory, `${randomUUID()}.sock`);
    const endpoint: Endpoint = {
        version: 1,
        address,
        token,
        sessionId,
        pid: process.pid,
        ...localRecipeScope(cwd),
    };
    const text = JSON.stringify(endpoint);
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
        DatabaseSync: new (path: string) => {
            exec(sql: string): void;
            close(): void;
        };
    };
    const lease = new DatabaseSync(join(directory, "owner-lock.sqlite"));
    try {
        // Hold the OS-backed SQLite writer lock until all owner work has stopped.
        lease.exec(
            "PRAGMA busy_timeout = 0; CREATE TABLE IF NOT EXISTS owner_lock (id INTEGER PRIMARY KEY); BEGIN IMMEDIATE;",
        );
    } catch (error) {
        lease.close();
        const code = record(error) ? error.errcode : undefined;
        if (code === 5 || code === 6)
            throw new Error(
                "This workspace/profile already has a live recipe owner. Close that native session before transferring ownership.",
            );
        throw error;
    }
    const sockets = new Set<Socket>();
    const pending = new Set<Promise<void>>();
    const server = createServer((socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", (error) =>
            report(`Local recipe transport: ${error.message}`),
        );
        socket.setTimeout(75_000, () =>
            socket.destroy(new Error("Recipe client timed out.")),
        );
        readPacket(socket, (request) => {
            const work = (async () => {
                let id: unknown;
                try {
                    if (!record(request))
                        throw new Error("Invalid local recipe request.");
                    id = request.id;
                    if (
                        typeof id !== "string" ||
                        request.sessionId !== sessionId ||
                        typeof request.token !== "string" ||
                        request.token.length !== token.length ||
                        !timingSafeEqual(
                            Buffer.from(request.token),
                            Buffer.from(token),
                        ) ||
                        typeof request.method !== "string" ||
                        !Array.isArray(request.args) ||
                        request.args.length > 8
                    )
                        throw new Error(
                            "Local recipe request is not bound to this host.",
                        );
                    const value = await dispatch(request.method, request.args);
                    const reply = JSON.stringify({ id, ok: true, value });
                    if (Buffer.byteLength(reply) > maxPacketBytes)
                        throw new Error(
                            "Local recipe response exceeds its limit.",
                        );
                    socket.end(`${reply}\n`);
                } catch (error) {
                    socket.end(
                        `${JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
                    );
                }
            })().catch((error) =>
                report(`Local recipe dispatch failed: ${String(error)}`),
            );
            pending.add(work);
            void work.then(() => pending.delete(work));
        });
    });
    const removeOwned = async (file: string) => {
        try {
            if (parseEndpoint(await readFile(file, "utf8")).token === token)
                await unlink(file);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    };
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(address, () => {
                server.removeListener("error", reject);
                resolve();
            });
        });
        server.on("error", (error) =>
            report(`Local recipe broker: ${error.message}`),
        );
        const temporary = `${endpointFile}.${randomUUID()}.tmp`;
        await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
        await rename(temporary, endpointFile);
        await mkdir(dirname(sessionFile), { recursive: true, mode: 0o700 });
        const sessionTemporary = `${sessionFile}.${randomUUID()}.tmp`;
        await writeFile(sessionTemporary, text, { flag: "wx", mode: 0o600 });
        await rename(sessionTemporary, sessionFile);
    } catch (error) {
        if (server.listening) server.close();
        await removeOwned(endpointFile);
        await removeOwned(sessionFile);
        lease.close();
        throw error;
    }
    let closing: Promise<void> | undefined;
    return {
        close(): Promise<void> {
            closing ??= (async () => {
                for (const socket of sockets) socket.destroy();
                await new Promise<void>((resolve, reject) =>
                    server.close((error) =>
                        error ? reject(error) : resolve(),
                    ),
                );
                await Promise.all(pending);
                try {
                    await removeOwned(endpointFile);
                    await removeOwned(sessionFile);
                } finally {
                    lease.close();
                }
            })();
            return closing;
        },
    };
}
