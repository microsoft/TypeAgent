// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Readiness wiring for the browser agent.
//
// Architecture note: like the code agent, the browser agent IS the
// WebSocket server (port 8081, shared across sessions as a process
// singleton). "Ready" can mean two distinct things:
//
//   1. Electron-shell host mode — the host injects an in-process
//      BrowserControl via AppAgentInitSettings.options. The agent talks
//      to the embedded browser directly; no extension needed.
//
//   2. External / CLI mode — the user runs Chrome/Edge/Firefox with the
//      TypeAgent browser extension. The extension connects to our
//      WebSocket server as a client, scoped to a session id. "Ready"
//      means the session has at least one connected client.
//
// No setup hook: there's no programmatic way to launch a browser
// extension on the user's behalf the way we can launch VS Code via the
// `code` CLI. Manual-config flow (point the user at the extension
// install instructions, then `@config agent refresh browser`).
//
// First-time vs returning user: we persist a "browser-seen.json" stamp
// in instanceStorage on every successful client connect. When a probe
// finds no current connection, we use the presence of that file to
// pick between two messages — "you need to install the extension
// first" (first-time, no stamp) and "open your browser" (returning
// user, transient runtime state). This is browser-agnostic; the
// alternative of probing Chrome/Edge profile dirs would only cover
// some browsers and would break across browser version updates.

import type { ReadinessReport, Storage } from "@typeagent/agent-sdk";
import type {
    AgentWebSocketServer,
    BrowserClient,
} from "./agentWebSocketServer.mjs";

export type BrowserReadinessProbe = {
    // True when the host (typically the Electron shell) has injected an
    // in-process BrowserControl via initializeAgentContext settings. In
    // that mode the agent doesn't need any external browser/extension
    // to operate — `ready` regardless of WebSocket state.
    hasInProcessControl: boolean;
    // True when at least one WebSocket client (extension or electron)
    // is currently connected for our session. The session must be
    // registered with the server first (happens in updateAgentContext);
    // a probe before that returns false even if clients are queued.
    hasConnectedClient: boolean;
    // True iff browser-seen.json exists in instanceStorage — i.e. an
    // extension client has connected at least once on this machine.
    // Splits the no-current-connection state into "first-time user
    // needs to install" (false) vs "returning user with browser
    // closed" (true). The persistence is auto-bootstrapping: first
    // ever connect writes the stamp and subsequent runs benefit.
    seenClientBefore: boolean;
};

// Pure decision function — exported for unit tests so we don't have to
// stand up a real WebSocketServer + extension to exercise the contract.
//
// Three outcomes (the last two are both setup-required, distinguished
// by message):
//   - either connection path active → ready.
//   - no connection, never seen one → setup-required, framed as
//     "extension not installed yet" with install instructions.
//   - no connection, seen one before → setup-required, framed as
//     "your browser isn't running" — transient, identical UX concern
//     to the code agent's CLI-on-PATH branch.
export function evaluateBrowserReadiness(
    probe: BrowserReadinessProbe,
): ReadinessReport {
    if (probe.hasInProcessControl || probe.hasConnectedClient) {
        return { state: "ready" };
    }
    if (!probe.seenClientBefore) {
        return {
            state: "setup-required",
            message:
                "The TypeAgent browser extension hasn't connected yet on this machine.",
            details: [
                "If you haven't installed the extension yet, see the browser agent's README for installation instructions:",
                "  packages/agents/browser/README.md",
                "",
                "Once installed, open Chrome, Edge, or Firefox with the extension active. It will auto-connect on browser start — no agent restart needed, this state clears automatically.",
            ].join("\n"),
        };
    }
    // Seen before but not connected now — transient runtime state, NOT
    // a config problem. Don't repeat install instructions.
    return {
        state: "setup-required",
        message:
            "Your browser isn't currently connected to the TypeAgent browser agent.",
        details:
            "Open Chrome, Edge, or Firefox with the TypeAgent extension active. It will auto-connect on browser start — no agent restart needed.",
    };
}

// Cheap probe — walks the server's connected-client list looking for
// any client matching our session. Avoids depending on session
// registration order: if the session was registered, getActiveClient
// would also work, but during the dispatcher's initial readiness probe
// the session isn't yet registered (updateAgentContext hasn't run), so
// a list-and-filter is more robust.
export function hasClientForSession(
    server: AgentWebSocketServer | undefined,
    sessionId: string,
): boolean {
    if (!server) return false;
    return server
        .listClients()
        .some((c: BrowserClient) => c.sessionId === sessionId);
}

// ============================================================================
// Persistence: browser-seen.json
// ============================================================================

// File name in instanceStorage. Storage paths are relative to the
// agent's instance dir (preserved across sessions).
export const SEEN_FILE = "browser-seen.json";

export type BrowserSeenRecord = {
    // ISO 8601 timestamps. firstSeen is set on the first ever connect
    // and never updated; lastSeen tracks the most recent connect.
    firstSeen: string;
    lastSeen: string;
};

// Reads the seen record from instanceStorage. Returns undefined when
// storage isn't available, the file doesn't exist, or the contents
// don't parse — all of which mean "we've never recorded a connection".
export async function loadSeenRecord(
    storage: Storage | undefined,
): Promise<BrowserSeenRecord | undefined> {
    if (!storage) return undefined;
    try {
        if (typeof storage.exists === "function") {
            const exists = await storage.exists(SEEN_FILE);
            if (!exists) return undefined;
        }
        const content = (await storage.read(SEEN_FILE, "utf8")) as string;
        const parsed = JSON.parse(content);
        if (
            typeof parsed?.firstSeen === "string" &&
            typeof parsed?.lastSeen === "string"
        ) {
            return parsed as BrowserSeenRecord;
        }
        return undefined;
    } catch {
        // Read / parse error — treat as "no record". Never throw out of
        // a readiness probe; readiness must stay cheap and reliable.
        return undefined;
    }
}

// Records that a client has connected. Updates lastSeen on every call
// and preserves firstSeen on subsequent writes. Best-effort: a failed
// write is logged silently — the next connect will retry.
export async function recordClientSeen(
    storage: Storage | undefined,
): Promise<void> {
    if (!storage) return;
    const now = new Date().toISOString();
    const existing = await loadSeenRecord(storage);
    const record: BrowserSeenRecord = existing
        ? { ...existing, lastSeen: now }
        : { firstSeen: now, lastSeen: now };
    try {
        await storage.write(SEEN_FILE, JSON.stringify(record, null, 2));
    } catch {
        // Non-fatal — readiness will just default to "not seen" on the
        // next probe and we'll try again on the next connection.
    }
}
