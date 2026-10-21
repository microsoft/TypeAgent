// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    CopilotToolMacro,
    MacroProgramRuntime,
    MacroRunRecord,
    RunMacroRequest,
} from "./contracts.js";
import type {
    JsonValue,
    RecipeEffectCheckpoint,
    RecipeRunResult,
} from "./recipeContracts.js";
import { validateRecipeValue } from "./recipeValidation.js";

export interface MacroProgramJournal {
    macroId: string;
    version: number;
    runId: string;
    startedAt: string;
    checkpoints: RecipeEffectCheckpoint[];
}

async function appendCheckpoint(
    destination: string,
    checkpoint: RecipeEffectCheckpoint,
) {
    // Never recreate a missing journal or replace the exclusive run claim.
    const handle = await open(destination, "r+");
    try {
        const bytes = Buffer.from(`${JSON.stringify({ checkpoint })}\n`);
        const size = (await handle.stat()).size;
        let written = 0;
        while (written < bytes.length) {
            const result = await handle.write(
                bytes,
                written,
                bytes.length - written,
                size + written,
            );
            if (!result.bytesWritten)
                throw new Error("Program journal append made no progress.");
            written += result.bytesWritten;
        }
        await handle.sync();
    } finally {
        await handle.close();
    }
}

export function programJournalPath(rootDir: string, runId: string) {
    return path.join(rootDir, "program-runs", `${runId}.json`);
}

export async function readProgramJournal(rootDir: string, runId: string) {
    const lines = (
        await readFile(programJournalPath(rootDir, runId), "utf8")
    ).split("\n");
    const header = JSON.parse(lines.shift()!);
    if (
        header.schemaVersion !== 2 ||
        header.runId !== runId ||
        typeof header.macroId !== "string" ||
        !Number.isSafeInteger(header.version) ||
        typeof header.startedAt !== "string"
    )
        throw new Error(
            "Incompatible canonical program journal; explicitly reset/reimport the development store. It was not deleted.",
        );
    const journal: MacroProgramJournal = { ...header, checkpoints: [] };
    const checkpoints = new Map<string, RecipeEffectCheckpoint>();
    // An interrupted final append is not a durable acknowledgement.
    lines.pop();
    for (const line of lines) {
        const { checkpoint } = JSON.parse(line);
        if (
            !checkpoint ||
            typeof checkpoint.callId !== "string" ||
            ![
                "not_dispatched",
                "dispatched",
                "completed",
                "uncertain",
            ].includes(checkpoint.phase)
        )
            throw new Error("Invalid durable program checkpoint.");
        checkpoints.set(checkpoint.callId, checkpoint);
    }
    journal.checkpoints = [...checkpoints.values()];
    return journal;
}

export async function runMacroProgram(
    rootDir: string,
    macro: CopilotToolMacro,
    request: RunMacroRequest,
    runtime: MacroProgramRuntime,
    signal: AbortSignal,
    assertCurrent: () => Promise<void>,
): Promise<MacroRunRecord> {
    const artifact = macro.program;
    if (!artifact) throw new Error("Program artifact is missing.");
    const input = request.inputs ?? {};
    const invalid = validateRecipeValue(artifact.inputSchema, input);
    if (invalid.length)
        throw new Error(
            `Invalid program input: ${invalid.map((issue) => issue.message).join("; ")}`,
        );
    const journal: MacroProgramJournal = {
        macroId: macro.macroId,
        version: macro.version,
        runId: request.runId,
        startedAt: new Date().toISOString(),
        checkpoints: [],
    };
    const destination = programJournalPath(rootDir, request.runId);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(
        destination,
        `${JSON.stringify({ ...journal, schemaVersion: 2 })}\n`,
        {
            encoding: "utf8",
            flag: "wx",
            flush: true,
        },
    );
    let checkpointMutation = Promise.resolve();
    const checkpointIndexes = new Map<string, number>();
    let result: RecipeRunResult;
    try {
        result = await runtime.execute(artifact, input as JsonValue, {
            runId: request.runId,
            cwd: macro.learning?.cwd ?? "",
            signal,
            timeoutMs: Math.min(
                Math.max(request.timeoutMs ?? 60_000, 1),
                60_000,
            ),
            onCheckpoint: (checkpoint) => {
                const saved = structuredClone(checkpoint);
                checkpointMutation = checkpointMutation.then(async () => {
                    if (saved.phase === "dispatched") {
                        signal.throwIfAborted();
                        await assertCurrent();
                    }
                    await appendCheckpoint(destination, saved);
                    const index = checkpointIndexes.get(saved.callId);
                    if (index === undefined) {
                        checkpointIndexes.set(
                            saved.callId,
                            journal.checkpoints.length,
                        );
                        journal.checkpoints.push(saved);
                    } else journal.checkpoints[index] = saved;
                });
                return checkpointMutation;
            },
        });
        await checkpointMutation;
        if (
            !result.accepted ||
            result.runId !== request.runId ||
            result.recipeId !== artifact.recipeId ||
            result.revision !== artifact.revision ||
            result.fallback !== "never"
        )
            throw new Error(
                "Program executor returned an invalid run identity.",
            );
    } catch (error) {
        const uncertain = journal.checkpoints.some(
            (checkpoint) =>
                checkpoint.phase === "dispatched" ||
                checkpoint.phase === "uncertain",
        );
        result = {
            runId: request.runId,
            recipeId: artifact.recipeId,
            revision: artifact.revision,
            accepted: true,
            status: uncertain
                ? "execution_uncertain"
                : signal.aborted
                  ? "cancelled"
                  : "failed",
            message: error instanceof Error ? error.message : String(error),
            checkpoints: journal.checkpoints,
            completedCallIds: journal.checkpoints
                .filter((checkpoint) => checkpoint.phase === "completed")
                .map((checkpoint) => checkpoint.callId),
            semanticEvidence: [],
            fallback: "never",
        };
    }
    return {
        runId: request.runId,
        macroId: macro.macroId,
        version: macro.version,
        status:
            result.status === "completed"
                ? "completed"
                : result.status === "cancelled"
                  ? "cancelled"
                  : "failed",
        executionClass: macro.executionClass,
        inputs: input,
        steps: [],
        startedAt: journal.startedAt,
        completedAt: new Date().toISOString(),
        ...(result.output === undefined ? {} : { result: result.output }),
        ...(result.status === "completed"
            ? {}
            : {
                  error: {
                      code: result.status,
                      message: result.message ?? `Program ${result.status}.`,
                  },
              }),
        program: result,
    };
}
