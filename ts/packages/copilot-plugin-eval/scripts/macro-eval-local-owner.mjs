// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import {
    resolveLocalRecipeWorkspace,
    callLocalRecipe,
} from "../../copilot-plugin/dist/shared/recipe-transport.js";
import {
    localRecipeScope,
    localRecipeDirectory,
} from "../../copilot-plugin/dist/shared/recipe-local-paths.js";

const allowed = new Set([
    "getMacroRun",
    "inspectMacro",
    "validateMacro",
    "approveMacro",
    "getMacroRecordingState",
    "armMacroRecording",
    "getMacroLearningJob",
    "cancelMacroLearningJob",
    "cancelMacroRun",
    "setMacroLearningPreference",
]);
const request = JSON.parse(fs.readFileSync(0, "utf8"));
const registered = await resolveLocalRecipeWorkspace(request.sessionId);
const scope = localRecipeScope(request.workspace);
if (JSON.stringify(scope) !== JSON.stringify(localRecipeScope(registered)))
    throw new Error("Native session belongs to another workspace/profile.");
if (request.method === "scope")
    process.stdout.write(
        JSON.stringify({
            ...scope,
            sessionId: request.sessionId,
            catalogDirectory: localRecipeDirectory(request.workspace),
        }),
    );
else {
    if (!allowed.has(request.method))
        throw new Error("Unsupported local evaluation method.");
    process.stdout.write(
        JSON.stringify(
            await callLocalRecipe(
                request.workspace,
                request.sessionId,
                request.method,
                request.args,
            ),
        ),
    );
}
