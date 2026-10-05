// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
    SessionEvent,
    SessionKey,
    SessionStore,
} from "./gitCommitStory.js";

const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 500;

function safeName(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
}

function sleep(milliseconds: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// Stores private session events in the repository's Git directory.
export class JsonlSessionStore implements SessionStore {
    readonly root: string;
    private readonly sessionsDirectory: string;
    private readonly commitsDirectory: string;
    private readonly transcriptsFile: string;

    constructor(gitDirectory: string) {
        this.root = path.join(gitDirectory, "story");
        this.sessionsDirectory = path.join(this.root, "sessions");
        this.commitsDirectory = path.join(this.root, "commits");
        this.transcriptsFile = path.join(this.root, "transcripts.json");
        mkdirSync(this.sessionsDirectory, { recursive: true });
        mkdirSync(this.commitsDirectory, { recursive: true });
    }

    append(event: SessionEvent): void {
        const file = this.eventPath(event.session);
        this.locked(file, () => {
            const descriptor = openSync(file, "a", 0o600);
            try {
                writeFileSync(descriptor, `${JSON.stringify(event)}\n`);
            } finally {
                closeSync(descriptor);
            }
        });
    }

    sessions(): SessionKey[] {
        if (!existsSync(this.sessionsDirectory)) return [];
        return readdirSync(this.sessionsDirectory)
            .filter((name) => name.endsWith(".jsonl"))
            .map((name) =>
                Buffer.from(name.slice(0, -6), "base64url").toString("utf8"),
            )
            .filter((name): name is SessionKey =>
                /^(copilot-cli|vscode)\//.test(name),
            );
    }

    events(session: SessionKey, sinceCommit = false): SessionEvent[] {
        let events: SessionEvent[] = [];
        try {
            events = readFileSync(this.eventPath(session), "utf8")
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => JSON.parse(line) as SessionEvent);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (!sinceCommit) return events;
        const marker = this.marker(session);
        return marker ? events.slice(marker.count) : events;
    }

    transcriptPath(session: SessionKey): string | undefined {
        try {
            const values = JSON.parse(
                readFileSync(this.transcriptsFile, "utf8"),
            ) as Record<string, string>;
            return values[session];
        } catch {
            return undefined;
        }
    }

    setTranscriptPath(session: SessionKey, transcriptPath: string): void {
        this.locked(this.transcriptsFile, () => {
            let values: Record<string, string> = {};
            try {
                values = JSON.parse(
                    readFileSync(this.transcriptsFile, "utf8"),
                ) as Record<string, string>;
            } catch {
                // A new transcript map starts empty.
            }
            values[session] = transcriptPath;
            writeFileSync(this.transcriptsFile, `${JSON.stringify(values)}\n`, {
                mode: 0o600,
            });
        });
    }

    markCommitted(session: SessionKey, commit: string, count?: number): void {
        const file = this.markerPath(session);
        this.locked(file, () => {
            writeFileSync(
                file,
                `${JSON.stringify({ commit, count: count ?? this.events(session).length })}\n`,
                { mode: 0o600 },
            );
        });
    }

    writePending(sessions: SessionKey[]): void {
        const pending = sessions.map((session) => ({
            session,
            count: this.events(session).length,
        }));
        const file = path.join(this.root, "pending.json");
        this.locked(file, () => {
            writeFileSync(file, `${JSON.stringify(pending)}\n`, {
                mode: 0o600,
            });
        });
    }

    consumePending(): { session: SessionKey; count: number }[] {
        const file = path.join(this.root, "pending.json");
        try {
            return this.locked(file, () => {
                const pending = JSON.parse(readFileSync(file, "utf8")) as {
                    session: SessionKey;
                    count: number;
                }[];
                rmSync(file, { force: true });
                return pending;
            });
        } catch {
            return [];
        }
    }

    private eventPath(session: SessionKey): string {
        return path.join(this.sessionsDirectory, `${safeName(session)}.jsonl`);
    }

    private markerPath(session: SessionKey): string {
        return path.join(this.commitsDirectory, `${safeName(session)}.json`);
    }

    private marker(
        session: SessionKey,
    ): { commit: string; count: number } | undefined {
        try {
            return JSON.parse(
                readFileSync(this.markerPath(session), "utf8"),
            ) as {
                commit: string;
                count: number;
            };
        } catch {
            return undefined;
        }
    }

    private locked<T>(file: string, operation: () => T): T {
        const lock = `${file}.lock`;
        const deadline = Date.now() + LOCK_TIMEOUT_MS;
        let descriptor: number | undefined;
        while (descriptor === undefined) {
            try {
                descriptor = openSync(lock, "wx", 0o600);
            } catch (error) {
                if (
                    (error as NodeJS.ErrnoException).code !== "EEXIST" ||
                    Date.now() >= deadline
                ) {
                    throw error;
                }
                sleep(LOCK_RETRY_MS);
            }
        }
        try {
            return operation();
        } finally {
            closeSync(descriptor);
            rmSync(lock, { force: true });
        }
    }
}
