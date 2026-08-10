// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const BASE_DIR = path.join(
    os.homedir(),
    ".typeagent",
    "benchmark",
    "rate-limitters",
);
const DB_PATH = path.join(BASE_DIR, "tpm.sqlite");
const BUSY_TIMEOUT_MS = 15_000;
const WINDOW_MS = 60_000;
const STALE_MS = 180_000;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function openDb() {
    fs.mkdirSync(BASE_DIR, { recursive: true });
    let lastErr;
    for (let attempt = 0; attempt < 50; attempt++) {
        let db;
        try {
            db = new DatabaseSync(DB_PATH);
            db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
            db.exec("PRAGMA journal_mode = WAL");
            db.exec("PRAGMA synchronous = NORMAL");
            db.exec(
                "CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, model TEXT NOT NULL, tokens REAL NOT NULL, created_at INTEGER NOT NULL, pending INTEGER NOT NULL)",
            );
            db.exec(
                "CREATE INDEX IF NOT EXISTS idx_claims_model_time ON claims (model, created_at)",
            );
            return db;
        } catch (e) {
            lastErr = e;
            if (db) {
                try {
                    db.close();
                } catch {}
            }
            if (e.errcode !== 5 && e.code !== "ERR_SQLITE_ERROR") throw e;
            const until = Date.now() + 20 + Math.floor(Math.random() * 30);
            while (Date.now() < until) {}
        }
    }
    throw lastErr;
}

function makeLedger(db, tpmLimits) {
    const insertStmt = db.prepare(
        "INSERT INTO claims (id, model, tokens, created_at, pending) VALUES (?, ?, ?, ?, 1)",
    );
    const settleStmt = db.prepare(
        "UPDATE claims SET tokens = ?, pending = 0 WHERE id = ?",
    );
    const purgeExpiredStmt = db.prepare(
        "DELETE FROM claims WHERE created_at <= ?",
    );
    const purgeStaleStmt = db.prepare(
        "DELETE FROM claims WHERE pending = 1 AND created_at <= ?",
    );
    const usedStmt = db.prepare(
        "SELECT COALESCE(SUM(tokens), 0) AS used FROM claims WHERE model = ? AND created_at > ?",
    );
    const oldestStmt = db.prepare(
        "SELECT created_at, tokens FROM claims WHERE model = ? AND created_at > ? ORDER BY created_at ASC",
    );

    function tx(fn) {
        db.exec("BEGIN IMMEDIATE");
        try {
            const out = fn();
            db.exec("COMMIT");
            return out;
        } catch (e) {
            try {
                db.exec("ROLLBACK");
            } catch {}
            throw e;
        }
    }

    function waitForCapacity(model, limit, need, now) {
        const excess = need - limit;
        let freed = 0;
        for (const row of oldestStmt.all(model, now - WINDOW_MS)) {
            freed += row.tokens;
            if (freed >= excess) {
                return Math.max(5, row.created_at + WINDOW_MS - now);
            }
        }
        return Math.max(5, WINDOW_MS);
    }

    return {
        reserve(model, cost) {
            const limit = tpmLimits[model];
            const need = Math.min(cost, limit);
            return tx(() => {
                const now = Date.now();
                purgeExpiredStmt.run(now - WINDOW_MS);
                purgeStaleStmt.run(now - STALE_MS);
                const { used } = usedStmt.get(model, now - WINDOW_MS);
                if (used + need <= limit) {
                    const id = randomUUID();
                    insertStmt.run(id, model, need, now);
                    return { id, waitMs: 0 };
                }
                return {
                    id: null,
                    waitMs: waitForCapacity(model, limit, used + need, now),
                };
            });
        },
        settle(id, actualCost) {
            tx(() => {
                settleStmt.run(actualCost, id);
            });
        },
    };
}

/**
 * @param {{ tpmLimits: Record<string, number> }} cfg
 * @param {{ estTokensPerCall?: number }} [opts]
 * @returns {{ run<T>(model: string, est: number|undefined, fn: () => Promise<{ result: T, actualTokens: number }>): Promise<T>, disabledFor(model: string): boolean, close(): void }}
 */
export function createTpmLimiter(cfg, opts = {}) {
    const estDefault = opts.estTokensPerCall ?? 10_400;
    const rawLimits = cfg.tpmLimits || {};
    const tpmLimits = {};
    for (const [model, tpm] of Object.entries(rawLimits)) {
        if (Number.isFinite(tpm) && tpm > 0) tpmLimits[model] = tpm;
    }

    let db;
    let ledger;
    if (Object.keys(tpmLimits).length > 0) {
        db = openDb();
        ledger = makeLedger(db, tpmLimits);
    }

    return {
        disabledFor(model) {
            return tpmLimits[model] === undefined;
        },
        close() {
            if (db) db.close();
        },
        async run(model, est, fn) {
            const estCost = Number.isFinite(est) && est > 0 ? est : estDefault;
            if (tpmLimits[model] === undefined) return (await fn()).result;
            let id;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const claim = ledger.reserve(model, estCost);
                if (claim.id) {
                    id = claim.id;
                    break;
                }
                await sleep(claim.waitMs);
            }
            let actual = estCost;
            try {
                const out = await fn();
                actual = Number.isFinite(out.actualTokens)
                    ? out.actualTokens
                    : estCost;
                return out.result;
            } finally {
                ledger.settle(id, actual);
            }
        },
    };
}
