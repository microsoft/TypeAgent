// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    UserPromptSubmittedInput,
    UserPromptSubmittedOutput,
} from "@typeagent/agent-harness-hooks/copilot-cli";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { getConfigDir } from "./plugin-config.js";

const localExecutionStatus =
    "Plugin-local program execution is not enabled. Checkpoint A uses TypeAgent macro commands.";

const usage = [
    "Local recipe commands:",
    "@typeagent recipe list",
    "@typeagent recipe inspect <recipeId> <revision>",
    "@typeagent recipe status",
    "@typeagent recipe disable <recipeId> <revision>",
    "@typeagent recipe delete <recipeId> <revision>",
    "@typeagent recipe cancel job|run <id>",
    "IDs must be single non-whitespace tokens. Scope is the current workspace and local profile.",
    localExecutionStatus,
    "Plugin-local recipe capture is not enabled; use TypeAgent recording for Checkpoint A.",
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
    if (["inspect", "disable", "delete"].includes(command))
        return args.length === 2;
    if (command === "cancel")
        return args.length === 2 && ["job", "run"].includes(args[0]);
    return false;
}

export async function handleRecipeCommand(
    input: UserPromptSubmittedInput,
): Promise<UserPromptSubmittedOutput | undefined> {
    const match = input.prompt.match(
        /^\s*@typeagent\s+recipe(?:\s+([\s\S]*))?\s*$/i,
    );
    if (!match) return undefined;
    const parts = (match[1]?.trim() ?? "").split(/\s+/);
    parts[0] = parts[0].toLowerCase();
    if (!validArguments(parts)) return response(usage);
    const [rawCommand, ...args] = parts;
    const command = rawCommand.toLowerCase();
    const scope = getRecipeCommandScope(input.cwd);
    if (!scope.profileId.trim())
        return response("Recipe command failed: local profile ID is empty.");
    try {
        // Do not load SQLite or grammar code for ordinary/legacy prompts.
        const { DurableRecipeCatalog } = await import(
            "@typeagent/copilot-macros/recipeCatalog"
        );
        const catalog = new DurableRecipeCatalog(
            join(getConfigDir(), "recipes"),
        );
        try {
            if (command === "list")
                return response(
                    JSON.stringify(await catalog.list(scope), null, 2),
                );
            if (command === "status")
                return response(
                    JSON.stringify(
                        {
                            scope,
                            catalogRevision: (await catalog.snapshot(scope))
                                .catalogRevision,
                            jobs: await catalog.listJobs(scope),
                            runs: await catalog.listRuns(scope),
                            execution: localExecutionStatus,
                        },
                        null,
                        2,
                    ),
                );
            if (command === "cancel") {
                if (args[0] === "job") await catalog.cancelJob(scope, args[1]);
                else await catalog.cancelRun(scope, args[1]);
                return response(
                    `Cancellation requested for ${args[0]} ${args[1]}. Completed effects are not rolled back.`,
                );
            }
            const ref = { recipeId: args[0], revision: args[1] };
            if (command === "inspect")
                return response(
                    JSON.stringify(
                        (await catalog.snapshot(scope)).entries.find(
                            (entry) =>
                                entry.artifact.recipeId === ref.recipeId &&
                                entry.artifact.revision === ref.revision,
                        ) ?? {
                            error: "Unknown recipe revision in this scope.",
                        },
                        null,
                        2,
                    ),
                );
            if (command === "disable") await catalog.disable(scope, ref);
            else await catalog.delete(scope, ref);
            return response(
                `Recipe ${ref.recipeId} revision ${ref.revision} ${command === "disable" ? "disabled" : "deleted"}. Future calls stop; completed effects are not rolled back.`,
            );
        } finally {
            catalog.close();
        }
    } catch (error) {
        return response(
            `Recipe command failed locally: ${error instanceof Error ? error.message : "Unknown error."}`,
        );
    }
}
