// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";
import {
    createMacroProgramAuthor as createPortableAuthor,
    type MacroProgramAuthorOptions as PortableOptions,
} from "@typeagent/copilot-macros/macroProgramAuthoring";
import type { MacroLearningQuery } from "./macroLearningRuntime.js";

export * from "@typeagent/copilot-macros/macroProgramAuthoring";

export type MacroProgramAuthorOptions = Omit<
    Partial<PortableOptions>,
    "verifierQuery"
>;

const defaultQuery: MacroLearningQuery = async (prompt, signal) => {
    const result = await openai
        .createChatModel(
            process.env.TYPEAGENT_MACRO_LEARNING_MODEL
                ? `copilot:${process.env.TYPEAGENT_MACRO_LEARNING_MODEL}`
                : "copilot",
        )
        .complete(prompt, undefined, undefined, undefined, signal);
    if (!result.success)
        throw new Error(`Macro program model failed: ${result.message}`);
    return result.data;
};

export function createMacroProgramAuthor(
    options: MacroProgramAuthorOptions = {},
) {
    return createPortableAuthor({
        ...options,
        query: options.query ?? defaultQuery,
        verifierQuery: options.query ?? defaultQuery,
        semanticModelPolicy: options.semanticModelPolicy ?? {
            id: "typeagent-default",
            revision: "1",
        },
        inspectCapability:
            options.inspectCapability ??
            (async () => {
                throw new Error(
                    "Program authoring requires a typed capability inspector.",
                );
            }),
    });
}
