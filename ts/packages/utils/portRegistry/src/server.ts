// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer, Server as HttpServer } from "http";
import { randomUUID } from "crypto";
import registerDebug from "debug";
import { reservePorts } from "./allocator.js";
import {
    AllocateRequest,
    AllocateResponse,
    DEFAULT_REGISTRY_PORT,
    LookupResponse,
    Namespace,
    RegisterRequest,
    StatusEntry,
    StatusResponse,
} from "./protocol.js";

const debug = registerDebug("typeagent:portRegistry:server");

interface SlotEntry {
    slotId: string;
    namespace: Namespace;
    ports: number[];
    ownerPid: number;
    allocatedAt: number;
    resources: Set<string>;
}

/** Result of attempting to start the registry server. */
export type StartResult =
    | { kind: "started"; port: number; close: () => Promise<void> }
    | { kind: "alreadyRunning"; port: number };

/**
 * In-process state for the registry server. Pure data and HTTP handling —
 * the multi-process leader-election lives in `client.ts`.
 */
export class RegistryState {
    private slots = new Map<string, SlotEntry>();
    /** (namespace, resource) → slotId */
    private resourceIndex = new Map<string, string>();

    private resourceKey(ns: Namespace, resource: string): string {
        return `${ns}\x00${resource}`;
    }

    allocate(_req: AllocateRequest): never {
        throw new Error("Use allocateAsync");
    }

    async allocateAsync(req: AllocateRequest): Promise<AllocateResponse> {
        const count = Math.max(1, req.count ?? 1);
        const ports = await reservePorts(count);
        const slotId = randomUUID();
        const entry: SlotEntry = {
            slotId,
            namespace: req.namespace,
            ports,
            ownerPid: req.ownerPid,
            allocatedAt: Date.now(),
            resources: new Set(),
        };
        this.slots.set(slotId, entry);
        if (req.key !== undefined) {
            this.registerResource(slotId, req.key);
        }
        debug(
            `allocated slot ${slotId} ns=${req.namespace} ports=${ports.join(",")} pid=${req.ownerPid}`,
        );
        return { slotId, ports };
    }

    registerResource(slotId: string, resource: string): void {
        const slot = this.slots.get(slotId);
        if (!slot) {
            throw new RegistryClientError(404, `unknown slotId ${slotId}`);
        }
        slot.resources.add(resource);
        this.resourceIndex.set(this.resourceKey(slot.namespace, resource), slotId);
        debug(`registered ${slot.namespace}/${resource} → ${slotId}`);
    }

    unregisterResource(slotId: string, resource: string): void {
        const slot = this.slots.get(slotId);
        if (!slot) return;
        slot.resources.delete(resource);
        const key = this.resourceKey(slot.namespace, resource);
        if (this.resourceIndex.get(key) === slotId) {
            this.resourceIndex.delete(key);
        }
        debug(`unregistered ${slot.namespace}/${resource}`);
    }

    release(slotId: string): void {
        const slot = this.slots.get(slotId);
        if (!slot) return;
        for (const resource of slot.resources) {
            this.resourceIndex.delete(this.resourceKey(slot.namespace, resource));
        }
        this.slots.delete(slotId);
        debug(`released slot ${slotId}`);
    }

    lookup(ns: Namespace, resource: string): LookupResponse {
        this.gcDeadOwners();
        const slotId = this.resourceIndex.get(this.resourceKey(ns, resource));
        if (slotId === undefined) {
            return { slotId: null, ports: null };
        }
        const slot = this.slots.get(slotId);
        if (!slot) {
            return { slotId: null, ports: null };
        }
        return { slotId: slot.slotId, ports: [...slot.ports] };
    }

    /** Find a single slot in a namespace when no resource key is supplied. */
    lookupNamespaceSingleton(ns: Namespace): LookupResponse {
        this.gcDeadOwners();
        for (const slot of this.slots.values()) {
            if (slot.namespace === ns) {
                return { slotId: slot.slotId, ports: [...slot.ports] };
            }
        }
        return { slotId: null, ports: null };
    }

    status(): StatusResponse {
        this.gcDeadOwners();
        const entries: StatusEntry[] = [];
        for (const slot of this.slots.values()) {
            entries.push({
                slotId: slot.slotId,
                namespace: slot.namespace,
                ports: [...slot.ports],
                ownerPid: slot.ownerPid,
                allocatedAt: slot.allocatedAt,
                resources: [...slot.resources],
            });
        }
        return { entries };
    }

    /** Snapshot for replay during self-promotion. */
    snapshot(): SlotEntry[] {
        return [...this.slots.values()].map((s) => ({
            ...s,
            ports: [...s.ports],
            resources: new Set(s.resources),
        }));
    }

    /** Restore from a snapshot (used by self-promoted client). */
    restore(entries: SlotEntry[]): void {
        for (const entry of entries) {
            this.slots.set(entry.slotId, {
                ...entry,
                ports: [...entry.ports],
                resources: new Set(entry.resources),
            });
            for (const resource of entry.resources) {
                this.resourceIndex.set(
                    this.resourceKey(entry.namespace, resource),
                    entry.slotId,
                );
            }
        }
    }

    /** Drop slots whose owner PID is no longer alive. */
    gcDeadOwners(): void {
        const dead: string[] = [];
        for (const [slotId, slot] of this.slots) {
            if (!isProcessAlive(slot.ownerPid)) {
                dead.push(slotId);
            }
        }
        for (const slotId of dead) {
            debug(`GC dead-owner slot ${slotId}`);
            this.release(slotId);
        }
    }
}

export class RegistryClientError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}

function isProcessAlive(pid: number): boolean {
    if (pid === process.pid) return true;
    try {
        // signal 0 — no-op delivery, throws if process is gone
        process.kill(pid, 0);
        return true;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        // EPERM means process exists but we don't have permission — count as alive
        return code === "EPERM";
    }
}

/**
 * Try to bind the registry's HTTP server on `port`. If EADDRINUSE, returns
 * `{ kind: "alreadyRunning" }` so the caller can fall back to client mode.
 */
export async function startRegistryServer(
    state: RegistryState,
    port: number = DEFAULT_REGISTRY_PORT,
): Promise<StartResult> {
    return new Promise((resolve, reject) => {
        const httpServer: HttpServer = createServer((req, res) => {
            handleRequest(state, req, res).catch((err) => {
                debug(`request error: ${err}`);
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(
                        JSON.stringify({ error: String(err?.message ?? err) }),
                    );
                }
            });
        });

        httpServer.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
                debug(`port ${port} already in use — alreadyRunning`);
                resolve({ kind: "alreadyRunning", port });
            } else {
                reject(err);
            }
        });

        httpServer.listen(port, "127.0.0.1", () => {
            debug(`registry listening on http://127.0.0.1:${port}`);
            // Periodic GC sweep so dead-owner slots clear even without lookups.
            const gcTimer = setInterval(() => state.gcDeadOwners(), 30_000);
            gcTimer.unref();
            resolve({
                kind: "started",
                port,
                close: () =>
                    new Promise<void>((res2) => {
                        clearInterval(gcTimer);
                        httpServer.close(() => res2());
                    }),
            });
        });
    });
}

async function handleRequest(
    state: RegistryState,
    req: import("http").IncomingMessage,
    res: import("http").ServerResponse,
): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    try {
        if (req.method === "GET" && path === "/status") {
            return sendJson(res, 200, state.status());
        }

        if (req.method === "GET" && path === "/lookup") {
            const ns = url.searchParams.get("ns");
            const key = url.searchParams.get("key");
            if (!ns) throw new RegistryClientError(400, "missing ns");
            const result =
                key === null
                    ? state.lookupNamespaceSingleton(ns)
                    : state.lookup(ns, key);
            return sendJson(res, 200, result);
        }

        if (req.method === "POST" && path === "/allocate") {
            const body = (await readBody(req)) as AllocateRequest;
            if (!body.namespace || typeof body.ownerPid !== "number") {
                throw new RegistryClientError(
                    400,
                    "namespace and ownerPid required",
                );
            }
            const result = await state.allocateAsync(body);
            return sendJson(res, 200, result);
        }

        if (req.method === "POST" && path === "/register") {
            const body = (await readBody(req)) as RegisterRequest;
            if (!body.slotId || !body.resource) {
                throw new RegistryClientError(
                    400,
                    "slotId and resource required",
                );
            }
            state.registerResource(body.slotId, body.resource);
            return sendJson(res, 200, { ok: true });
        }

        if (req.method === "DELETE" && path === "/unregister") {
            const slotId = url.searchParams.get("slotId");
            const resource = url.searchParams.get("resource");
            if (!slotId || !resource) {
                throw new RegistryClientError(
                    400,
                    "slotId and resource required",
                );
            }
            state.unregisterResource(slotId, resource);
            return sendJson(res, 200, { ok: true });
        }

        if (req.method === "DELETE" && path === "/release") {
            const slotId = url.searchParams.get("slotId");
            if (!slotId) throw new RegistryClientError(400, "slotId required");
            state.release(slotId);
            return sendJson(res, 200, { ok: true });
        }

        sendJson(res, 404, { error: `no route for ${req.method} ${path}` });
    } catch (e) {
        if (e instanceof RegistryClientError) {
            sendJson(res, e.status, { error: e.message });
        } else {
            throw e;
        }
    }
}

function sendJson(
    res: import("http").ServerResponse,
    status: number,
    body: unknown,
): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function readBody(req: import("http").IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (e) {
                reject(
                    new RegistryClientError(
                        400,
                        `invalid JSON body: ${(e as Error).message}`,
                    ),
                );
            }
        });
        req.on("error", reject);
    });
}
