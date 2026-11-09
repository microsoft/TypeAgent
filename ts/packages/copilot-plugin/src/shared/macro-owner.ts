// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MacroManager,
    RunMacroRequest,
    RunMacroResponse,
} from "@typeagent/copilot-macros";
import { getRecipeOwner } from "./plugin-config.js";
import {
    callLocalRecipe,
    resolveLocalRecipeWorkspace,
} from "./recipe-transport.js";

type ManagerMethodMap = {
    getMacroLearningPreference: "getMacroLearningPreference";
    setMacroLearningPreference: "setMacroLearningPreference";
    getMacroLearningJob: "getMacroLearningJob";
    cancelMacroLearningJob: "cancelMacroLearningJob";
    armMacroRecording: "armRecording";
    getMacroRecordingState: "getRecordingState";
    claimMacroRecording: "claimRecording";
    cancelMacroRecording: "cancelRecording";
    failMacroRecording: "failRecording";
    finalizeMacroRecording: "finalizeRecording";
    listMacros: "listMacros";
    searchMacros: "searchMacros";
    inspectMacro: "inspectMacro";
    getMacroRequirements: "getMacroRequirements";
    validateMacro: "validateMacro";
    approveMacro: "approveMacro";
    disableMacro: "disableMacro";
    deleteMacro: "deleteMacro";
    runMacro: "runMacro";
    cancelMacroRun: "cancelMacroRun";
    getMacroRun: "getMacroRun";
};

export const macroOwnerMethods = [
    "getMacroLearningPreference",
    "setMacroLearningPreference",
    "getMacroLearningJob",
    "cancelMacroLearningJob",
    "armMacroRecording",
    "getMacroRecordingState",
    "claimMacroRecording",
    "cancelMacroRecording",
    "failMacroRecording",
    "finalizeMacroRecording",
    "listMacros",
    "searchMacros",
    "inspectMacro",
    "getMacroRequirements",
    "validateMacro",
    "approveMacro",
    "disableMacro",
    "deleteMacro",
    "runMacro",
    "cancelMacroRun",
    "getMacroRun",
] as const satisfies readonly (keyof ManagerMethodMap)[];
type Method = (typeof macroOwnerMethods)[number];
export type MacroOwnerConnection = {
    [K in Exclude<Method, "runMacro">]: (
        ...args: Parameters<MacroManager[ManagerMethodMap[K]]>
    ) => Promise<Awaited<ReturnType<MacroManager[ManagerMethodMap[K]]>>>;
} & {
    runMacro(request: RunMacroRequest): Promise<RunMacroResponse>;
    close(): Promise<void>;
};

export type MacroAuthoringConnection = Pick<
    MacroOwnerConnection,
    "getMacroLearningPreference" | "getMacroLearningJob" | "close"
> & {
    claimMacroAuthoringRequest: MacroManager["claimMacroAuthoringRequest"];
    submitMacroAuthoringResponse: MacroManager["submitMacroAuthoringResponse"];
};

export async function connectToMacroOwner(
    cwd?: string,
    sessionId = process.env.COPILOT_AGENT_SESSION_ID,
): Promise<MacroOwnerConnection> {
    const owner = getRecipeOwner();
    if (owner === "off") throw new Error("Recipe features are disabled.");
    if (!sessionId)
        throw new Error(
            "Local recipes require the actual native Copilot session.",
        );
    const workspace = cwd ?? (await resolveLocalRecipeWorkspace(sessionId));
    const invoke = async <K extends Method>(
        method: K,
        ...args: Parameters<MacroOwnerConnection[K]>
    ): Promise<Awaited<ReturnType<MacroOwnerConnection[K]>>> =>
        (await callLocalRecipe(workspace, sessionId, method, args)) as Awaited<
            ReturnType<MacroOwnerConnection[K]>
        >;
    return {
        getMacroLearningPreference: (cwd) =>
            invoke("getMacroLearningPreference", cwd),
        setMacroLearningPreference: (request) =>
            invoke("setMacroLearningPreference", request),
        getMacroLearningJob: (id) => invoke("getMacroLearningJob", id),
        cancelMacroLearningJob: (id) => invoke("cancelMacroLearningJob", id),
        armMacroRecording: (request) => invoke("armMacroRecording", request),
        getMacroRecordingState: (id) => invoke("getMacroRecordingState", id),
        claimMacroRecording: (request) =>
            invoke("claimMacroRecording", request),
        cancelMacroRecording: (id) => invoke("cancelMacroRecording", id),
        failMacroRecording: (id, token, error) =>
            invoke("failMacroRecording", id, token, error),
        finalizeMacroRecording: (request) =>
            invoke("finalizeMacroRecording", request),
        listMacros: (request) => invoke("listMacros", request),
        searchMacros: (request) => invoke("searchMacros", request),
        inspectMacro: (request) => invoke("inspectMacro", request),
        getMacroRequirements: (request) =>
            invoke("getMacroRequirements", request),
        validateMacro: (request) => invoke("validateMacro", request),
        approveMacro: (request) => invoke("approveMacro", request),
        disableMacro: (request) => invoke("disableMacro", request),
        deleteMacro: (request) => invoke("deleteMacro", request),
        runMacro: (request) => invoke("runMacro", request),
        cancelMacroRun: (id) => invoke("cancelMacroRun", id),
        getMacroRun: (id) => invoke("getMacroRun", id),
        close: async () => {},
    };
}
