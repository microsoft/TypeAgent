// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Discovery file: how clients on the same machine find a running
// agent-server without a well-known port.
//
// The agent-server picks an ephemeral port at startup and writes its
// {port, pid, startedAt} to ~/.typeagent/agent-server.json. Clients
// read the file, validate the pid is alive, and connect to the port.
// On graceful shutdown the AS removes the file. A stale file (process
// dead, or port not answering) is treated as "no server" and the
// caller spawns a fresh one.
//
// There is at most one agent-server per machine — the AS uses
// `lockInstanceDir` for an exclusive OS-level lock on its instance
// directory, so concurrent spawn attempts collide with
// `ERR_INSTANCE_LOCKED` instead of producing two ASs racing on the
// discovery file.

import fs from "fs";
import os from "os";
import path from "path";

export interface DiscoveryRecord {
    port: number;
    pid: number;
    startedAt: string;
}

export const DISCOVERY_FILE_NAME = "agent-server.json";

export function getDiscoveryFilePath(): string {
    return path.join(os.homedir(), ".typeagent", DISCOVERY_FILE_NAME);
}

export function writeDiscoveryFile(port: number, pid: number): void {
    const file = getDiscoveryFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const record: DiscoveryRecord = {
        port,
        pid,
        startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
}

export function readDiscoveryFile(): DiscoveryRecord | undefined {
    try {
        const text = fs.readFileSync(getDiscoveryFilePath(), "utf-8");
        const parsed = JSON.parse(text);
        if (
            typeof parsed?.port !== "number" ||
            typeof parsed?.pid !== "number"
        ) {
            return undefined;
        }
        return parsed as DiscoveryRecord;
    } catch {
        return undefined;
    }
}

export function removeDiscoveryFile(): void {
    try {
        fs.unlinkSync(getDiscoveryFilePath());
    } catch {
        // already gone
    }
}

export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err: any) {
        // EPERM means the process exists but we can't signal it; treat
        // as alive (Windows-friendly).
        return err?.code === "EPERM";
    }
}
