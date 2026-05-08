// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wire protocol for the PortRegistry HTTP service.
 *
 * The registry exposes a small REST API on a single well-known port so that
 * Node, browser, .NET, and Office add-in callers can all participate.
 */

/** Default well-known port the registry binds to. */
export const DEFAULT_REGISTRY_PORT = 5681;

/** Env var name that overrides the default registry port. */
export const REGISTRY_PORT_ENV = "TYPEAGENT_PORT_REGISTRY_PORT";

/** Env var that gates whether consumers use the registry at all (PR-A flag). */
export const USE_REGISTRY_ENV = "TYPEAGENT_USE_PORT_REGISTRY";

/** Standard namespace identifiers used across the codebase. */
export const Namespaces = {
    AgentServer: "agentServer",
} as const;

export type Namespace = string;

// -- POST /allocate -------------------------------------------------------

export interface AllocateRequest {
    namespace: Namespace;
    /** Number of distinct ports to reserve. Default 1. */
    count?: number;
    /** Optional opaque key the caller wants to reserve up-front (also calls register). */
    key?: string;
    /** PID of the caller. Used for liveness GC. */
    ownerPid: number;
}

export interface AllocateResponse {
    slotId: string;
    ports: number[];
}

// -- POST /register -------------------------------------------------------

export interface RegisterRequest {
    slotId: string;
    /** Resource key — workbook name, solution path, etc. */
    resource: string;
}

export interface RegisterResponse {
    ok: true;
}

// -- DELETE /unregister?slotId=&resource= ---------------------------------

export interface UnregisterResponse {
    ok: true;
}

// -- GET /lookup?ns=&key= -------------------------------------------------

export interface LookupResponse {
    /** Null when no live slot is registered for that (ns, resource) pair. */
    slotId: string | null;
    ports: number[] | null;
}

// -- DELETE /release?slotId= ----------------------------------------------

export interface ReleaseResponse {
    ok: true;
}

// -- GET /status ----------------------------------------------------------

export interface StatusEntry {
    slotId: string;
    namespace: Namespace;
    ports: number[];
    ownerPid: number;
    allocatedAt: number;
    resources: string[];
}

export interface StatusResponse {
    entries: StatusEntry[];
}

// -- Errors ---------------------------------------------------------------

export interface ErrorResponse {
    error: string;
}
