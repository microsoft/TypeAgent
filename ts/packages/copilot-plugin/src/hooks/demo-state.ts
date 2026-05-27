// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Writes a small JSON state file that an external demo driver (e.g. the
 * AutoHotkey driver under packages/copilot-plugin/demo/driver/) polls to
 * detect when a Copilot CLI turn has completed.
 *
 * The file is written atomically (write to .tmp, then rename) so a reader
 * never sees a partial write.
 *
 * Location: %TEMP%/copilot-demo-state.json (Windows), $TMPDIR or /tmp on Unix.
 * Override with the TYPEAGENT_DEMO_STATE_PATH environment variable.
 */

import { renameSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function getStatePath(): string {
    return process.env.TYPEAGENT_DEMO_STATE_PATH
        ?? join(tmpdir(), "copilot-demo-state.json");
}

export type TurnMode = "direct" | "mcp" | "llm";
export type HandledBy = "typeagent" | "copilot";

export interface DemoStatePayload {
    event: "turnComplete";
    /** Unique per turn so the reader can tell new from already-seen. */
    turnId: string;
    /** Milliseconds since epoch. */
    ts: number;
    mode: TurnMode;
    handledBy: HandledBy;
    /**
     * The assistant's response text for this turn, if the hook has access to
     * it. Empty string when the hook ran in a path that doesn't know the
     * response (e.g. agentStop without a parsed transcript).
     */
    lastResponse: string;
    /** Original session id, useful for debugging. */
    sessionId?: string;
}

/**
 * Build a turn id from session + timestamp. We append the timestamp because
 * a single session can have many turns and the session id alone is not
 * unique-per-turn.
 */
export function makeTurnId(sessionId: string | undefined): string {
    return `${sessionId ?? "unknown"}-${Date.now()}`;
}

/**
 * Write the demo state file atomically. Never throws — demo plumbing must
 * not interfere with the real hook's exit code.
 */
export function writeDemoState(payload: DemoStatePayload): void {
    const path = getStatePath();
    const tmp = path + ".tmp";
    try {
        writeFileSync(tmp, JSON.stringify(payload), { encoding: "utf-8" });
        renameSync(tmp, path);
    } catch (err) {
        // Log to stderr (visible to the hook host but not the user).
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[demo-state] write failed: ${msg}\n`);
    }
}
