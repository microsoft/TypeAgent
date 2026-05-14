// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Stack all winners from an optimization run into one sandbox state for
// validate's combined re-probe. Reverts to `.original/` first (clean
// slate), then applies each winner's lever in order, then writes
// `sandbox/proposalsApplied.json` as a journal of what's currently
// active.
//
// Order is deterministic — sorted by case id then attempt id — so the
// stacked state reproduces byte-for-byte across runs. Apply errors fail
// loud (the operator gets a meaningful message about which winner broke).

import * as fs from "node:fs";
import * as path from "node:path";

import type { ActionConfigProvider } from "../../translation/actionConfigProvider.js";
import type { ApplyContext } from "./registry.js";
import { getLever } from "./registry.js";
import { revertAllFromOriginal } from "./sandboxRevert.js";
import type { AttemptRecord, CaseResult } from "./types.js";

export interface ProposalsAppliedJournal {
    schemaVersion: 1;
    appliedAt: string;
    runId: string;
    applied: {
        caseId: string;
        attemptId: string;
        lever: string;
        schemasTouched: string[];
        filesWritten: string[];
    }[];
    /** Cases whose winner.json was null — recorded for completeness. */
    skipped: { caseId: string; reason: string }[];
}

export interface StackWinnersOpts {
    sandboxDir: string;
    runId: string;
    caseResults: CaseResult[];
    /** The live provider — passed to each lever via ApplyContext.
     *  Production levers use this to resolve original source paths and
     *  diff against. */
    sourceProvider: ActionConfigProvider;
}

/**
 * Revert sandbox, apply every winner in deterministic order, write
 * `proposalsApplied.json`. Returns the journal. Throws if any lever
 * apply throws — the operator must fix or remove the offending winner
 * before validate can proceed.
 */
export async function stackWinners(
    opts: StackWinnersOpts,
): Promise<ProposalsAppliedJournal> {
    revertAllFromOriginal(opts.sandboxDir);

    const journal: ProposalsAppliedJournal = {
        schemaVersion: 1,
        appliedAt: new Date().toISOString(),
        runId: opts.runId,
        applied: [],
        skipped: [],
    };

    // Deterministic order: sort by caseId, then by attemptId.
    const sorted = [...opts.caseResults].sort((a, b) => {
        if (a.case.neighborhoodId !== b.case.neighborhoodId) {
            return a.case.neighborhoodId.localeCompare(b.case.neighborhoodId);
        }
        const aId = a.winner?.hypothesis.id ?? "";
        const bId = b.winner?.hypothesis.id ?? "";
        return aId.localeCompare(bId);
    });

    for (const cr of sorted) {
        if (!cr.winner) {
            journal.skipped.push({
                caseId: cr.case.neighborhoodId,
                reason: "no winner found within depth budget",
            });
            continue;
        }
        const winner: AttemptRecord = cr.winner;
        const lever = getLever(winner.hypothesis.lever);
        if (!lever) {
            throw new Error(
                `stackWinners: lever '${winner.hypothesis.lever}' is not registered. ` +
                    `Has initBuiltInLevers() been called?`,
            );
        }
        const applyCtx: ApplyContext = {
            originalProvider: opts.sourceProvider,
            sandboxDir: opts.sandboxDir,
            schemaSourceLookup(schemaName: string) {
                const schemaDir = path.join(
                    opts.sandboxDir,
                    "agents",
                    schemaName,
                );
                return {
                    tsPath: path.join(schemaDir, "schema.ts"),
                    pasPath: path.join(schemaDir, "schema.pas.json"),
                    manifestPath: path.join(schemaDir, "manifest.json"),
                };
            },
            checksums: cr.case.originalChecksum,
        };
        let applyResult;
        try {
            applyResult = await lever.applyToSandbox(
                winner.hypothesis,
                applyCtx,
            );
        } catch (err) {
            throw new Error(
                `stackWinners: failed to apply winner ${winner.hypothesis.id} for case ${cr.case.neighborhoodId}: ` +
                    `${err instanceof Error ? err.message : String(err)}`,
            );
        }
        journal.applied.push({
            caseId: cr.case.neighborhoodId,
            attemptId: winner.hypothesis.id,
            lever: winner.hypothesis.lever,
            schemasTouched: [
                ...new Set(cr.case.members.map((m) => m.schemaName)),
            ].sort(),
            filesWritten: applyResult.filesWritten,
        });
    }

    fs.writeFileSync(
        path.join(opts.sandboxDir, "proposalsApplied.json"),
        JSON.stringify(journal, undefined, 2),
    );
    return journal;
}
