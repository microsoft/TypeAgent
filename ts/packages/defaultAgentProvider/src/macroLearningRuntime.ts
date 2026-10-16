// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import type {
    CopilotToolMacro,
    MacroLearningRuntime,
} from "@typeagent/copilot-macros";
import {
    createMacroLearningRuntime as createPortableRuntime,
    type MacroLearningQuery,
    type MacroLearningRuntimeOptions,
} from "@typeagent/copilot-macros/macroAuthoringRuntime";

export * from "@typeagent/copilot-macros/macroAuthoringRuntime";

const defaultQuery: MacroLearningQuery = async (prompt, signal) => {
    const result = await openai
        .createChatModel(
            process.env.TYPEAGENT_MACRO_LEARNING_MODEL
                ? `copilot:${process.env.TYPEAGENT_MACRO_LEARNING_MODEL}`
                : "copilot",
        )
        .complete(prompt, undefined, undefined, undefined, signal);
    if (!result.success)
        throw new Error(`Macro learning model failed: ${result.message}`);
    return result.data;
};

export function createMacroLearningRuntime(
    query: MacroLearningQuery = defaultQuery,
    loadApprovedMacros?: () => Promise<CopilotToolMacro[]>,
    options?: MacroLearningRuntimeOptions,
    programAuthor: MacroLearningRuntime["buildProgram"] = async () => {
        throw new Error(
            "Program authoring requires the TypeAgent capability inspector.",
        );
    },
) {
    return createPortableRuntime(
        query,
        loadApprovedMacros,
        options,
        programAuthor,
    );
}
