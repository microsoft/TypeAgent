// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    UserPromptSubmittedInput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
    connectToMacroOwner,
    type MacroOwnerConnection,
} from "./macro-owner.js";
import { getRecipeOwner } from "./plugin-config.js";
import { recipeOwnerSetting } from "./recipe-owner-command.js";

const usage = [
    "Recipe commands (selected owner):",
    "@typeagent recipe owner [plugin|off]",
    "@typeagent recipe list",
    "@typeagent recipe inspect <recipeId> <revision>",
    "@typeagent recipe status",
    "@typeagent recipe run <recipeId> <version> [JSON inputs]",
    "@typeagent recipe approve <recipeId> <version>",
    "@typeagent recipe disable <recipeId> <revision>",
    "@typeagent recipe delete <recipeId> <revision>",
    "@typeagent recipe cancel job|run <id>",
    "IDs must be single non-whitespace tokens. Scope is the current workspace and local profile.",
    "Use @typeagent macro learning read-only and @typeagent macro record to select recording.",
    "Restart after changing owners. Completed effects are not rolled back.",
].join("\n");

function response(responseContent: string): UserPromptSubmittedOutput {
    return { handled: true, responseContent, handledBy: "typeagent" };
}

export function getRecipeCommandScope(cwd: string) {
    // A stable opaque identity avoids persisting the filesystem path in scope.
    const workspace = resolve(cwd);
    return {
        workspaceId: createHash("sha256")
            .update(
                process.platform === "win32"
                    ? workspace.toLowerCase()
                    : workspace,
            )
            .digest("hex"),
        profileId: process.env.TYPEAGENT_RECIPE_PROFILE_ID ?? "local-default",
    };
}

function validArguments(parts: string[]) {
    const [command, ...args] = parts;
    if (command === "list" || command === "status") return args.length === 0;
    if (["inspect", "approve", "disable", "delete"].includes(command))
        return args.length === 2;
    if (command === "cancel")
        return args.length === 2 && ["job", "run"].includes(args[0]);
    return false;
}

async function runSavedRecipe(
    connection: MacroOwnerConnection,
    run: RegExpMatchArray,
) {
    const version = Number(run[2]);
    if (!Number.isSafeInteger(version))
        throw new Error("A positive integer recipe version is required.");
    const inputs: unknown = JSON.parse(run[3] ?? "{}");
    if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs))
        throw new Error("Recipe inputs must be a JSON object.");
    return connection.runMacro({
        macroId: run[1],
        version,
        runId: randomUUID(),
        inputs: inputs as Record<string, unknown>,
    });
}

async function mutateSavedRecipe(
    connection: MacroOwnerConnection,
    ref: { macroId: string; version: number },
    command: string,
) {
    const current = await connection.inspectMacro({ macroId: ref.macroId });
    if (current.version !== ref.version)
        throw new Error(
            "Only the current saved recipe version can be changed.",
        );
    if (command === "approve") await connection.approveMacro(ref);
    else if (command === "disable")
        await connection.disableMacro({ macroId: ref.macroId });
    else if (command === "delete")
        await connection.deleteMacro({ macroId: ref.macroId });
    else throw new Error("Unsupported recipe mutation.");
    const label =
        command === "approve"
            ? "approved"
            : command === "disable"
              ? "disabled"
              : "deleted";
    return `Recipe ${ref.macroId} version ${ref.version} ${label}. Approval does not grant tool permissions; completed effects are not rolled back.`;
}

export async function handleRecipeCommand(
    input: UserPromptSubmittedInput,
    connect: () => Promise<MacroOwnerConnection> = () =>
        connectToMacroOwner(input.cwd, input.sessionId),
): Promise<UserPromptSubmittedOutput | undefined> {
    const match = input.prompt.match(
        /^\s*@typeagent\s+recipe(?:\s+([\s\S]*))?\s*$/i,
    );
    if (!match) return undefined;
    const parts = (match[1]?.trim() ?? "").split(/\s+/);
    parts[0] = parts[0].toLowerCase();
    if (parts[0] === "owner")
        return response(recipeOwnerSetting(parts.slice(1).join(" ")));
    const run = match[1]
        ?.trim()
        .match(/^run\s+(\S+)\s+([1-9]\d*)(?:\s+([\s\S]+))?$/i);
    if (!run && !validArguments(parts)) return response(usage);
    const [rawCommand, ...args] = parts;
    const command = rawCommand.toLowerCase();
    const scope = getRecipeCommandScope(input.cwd);
    if (!scope.profileId.trim())
        return response("Recipe command failed: local profile ID is empty.");
    try {
        const owner = getRecipeOwner();
        if (owner === "off")
            return response(
                "Recipe ownership is off; routing, learning and execution are disabled.",
            );
        const connection = await connect();
        try {
            if (run) {
                return response(
                    JSON.stringify(
                        await runSavedRecipe(connection, run),
                        null,
                        2,
                    ),
                );
            }
            if (command === "list")
                return response(
                    JSON.stringify(await connection.listMacros(), null, 2),
                );
            if (command === "status")
                return response(
                    JSON.stringify(
                        {
                            scope,
                            owner,
                            recording: await connection.getMacroRecordingState(
                                input.sessionId,
                            ),
                            macros: await connection.listMacros(),
                        },
                        null,
                        2,
                    ),
                );
            if (command === "cancel") {
                if (args[0] === "job")
                    await connection.cancelMacroLearningJob(args[1]);
                else await connection.cancelMacroRun(args[1]);
                return response(
                    `Cancellation requested for ${args[0]} ${args[1]}. Completed effects are not rolled back.`,
                );
            }
            if (
                !/^[1-9]\d*$/.test(args[1]) ||
                !Number.isSafeInteger(Number(args[1]))
            )
                throw new Error(
                    "A positive integer recipe version is required.",
                );
            const ref = { macroId: args[0], version: Number(args[1]) };
            if (command === "inspect")
                return response(
                    JSON.stringify(await connection.inspectMacro(ref), null, 2),
                );
            return response(await mutateSavedRecipe(connection, ref, command));
        } finally {
            await connection.close();
        }
    } catch (error) {
        return response(
            `Recipe command failed: ${error instanceof Error ? error.message : "Unknown error."}`,
        );
    }
}
