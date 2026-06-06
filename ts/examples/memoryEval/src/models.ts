// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import { loadSchema } from "typeagent";
import {
    createJsonTranslator,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

// A single chat model is shared by the question generator and the grader.
// The same model family the .NET benchmark uses (a top-tier chat model) is
// appropriate here; cost is not a constraint for evaluation runs.
export function createJudgeModel(): ChatModel {
    return openai.createChatModel(undefined, { temperature: 0 }, undefined, [
        "memoryEvalJudge",
    ]);
}

// Build a TypeChat JSON translator for a schema file shipped alongside this
// module (copied into dist by the build's `postbuild` copyfiles step).
export function createTranslator<T extends object>(
    model: TypeChatLanguageModel,
    schemaFile: string,
    typeName: string,
    instructions: string,
): TypeChatJsonTranslator<T> {
    const schema = loadSchema([schemaFile], import.meta.url);
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);
    translator.createRequestPrompt = (request: string) =>
        `${instructions}\n` +
        `You translate the user content into a JSON object of type "${typeName}" according to the following TypeScript definitions:\n` +
        `\`\`\`\n${schema}\`\`\`\n` +
        `The following is the user content:\n` +
        `"""\n${request}\n"""\n` +
        `The following is the content translated into a JSON object with 0 spaces of indentation and no properties with the value undefined:\n`;
    return translator;
}
