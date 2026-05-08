// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    AllocateRequest,
    AllocateResponse,
    DEFAULT_REGISTRY_PORT,
    LookupResponse,
    Namespace,
    REGISTRY_PORT_ENV,
    USE_REGISTRY_ENV,
} from "./protocol.js";
import { RegistryState, startRegistryServer } from "./server.js";

const debug = registerDebug("typeagent:portRegistry:client");

/** Returns the port the registry should bind to (env var override or default). */
export function getRegistryPort(): number {
    const env = process.env[REGISTRY_PORT_ENV];
    if (env) {
        const n = parseInt(env, 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return DEFAULT_REGISTRY_PORT;
}

/** True if consumers should route through the registry (PR-A feature flag). */
export function isRegistryEnabled(): boolean {
    const v = process.env[USE_REGISTRY_ENV];
    if (!v) return false;
    return v === "1" || v.toLowerCase() === "true";
}

interface ShadowEntry {
    slotId: string;
    namespace: Namespace;
    ports: number[];
    ownerPid: number;
    allocatedAt: number;
    resources: Set<string>;
}

/**
 * Process-wide PortRegistry handle.
 *
 * `ensure()` either binds the well-known port (server mode) or enters
 * client mode and forwards calls to the existing server. If the existing
 * server's process dies, this handle self-promotes by binding the port
 * itself and replaying its shadow map.
 */
export class PortRegistry {
    private state = new RegistryState();
    private serverClose: (() => Promise<void>) | undefined;
    private mode: "server" | "client" | "uninitialized" = "uninitialized";
    private port = getRegistryPort();

    /** Shadow copy of slots this process owns (for replay on self-promotion). */
    private shadow = new Map<string, ShadowEntry>();

    private promoting = false;

    async ensure(): Promise<void> {
        if (this.mode !== "uninitialized") return;
        const result = await startRegistryServer(this.state, this.port);
        if (result.kind === "started") {
            this.mode = "server";
            this.serverClose = result.close;
            debug(`mode=server port=${this.port}`);
        } else {
            this.mode = "client";
            debug(`mode=client port=${this.port}`);
        }
    }

    async allocate(
        namespace: Namespace,
        opts: { count?: number; key?: string } = {},
    ): Promise<AllocateResponse> {
        await this.ensure();
        const req: AllocateRequest = {
            namespace,
            count: opts.count ?? 1,
            ownerPid: process.pid,
            ...(opts.key !== undefined ? { key: opts.key } : {}),
        };
        let result: AllocateResponse;
        if (this.mode === "server") {
            result = await this.state.allocateAsync(req);
        } else {
            result = await this.fetchJson<AllocateResponse>(
                "POST",
                "/allocate",
                req,
            );
        }
        this.shadow.set(result.slotId, {
            slotId: result.slotId,
            namespace,
            ports: result.ports,
            ownerPid: process.pid,
            allocatedAt: Date.now(),
            resources: new Set(opts.key ? [opts.key] : []),
        });
        return result;
    }

    async register(slotId: string, resource: string): Promise<void> {
        await this.ensure();
        if (this.mode === "server") {
            this.state.registerResource(slotId, resource);
        } else {
            await this.fetchJson("POST", "/register", { slotId, resource });
        }
        const shadow = this.shadow.get(slotId);
        if (shadow) shadow.resources.add(resource);
    }

    async unregister(slotId: string, resource: string): Promise<void> {
        await this.ensure();
        if (this.mode === "server") {
            this.state.unregisterResource(slotId, resource);
        } else {
            const url = `/unregister?slotId=${encodeURIComponent(slotId)}&resource=${encodeURIComponent(resource)}`;
            await this.fetchJson("DELETE", url);
        }
        const shadow = this.shadow.get(slotId);
        if (shadow) shadow.resources.delete(resource);
    }

    async release(slotId: string): Promise<void> {
        await this.ensure();
        if (this.mode === "server") {
            this.state.release(slotId);
        } else {
            await this.fetchJson(
                "DELETE",
                `/release?slotId=${encodeURIComponent(slotId)}`,
            );
        }
        this.shadow.delete(slotId);
    }

    async lookup(
        namespace: Namespace,
        resource?: string,
    ): Promise<LookupResponse> {
        await this.ensure();
        if (this.mode === "server") {
            return resource === undefined
                ? this.state.lookupNamespaceSingleton(namespace)
                : this.state.lookup(namespace, resource);
        }
        const params = new URLSearchParams({ ns: namespace });
        if (resource !== undefined) params.set("key", resource);
        return this.fetchJson<LookupResponse>(
            "GET",
            `/lookup?${params.toString()}`,
        );
    }

    /** Stop the registry (server mode) and clear local state. */
    async stop(): Promise<void> {
        if (this.serverClose) {
            await this.serverClose();
            this.serverClose = undefined;
        }
        this.shadow.clear();
        this.mode = "uninitialized";
    }

    private async fetchJson<T>(
        method: string,
        path: string,
        body?: unknown,
    ): Promise<T> {
        const url = `http://127.0.0.1:${this.port}${path}`;
        try {
            const init: RequestInit = { method };
            if (body !== undefined) {
                init.headers = { "Content-Type": "application/json" };
                init.body = JSON.stringify(body);
            }
            const res = await fetch(url, init);
            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new Error(`registry ${method} ${path} → ${res.status} ${text}`);
            }
            return (await res.json()) as T;
        } catch (err) {
            // Server may have died — try to self-promote and retry once.
            if (this.mode === "client" && !this.promoting) {
                debug(`fetch failed (${err}); attempting self-promotion`);
                await this.tryPromote();
                if ((this.mode as "server" | "client") === "server") {
                    return this.dispatchLocal<T>(method, path, body);
                }
            }
            throw err;
        }
    }

    private async tryPromote(): Promise<void> {
        if (this.promoting) return;
        this.promoting = true;
        try {
            const result = await startRegistryServer(this.state, this.port);
            if (result.kind === "started") {
                this.mode = "server";
                this.serverClose = result.close;
                // Replay our own shadow into the new server state.
                this.state.restore(
                    [...this.shadow.values()].map((s) => ({ ...s })),
                );
                debug(
                    `self-promoted; replayed ${this.shadow.size} shadow entries`,
                );
            } else {
                debug(`self-promotion lost race; staying in client mode`);
                this.mode = "client";
            }
        } finally {
            this.promoting = false;
        }
    }

    /** Re-dispatch a call against in-process state after self-promotion. */
    private async dispatchLocal<T>(
        method: string,
        path: string,
        body?: unknown,
    ): Promise<T> {
        const url = new URL(path, "http://127.0.0.1");
        if (method === "POST" && url.pathname === "/allocate") {
            return (await this.state.allocateAsync(
                body as AllocateRequest,
            )) as T;
        }
        if (method === "POST" && url.pathname === "/register") {
            const r = body as { slotId: string; resource: string };
            this.state.registerResource(r.slotId, r.resource);
            return { ok: true } as T;
        }
        if (method === "DELETE" && url.pathname === "/unregister") {
            const slotId = url.searchParams.get("slotId")!;
            const resource = url.searchParams.get("resource")!;
            this.state.unregisterResource(slotId, resource);
            return { ok: true } as T;
        }
        if (method === "DELETE" && url.pathname === "/release") {
            const slotId = url.searchParams.get("slotId")!;
            this.state.release(slotId);
            return { ok: true } as T;
        }
        if (method === "GET" && url.pathname === "/lookup") {
            const ns = url.searchParams.get("ns")!;
            const key = url.searchParams.get("key");
            return (
                key === null
                    ? this.state.lookupNamespaceSingleton(ns)
                    : this.state.lookup(ns, key)
            ) as T;
        }
        throw new Error(`dispatchLocal: no route for ${method} ${path}`);
    }
}

/** Process-wide singleton. */
export const globalRegistry = new PortRegistry();
