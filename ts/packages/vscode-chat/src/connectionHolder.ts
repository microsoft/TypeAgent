// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import {
    connectAgentServer,
    type AgentServerConnection,
} from "@typeagent/agent-server-client";

/**
 * Lazily establishes and maintains the agent-server connection so the
 * extension can register its chat surfaces even while the server is down, and
 * so prompts submitted while disconnected wait for a live connection instead
 * of failing. Mirrors the Electron / vscode-shell behavior of accepting input
 * before the dispatcher is ready and running it once a session exists.
 *
 * `ensureConnected()` performs the first connect or, if a prior connection
 * dropped, reopens the transport in place via
 * {@link AgentServerConnection.reconnect}. Concurrent callers coalesce onto a
 * single in-flight attempt. On a successful reconnect (not the first connect),
 * `onReconnect` fires so cached per-conversation joins can be rebuilt — the
 * reconnect drops the server-side per-conversation channels, so callers must
 * re-join.
 */
export class ConnectionHolder {
    private conn: AgentServerConnection | undefined;
    private connected = false;
    private inFlight: Promise<AgentServerConnection> | undefined;
    private onReconnect: (() => void) | undefined;
    private closed = false;

    constructor(
        private readonly url: string,
        private readonly onDisconnect?: () => void,
    ) {}

    /**
     * Register a callback fired after each successful reconnect (never on the
     * first connect, where there is no stale join state to rebuild).
     */
    setOnReconnect(cb: () => void): void {
        this.onReconnect = cb;
    }

    isConnected(): boolean {
        return this.connected;
    }

    /**
     * The live connection if currently connected, else undefined. Used by
     * teardown paths (leave / dispose) that must be no-ops while disconnected.
     */
    currentIfConnected(): AgentServerConnection | undefined {
        return this.connected ? this.conn : undefined;
    }

    /**
     * Resolve to a live connection, performing a single connect-or-reconnect
     * attempt if needed. Concurrent callers share the in-flight attempt.
     * Rejects with a {@link vscode.CancellationError} if `token` fires before
     * the attempt settles; the shared attempt is left running for peers.
     * Callers that want to keep waiting across failed attempts (e.g. a queued
     * prompt) should retry with backoff.
     */
    async ensureConnected(
        token?: vscode.CancellationToken,
    ): Promise<AgentServerConnection> {
        if (this.closed) {
            throw new Error("Connection holder is closed");
        }
        if (this.conn && this.connected) {
            return this.conn;
        }
        if (!this.inFlight) {
            this.inFlight = this.connectOnce().finally(() => {
                this.inFlight = undefined;
            });
        }
        return this.raceCancellation(this.inFlight, token);
    }

    private async connectOnce(): Promise<AgentServerConnection> {
        if (!this.conn) {
            // First connection. connectAgentServer throws if the server is
            // unreachable; the caller retries.
            const conn = await connectAgentServer(this.url, () =>
                this.handleDisconnect(),
            );
            this.conn = conn;
            this.connected = true;
            return conn;
        }
        // A prior connection dropped — reopen the transport in place. The
        // same onDisconnect callback stays wired across reconnects.
        const ok = await this.conn.reconnect();
        if (!ok) {
            throw new Error(
                `Failed to reconnect to agent server at ${this.url}`,
            );
        }
        this.connected = true;
        this.onReconnect?.();
        return this.conn;
    }

    private handleDisconnect(): void {
        this.connected = false;
        this.onDisconnect?.();
    }

    /**
     * Resolve with `p`, or reject early if `token` fires. Does not cancel `p`
     * itself, so a coalesced peer caller can still receive the connection.
     */
    private raceCancellation(
        p: Promise<AgentServerConnection>,
        token?: vscode.CancellationToken,
    ): Promise<AgentServerConnection> {
        if (!token) {
            return p;
        }
        if (token.isCancellationRequested) {
            return Promise.reject(new vscode.CancellationError());
        }
        return new Promise<AgentServerConnection>((resolve, reject) => {
            const sub = token.onCancellationRequested(() => {
                sub.dispose();
                reject(new vscode.CancellationError());
            });
            p.then(
                (c) => {
                    sub.dispose();
                    resolve(c);
                },
                (e) => {
                    sub.dispose();
                    reject(e);
                },
            );
        });
    }

    async close(): Promise<void> {
        this.closed = true;
        this.connected = false;
        const conn = this.conn;
        this.conn = undefined;
        if (conn) {
            await conn.close();
        }
    }
}
