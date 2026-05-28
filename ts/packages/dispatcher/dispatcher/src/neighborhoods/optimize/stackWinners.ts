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

import * as crypto from "node:crypto";
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
        // Recompute checksums against the CURRENT sandbox files. We
        // can't reuse cr.case.originalChecksum here: that was captured
        // when the case was analyzed, against the pristine `.original/`
        // snapshot. By the time we get to the Nth winner, prior
        // winners' applies have already mutated some files in
        // sandbox/agents/. Each lever's verifyChecksum reads the
        // current file and would 400 on a stale snapshot value.
        //
        // The checksum still serves a real purpose during stacking:
        // it catches the case where the sandbox was tampered with
        // OUTSIDE the stack loop (a parallel process, an operator
        // editing the file by hand). The check fires if any party
        // modified the file between this read and the lever's apply.
        const freshChecksums = computeChecksumsForMembers(
            cr.case.members.map((m) => m.schemaName),
            opts.sandboxDir,
        );
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
            checksums: freshChecksums,
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

/**
 * Build a fresh `checksums` map for a case's member schemas against the
 * CURRENT sandbox file state. Used during winner stacking, where prior
 * applies in the same loop have already mutated some files and the
 * snapshot-time checksums no longer match.
 *
 * Returns SHA-1 keyed by `${schemaName}:schema` for `.ts` / `.pas.json`
 * (whichever exists) and `${schemaName}:manifest` for manifest.json.
 * Silently skips members whose files don't exist.
 */
function computeChecksumsForMembers(
    schemaNames: string[],
    sandboxDir: string,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const schemaName of schemaNames) {
        const schemaDir = path.join(sandboxDir, "agents", schemaName);
        for (const basename of ["schema.ts", "schema.pas.json"]) {
            const full = path.join(schemaDir, basename);
            if (fs.existsSync(full)) {
                out[`${schemaName}:schema`] = sha1OfFile(full);
                break;
            }
        }
        const manifestPath = path.join(schemaDir, "manifest.json");
        if (fs.existsSync(manifestPath)) {
            out[`${schemaName}:manifest`] = sha1OfFile(manifestPath);
        }
    }
    return out;
}

function sha1OfFile(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha1").update(content).digest("hex");
}
