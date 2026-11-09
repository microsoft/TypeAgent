// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
    SessionReceiptSchema,
    SessionRegistrationSchema,
    type SessionReceipt,
} from "./daemonApi.js";
import { writePrivateJson } from "./daemonState.js";
import type { DaemonSessionDependencies } from "./daemonComposition.js";
import { daemonLogger } from "./logger.js";
import {
    SessionWatcher,
    type SessionRegistration,
    type SessionWatcherStatus,
    type SessionWatchRequest,
} from "./sessionWatcher.js";

const SavedReceiptSchema = z.object({
    receipt: SessionReceiptSchema,
    seedDigest: z.string().regex(/^[0-9a-f]{64}$/),
});
type Entry = z.infer<typeof SavedReceiptSchema> & {
    request?: SessionWatchRequest;
    admitted?: Promise<void>;
};

export class SessionApiError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 409 | 503,
    ) {
        super(message);
    }
}

function sessionKey(id: string): string {
    return process.platform === "win32" ? id.toLowerCase() : id;
}

// Resolve existing ancestors as well as files so a not-yet-created source has
// the same identity when registered through a directory symlink or junction.
function canonicalSource(file: string): string {
    const suffix: string[] = [];
    let existing = path.normalize(file);
    for (;;) {
        try {
            const resolved = fs.realpathSync.native(existing);
            if (suffix.length > 0 && !fs.statSync(resolved).isDirectory())
                throw Object.assign(
                    new Error("Source parent is not a directory"),
                    {
                        code: "ENOTDIR",
                    },
                );
            return path.join(resolved, ...suffix);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = path.dirname(existing);
            if (parent === existing) throw error;
            suffix.unshift(path.basename(existing));
            existing = parent;
        }
    }
}

export function toSessionWatchRequest(
    registration: SessionRegistration,
    home: string,
): SessionWatchRequest | undefined {
    const parsed = SessionRegistrationSchema.safeParse(registration);
    if (!parsed.success || parsed.data.metadata.clientName !== "copilot-cli")
        return undefined;
    return {
        ...parsed.data,
        transcriptPath:
            parsed.data.transcriptPath ??
            path.join(
                home,
                ".copilot",
                "session-state",
                parsed.data.sessionId,
                "events.jsonl",
            ),
    };
}

// One instance per daemon. No payloads or registration metadata are exposed in
// receipts; the seed digest detects conflicting registration after a restart.
export class DaemonSessions {
    readonly #watcher: SessionWatcher;
    readonly #entries = new Map<string, Entry>();
    readonly #receiptsDirectory: string;
    readonly configured: boolean;
    #stopping = false;
    #stopPromise?: Promise<void>;

    constructor(
        readonly options: {
            stateDirectory: string;
            copilotHome: string;
            dependencies?: DaemonSessionDependencies;
            maxRecords?: number;
            reconcileIntervalMs?: number;
        },
    ) {
        this.#receiptsDirectory = path.join(options.stateDirectory, "sessions");
        this.configured = options.dependencies !== undefined;
        this.#watcher = new SessionWatcher({
            ...(options.dependencies
                ? {
                      privacyFilter: options.dependencies.privacyFilter,
                      approvedUpdateDestination:
                          options.dependencies.approvedUpdateDestination,
                  }
                : {}),
            capture: {
                stateDirectory: path.join(options.stateDirectory, "capture"),
                maxRecords: options.maxRecords ?? 1000,
            },
            ...(options.reconcileIntervalMs !== undefined
                ? { reconcileIntervalMs: options.reconcileIntervalMs }
                : {}),
            onStatus: (identity, status) =>
                this.#report(identity.sessionId, status),
        });
        this.#load();
    }

    get stopping(): boolean {
        return this.#stopping;
    }

    #file(id: string): string {
        return path.join(
            this.#receiptsDirectory,
            createHash("sha256").update(id).digest("hex") + ".json",
        );
    }

    #save(entry: Entry): void {
        writePrivateJson(this.#file(entry.receipt.sessionId), {
            receipt: entry.receipt,
            seedDigest: entry.seedDigest,
        });
    }

    #load(): void {
        fs.mkdirSync(this.#receiptsDirectory, { recursive: true, mode: 0o700 });
        try {
            for (const file of fs.readdirSync(this.#receiptsDirectory)) {
                if (!/^[0-9a-f]{64}\.json$/.test(file)) continue;
                if (this.#entries.size >= 1024) throw new Error();
                const entry = SavedReceiptSchema.parse(
                    JSON.parse(
                        fs.readFileSync(
                            path.join(this.#receiptsDirectory, file),
                            "utf8",
                        ),
                    ),
                );
                const receipt = entry.receipt;
                if (
                    receipt.state === "blocked" ||
                    receipt.status?.phase === "processing" ||
                    receipt.status?.failure
                ) {
                    receipt.recoveryRequired = true;
                }
                receipt.state = receipt.recoveryRequired
                    ? "blocked"
                    : "stopped";
                if (receipt.status) receipt.status.monitoring = false;
                if (this.#entries.has(sessionKey(receipt.sessionId)))
                    throw new Error();
                this.#entries.set(sessionKey(receipt.sessionId), entry);
            }
        } catch {
            throw new Error("Cannot load Session Watcher receipts");
        }
    }

    #report(id: string, status: SessionWatcherStatus): void {
        const entry = this.#entries.get(sessionKey(id));
        if (!entry) throw new Error("Session receipt is unavailable");
        entry.receipt.status = structuredClone(status);
        if (status.failure) {
            entry.receipt.recoveryRequired = true;
            entry.receipt.state = "blocked";
        } else if (!entry.receipt.recoveryRequired) {
            entry.receipt.state =
                status.phase === "stopped"
                    ? "stopped"
                    : status.phase === "idle" || status.phase === "waiting"
                      ? "active"
                      : "starting";
        }
        this.#save(entry);
    }

    list(): SessionReceipt[] {
        return [...this.#entries.values()].map((entry) => {
            const receipt = structuredClone(entry.receipt);
            const status =
                entry.request && this.#watcher.getStatus(entry.request);
            // Reporting itself can fail. The watcher's retained status is then
            // authoritative even when disk could not be updated.
            if (status) receipt.status = status;
            if (status?.failure) {
                receipt.state = "blocked";
                receipt.recoveryRequired = true;
            }
            return receipt;
        });
    }

    #checkAdmission(): void {
        if (this.#stopping)
            throw new SessionApiError("Daemon is stopping", 503);
        if (!this.configured)
            throw new SessionApiError(
                "Session Watcher dependencies are not configured",
                503,
            );
    }

    register(registration: SessionRegistration): SessionReceipt {
        this.#checkAdmission();
        if (registration.metadata.clientName === "vscode-copilot")
            throw new SessionApiError(
                "Native VS Code transcript format is not supported",
                503,
            );
        const request = toSessionWatchRequest(
            registration,
            this.options.copilotHome,
        );
        if (!request)
            throw new SessionApiError("Invalid or unknown session client", 400);
        try {
            request.projectPath = fs.realpathSync.native(request.projectPath);
            if (!fs.statSync(request.projectPath).isDirectory())
                throw new Error();
            request.transcriptPath = canonicalSource(request.transcriptPath);
        } catch {
            throw new SessionApiError(
                "Project must be an existing absolute directory and source must be accessible",
                400,
            );
        }
        for (const registered of this.#entries.values()) {
            const receipt = registered.receipt;
            if (
                sessionKey(receipt.transcriptPath) ===
                    sessionKey(request.transcriptPath) &&
                receipt.sessionId !== request.sessionId
            )
                throw new SessionApiError(
                    "Session registration conflicts: transcript source already belongs to another session",
                    409,
                );
        }
        const seedDigest = createHash("sha256")
            .update(JSON.stringify(request.metadata))
            .digest("hex");
        let entry = this.#entries.get(sessionKey(request.sessionId));
        if (entry) {
            if (
                entry.receipt.sessionId !== request.sessionId ||
                entry.receipt.projectPath !== request.projectPath ||
                sessionKey(entry.receipt.transcriptPath) !==
                    sessionKey(request.transcriptPath) ||
                entry.seedDigest !== seedDigest
            )
                throw new SessionApiError(
                    "Session registration conflicts",
                    409,
                );
            // Checkpoints, capture keys and generated IDs use the original
            // spelling, even after Windows realpath restores on-disk casing.
            request.transcriptPath = entry.receipt.transcriptPath;
        } else {
            if (this.#entries.size >= 1024)
                throw new SessionApiError(
                    "Session registration limit reached",
                    503,
                );
            entry = {
                seedDigest,
                receipt: {
                    sessionId: request.sessionId,
                    projectPath: request.projectPath,
                    transcriptPath: request.transcriptPath,
                    state: "starting",
                    recoveryRequired: false,
                },
            };
            this.#entries.set(sessionKey(request.sessionId), entry);
        }
        entry.request = request;
        if (!entry.admitted && !entry.receipt.recoveryRequired) {
            entry.receipt.state = "starting";
            this.#save(entry);
            this.#admit(entry, () => this.#watcher.watch(request));
        }
        return structuredClone(entry.receipt);
    }

    #admit(entry: Entry, operation: () => Promise<void>): void {
        entry.admitted = operation().catch(() => {
            entry.receipt.state = "blocked";
            entry.receipt.recoveryRequired = true;
            const status = this.#watcher.getStatus(entry.request!);
            if (status) entry.receipt.status = status;
            try {
                this.#save(entry);
            } catch {
                daemonLogger.error("Session receipt persistence failed");
            }
            daemonLogger.error(
                "Session processing failed; inspect authenticated status",
            );
        });
    }

    stop(): Promise<void> {
        if (this.#stopPromise) return this.#stopPromise;
        this.#stopping = true;
        this.#stopPromise = (async () => {
            await this.#watcher.stop();
            await Promise.all(
                [...this.#entries.values()].map((entry) => entry.admitted),
            );
        })();
        return this.#stopPromise;
    }
}
