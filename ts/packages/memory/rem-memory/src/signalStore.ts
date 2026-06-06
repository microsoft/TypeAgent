// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import sqlite from "better-sqlite3";
import { RelationSignal } from "./model.js";

// SQLite-backed decay signal store. One row per relation id. The RDF store is
// authoritative for relation *existence*; this store holds the fast-changing
// *signal*. Current weight is computed lazily on read:
//
//     w(t) = weight0 * exp(-lambda * (t - last_seen_seconds))
//
// Reinforcement folds new evidence into the (decayed) weight:
//
//     w' = decay(w) + alpha * pos_evidence - beta * neg_evidence
//
// so frequently-reinforced relations stay strong while stale ones fade.

/** Tunable decay/reinforcement parameters for a relation signal. */
export type SignalParams = {
    /** Decay rate per second (larger = forgets faster). */
    lambda: number;
    /** Positive-evidence reinforcement gain. */
    alpha: number;
    /** Negative-evidence (contradiction) penalty gain. */
    beta: number;
};

export const defaultSignalParams: SignalParams = {
    // Half-life of ~30 days: lambda = ln(2) / (30 * 86400).
    lambda: Math.LN2 / (30 * 86400),
    alpha: 1,
    beta: 1,
};

type SignalRow = {
    relation_id: string;
    weight0: number;
    last_seen: number; // epoch ms
    lambda: number;
    alpha: number;
    beta: number;
    pos_evidence: number;
    neg_evidence: number;
    access_count: number;
};

/** Decay a stored base weight forward to time `now` (epoch ms). */
function decayWeight(
    weight0: number,
    lastSeen: number,
    lambda: number,
    now: number,
): number {
    const dtSeconds = Math.max(0, (now - lastSeen) / 1000);
    return weight0 * Math.exp(-lambda * dtSeconds);
}

export class SignalStore {
    private readonly db: sqlite.Database;
    private readonly getStmt: sqlite.Statement;
    private readonly upsertStmt: sqlite.Statement;
    private readonly touchStmt: sqlite.Statement;

    constructor(dbPath: string = ":memory:") {
        this.db = new sqlite(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS relation_signal (
                relation_id  TEXT PRIMARY KEY,
                weight0      REAL NOT NULL,
                last_seen    INTEGER NOT NULL,
                lambda       REAL NOT NULL,
                alpha        REAL NOT NULL,
                beta         REAL NOT NULL,
                pos_evidence REAL NOT NULL DEFAULT 0,
                neg_evidence REAL NOT NULL DEFAULT 0,
                access_count INTEGER NOT NULL DEFAULT 0
            );
        `);

        this.getStmt = this.db.prepare(
            `SELECT * FROM relation_signal WHERE relation_id = ?`,
        );
        this.upsertStmt = this.db.prepare(`
            INSERT INTO relation_signal
                (relation_id, weight0, last_seen, lambda, alpha, beta, pos_evidence, neg_evidence, access_count)
            VALUES
                (@relation_id, @weight0, @last_seen, @lambda, @alpha, @beta, @pos_evidence, @neg_evidence, @access_count)
            ON CONFLICT(relation_id) DO UPDATE SET
                weight0      = excluded.weight0,
                last_seen    = excluded.last_seen,
                lambda       = excluded.lambda,
                alpha        = excluded.alpha,
                beta         = excluded.beta,
                pos_evidence = excluded.pos_evidence,
                neg_evidence = excluded.neg_evidence,
                access_count = excluded.access_count
        `);
        this.touchStmt = this.db.prepare(`
            UPDATE relation_signal
            SET access_count = access_count + 1
            WHERE relation_id = ?
        `);
    }

    /**
     * Ensure a signal row exists for a relation, seeding it with an initial
     * weight if absent. Idempotent.
     */
    ensure(
        relationId: string,
        now: number,
        initialWeight = 1,
        params: SignalParams = defaultSignalParams,
    ): void {
        const existing = this.getStmt.get(relationId) as SignalRow | undefined;
        if (existing !== undefined) {
            return;
        }
        this.upsertStmt.run({
            relation_id: relationId,
            weight0: initialWeight,
            last_seen: now,
            lambda: params.lambda,
            alpha: params.alpha,
            beta: params.beta,
            pos_evidence: 0,
            neg_evidence: 0,
            access_count: 0,
        });
    }

    /**
     * Fold new evidence into a relation's weight, decaying first so old strength
     * fades before the new evidence is applied. Creates the row if missing.
     */
    reinforce(
        relationId: string,
        now: number,
        posEvidence = 1,
        negEvidence = 0,
        params: SignalParams = defaultSignalParams,
    ): number {
        const row = this.getStmt.get(relationId) as SignalRow | undefined;
        const base = row
            ? {
                  weight0: row.weight0,
                  last_seen: row.last_seen,
                  lambda: row.lambda,
                  alpha: row.alpha,
                  beta: row.beta,
                  pos_evidence: row.pos_evidence,
                  neg_evidence: row.neg_evidence,
                  access_count: row.access_count,
              }
            : {
                  weight0: 0,
                  last_seen: now,
                  lambda: params.lambda,
                  alpha: params.alpha,
                  beta: params.beta,
                  pos_evidence: 0,
                  neg_evidence: 0,
                  access_count: 0,
              };

        const decayed = decayWeight(
            base.weight0,
            base.last_seen,
            base.lambda,
            now,
        );
        const updated =
            decayed + base.alpha * posEvidence - base.beta * negEvidence;
        const newWeight = Math.max(0, updated);

        this.upsertStmt.run({
            relation_id: relationId,
            weight0: newWeight,
            last_seen: now,
            lambda: base.lambda,
            alpha: base.alpha,
            beta: base.beta,
            pos_evidence: base.pos_evidence + posEvidence,
            neg_evidence: base.neg_evidence + negEvidence,
            access_count: base.access_count,
        });
        return newWeight;
    }

    /** Read the current decayed weight for a relation at time `now`. */
    getWeight(relationId: string, now: number): RelationSignal | undefined {
        const row = this.getStmt.get(relationId) as SignalRow | undefined;
        if (row === undefined) {
            return undefined;
        }
        return {
            relationId,
            weight: decayWeight(row.weight0, row.last_seen, row.lambda, now),
            lastSeen: row.last_seen,
        };
    }

    /** Record that a relation was accessed (recalled) without reinforcing it. */
    touch(relationId: string): void {
        this.touchStmt.run(relationId);
    }

    close(): void {
        this.db.close();
    }
}
