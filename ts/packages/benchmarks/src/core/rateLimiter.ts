// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";

const WINDOW_MS = 60_000;
const MAX_SLEEP_MS = 1_000;
const STALE_MS = 180_000;
const BUSY_TIMEOUT_MS = 15_000;
const SQLITE_BUSY = 5;
const OPEN_MAX_ATTEMPTS = 50;
const OPEN_RETRY_MIN_MS = 20;
const OPEN_RETRY_JITTER_MS = 30;

export interface RateLimiterOptions {
    dbPath: string;
    estTokensPerCall?: number;
    maxWaitMs?: number;
    onWait?: (model: string, waitedMs: number, waitMs: number) => void;
}

export interface RateLimiter {
    disabledFor(model: string): boolean;
    run<T>(
        model: string,
        est: number | undefined,
        fn: () => Promise<{ result: T; actualTokens: number | undefined }>,
    ): Promise<T>;
    close(): void;
}

export type TpmLimits = Readonly<Record<string, number>>;

interface Reservation {
    id: string | undefined;
    waitMs: number;
}

interface ClaimRow {
    created_at: number;
    tokens: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusyError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { errcode?: number }).errcode === SQLITE_BUSY
    );
}

function openDatabase(dbPath: string): DatabaseSync {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    let lastError: unknown;
    for (let attempt = 0; attempt < OPEN_MAX_ATTEMPTS; attempt++) {
        let db: DatabaseSync | undefined;
        try {
            db = new DatabaseSync(dbPath);
            db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
            db.exec("PRAGMA journal_mode = WAL");
            db.exec("PRAGMA synchronous = NORMAL");
            db.exec(
                "CREATE TABLE IF NOT EXISTS claims (" +
                    "id TEXT PRIMARY KEY, " +
                    "model TEXT NOT NULL, " +
                    "tokens REAL NOT NULL, " +
                    "created_at INTEGER NOT NULL, " +
                    "pending INTEGER NOT NULL)",
            );
            db.exec(
                "CREATE INDEX IF NOT EXISTS idx_claims_model_time " +
                    "ON claims (model, created_at)",
            );
            return db;
        } catch (error) {
            lastError = error;
            if (db !== undefined) {
                try {
                    db.close();
                } catch {
                    // no-op
                }
            }
            if (!isBusyError(error)) {
                throw error;
            }
            const until =
                Date.now() +
                OPEN_RETRY_MIN_MS +
                Math.floor(Math.random() * OPEN_RETRY_JITTER_MS);
            while (Date.now() < until) {
                // no-op
            }
        }
    }
    throw lastError;
}

class Ledger {
    private readonly insertStmt: StatementSync;
    private readonly settleStmt: StatementSync;
    private readonly insertSettledStmt: StatementSync;
    private readonly purgeExpiredStmt: StatementSync;
    private readonly purgeStaleStmt: StatementSync;
    private readonly usedStmt: StatementSync;
    private readonly oldestStmt: StatementSync;

    constructor(
        private readonly db: DatabaseSync,
        private readonly tpmLimits: TpmLimits,
    ) {
        this.insertStmt = db.prepare(
            "INSERT INTO claims (id, model, tokens, created_at, pending) " +
                "VALUES (?, ?, ?, ?, 1)",
        );
        this.settleStmt = db.prepare(
            "UPDATE claims SET tokens = ?, pending = 0 WHERE id = ?",
        );
        this.insertSettledStmt = db.prepare(
            "INSERT OR REPLACE INTO claims " +
                "(id, model, tokens, created_at, pending) VALUES (?, ?, ?, ?, 0)",
        );
        this.purgeExpiredStmt = db.prepare(
            "DELETE FROM claims WHERE pending = 0 AND created_at <= ?",
        );
        this.purgeStaleStmt = db.prepare(
            "DELETE FROM claims WHERE pending = 1 AND created_at <= ?",
        );
        this.usedStmt = db.prepare(
            "SELECT COALESCE(SUM(tokens), 0) AS used " +
                "FROM claims WHERE model = ? AND created_at > ?",
        );
        this.oldestStmt = db.prepare(
            "SELECT created_at, tokens FROM claims " +
                "WHERE model = ? AND created_at > ? ORDER BY created_at ASC",
        );
    }

    private transaction<T>(fn: () => T): T {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const out = fn();
            this.db.exec("COMMIT");
            return out;
        } catch (error) {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // no-op
            }
            throw error;
        }
    }

    private waitForCapacity(
        model: string,
        limit: number,
        need: number,
        now: number,
    ): number {
        const excess = need - limit;
        let freed = 0;
        const rows = this.oldestStmt.all(
            model,
            now - WINDOW_MS,
        ) as unknown as ClaimRow[];
        for (const row of rows) {
            freed += row.tokens;
            if (freed >= excess) {
                return Math.max(5, row.created_at + WINDOW_MS - now);
            }
        }
        return Math.max(5, WINDOW_MS);
    }

    reserve(model: string, cost: number): Reservation {
        const limit = this.tpmLimits[model];
        const need = Math.min(cost, limit);
        return this.transaction(() => {
            const now = Date.now();
            this.purgeExpiredStmt.run(now - WINDOW_MS);
            this.purgeStaleStmt.run(now - STALE_MS);
            const { used } = this.usedStmt.get(model, now - WINDOW_MS) as {
                used: number;
            };
            if (used + need <= limit) {
                const id = randomUUID();
                this.insertStmt.run(id, model, need, now);
                return { id, waitMs: 0 };
            }
            return {
                id: undefined,
                waitMs: this.waitForCapacity(model, limit, used + need, now),
            };
        });
    }

    settle(id: string, model: string, actualCost: number): void {
        this.transaction(() => {
            const result = this.settleStmt.run(actualCost, id);
            if (result.changes === 0) {
                this.insertSettledStmt.run(id, model, actualCost, Date.now());
            }
        });
    }
}

export function createRateLimiter(
    limits: TpmLimits,
    options: RateLimiterOptions,
): RateLimiter {
    const tpmLimits: Record<string, number> = {};
    for (const [model, tpm] of Object.entries(limits)) {
        if (Number.isFinite(tpm) && tpm > 0) {
            tpmLimits[model] = tpm;
        }
    }

    let db: DatabaseSync | undefined;
    let ledger: Ledger | undefined;
    if (Object.keys(tpmLimits).length > 0) {
        db = openDatabase(options.dbPath);
        ledger = new Ledger(db, tpmLimits);
    }

    async function admit(model: string, estCost: number): Promise<string> {
        const activeLedger = ledger as Ledger;
        const startedAt = Date.now();
        for (;;) {
            const reservation = activeLedger.reserve(model, estCost);
            if (reservation.id !== undefined) {
                return reservation.id;
            }
            const waited = Date.now() - startedAt;
            if (
                options.maxWaitMs !== undefined &&
                waited >= options.maxWaitMs
            ) {
                throw new Error(
                    `rate limiter: exceeded max wait ${options.maxWaitMs}ms for ${model}`,
                );
            }
            options.onWait?.(model, waited, reservation.waitMs);
            await sleep(Math.min(reservation.waitMs, MAX_SLEEP_MS));
        }
    }

    async function run<T>(
        model: string,
        est: number | undefined,
        fn: () => Promise<{ result: T; actualTokens: number | undefined }>,
    ): Promise<T> {
        if (ledger === undefined || tpmLimits[model] === undefined) {
            return (await fn()).result;
        }

        const estCost =
            est !== undefined && Number.isFinite(est) && est > 0
                ? est
                : options.estTokensPerCall;
        if (estCost === undefined || !(estCost > 0)) {
            throw new Error(
                `rate limiter: no positive token estimate for ${model}`,
            );
        }

        const id = await admit(model, estCost);
        let actual = estCost;
        try {
            const out = await fn();
            actual =
                out.actualTokens !== undefined &&
                Number.isFinite(out.actualTokens) &&
                out.actualTokens > 0
                    ? out.actualTokens
                    : estCost;
            return out.result;
        } finally {
            try {
                (ledger as Ledger).settle(id, model, actual);
            } catch {
                // no-op
            }
        }
    }

    return {
        disabledFor(model: string): boolean {
            return tpmLimits[model] === undefined;
        },
        close(): void {
            if (db !== undefined) {
                db.close();
                db = undefined;
                ledger = undefined;
            }
        },
        run,
    };
}
