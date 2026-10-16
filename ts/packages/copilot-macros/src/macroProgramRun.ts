// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

async function saveJournal(
    destination: string,
    journal: MacroProgramJournal,
    create: boolean,
) {
    await mkdir(path.dirname(destination), { recursive: true });
    if (create) {
        await writeFile(destination, JSON.stringify(journal), {
            encoding: "utf8",
            flag: "wx",
            flush: true,
        });
        return;
    }
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(journal), {
        encoding: "utf8",
        flag: "wx",
        flush: true,
    });
    await rename(temporary, destination);
}

export function programJournalPath(rootDir: string, runId: string) {
    return path.join(rootDir, "program-runs", `${runId}.json`);
}

export async function readProgramJournal(rootDir: string, runId: string) {
    return JSON.parse(
        await readFile(programJournalPath(rootDir, runId), "utf8"),
    ) as MacroProgramJournal;
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
    await saveJournal(destination, journal, true);
    let checkpointMutation = Promise.resolve();
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
                checkpointMutation = checkpointMutation.then(async () => {
                    if (checkpoint.phase === "dispatched") {
                        signal.throwIfAborted();
                        await assertCurrent();
                    }
                    const index = journal.checkpoints.findIndex(
                        (value) => value.callId === checkpoint.callId,
                    );
                    if (index === -1)
                        journal.checkpoints.push(structuredClone(checkpoint));
                    else
                        journal.checkpoints[index] =
                            structuredClone(checkpoint);
                    await saveJournal(destination, journal, false);
                });
                return checkpointMutation;
            },
        });
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
