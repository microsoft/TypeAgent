// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentServerConnection } from "@typeagent/agent-server-client";
import { getRecipeOwner } from "./plugin-config.js";
import {
    callLocalRecipe,
    resolveLocalRecipeWorkspace,
} from "./recipe-transport.js";

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
] as const satisfies readonly (keyof AgentServerConnection)[];
type Method = (typeof macroOwnerMethods)[number];
export type MacroOwnerConnection = Pick<
    AgentServerConnection,
    Method | "close"
>;

export async function connectToMacroOwner(
    cwd?: string,
    sessionId = process.env.COPILOT_AGENT_SESSION_ID,
): Promise<MacroOwnerConnection> {
    const owner = getRecipeOwner();
    if (owner === "off") throw new Error("Recipe features are disabled.");
    if (owner === "typeagent") {
        const { connectToAgentServer } = await import("./typeagent-client.js");
        return connectToAgentServer();
    }
    if (!sessionId)
        throw new Error(
            "Local recipes require the actual native Copilot session.",
        );
    const workspace = cwd ?? (await resolveLocalRecipeWorkspace(sessionId));
    const invoke = async <K extends Method>(
        method: K,
        ...args: Parameters<AgentServerConnection[K]>
    ): Promise<Awaited<ReturnType<AgentServerConnection[K]>>> =>
        (await callLocalRecipe(workspace, sessionId, method, args)) as Awaited<
            ReturnType<AgentServerConnection[K]>
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
