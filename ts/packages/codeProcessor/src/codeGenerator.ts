// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createTranslator, MessageSourceRole } from "typeagent";
import { CodeGenResponse } from "./codeGenSchema.js";
import { openai } from "aiclient";
import { getData, PromptSection, TypeChatLanguageModel } from "typechat";
import { Api, createApiSection } from "./code.js";

export type CodeType = "Function" | "Class" | string;
export type CodeDefinition = {
    language: string | "typescript";
    codeType: CodeType;
    description: string;
};

/**
 * A code generator
 */
export interface CodeGenerator {
    /**
     * Generate a function that can call the given Api
     * @param funcDef
     * @param availableApi
     */
    generate(
        funcDef: CodeDefinition,
        availableApi?: Api[] | undefined,
    ): Promise<CodeGenResponse>;
}

/**
 * Create a code generator
 * @param language code language
 * @param model model to use
 * @returns
 */
export function createCodeGenerator(
    model?: TypeChatLanguageModel | undefined,
): CodeGenerator {
    model ??= openai.createChatModelDefault("codeGenerator");
    const codeGenSchema = ["codeGenSchema.ts"];
    const codeGenTranslator = createTranslator<CodeGenResponse>(
        model,
        codeGenSchema,
        import.meta.url,
        "CodeGenResponse",
        createCodeGenPrompt,
    );

    return {
        generate,
    };

    async function generate(
        funcDef: CodeDefinition,
        availableApi?: Api[] | undefined,
    ): Promise<CodeGenResponse> {
        const funcDefText = JSON.stringify(funcDef);
        const request =
            `Generate code according to the following definitions:\n` +
            `\`\`\`\n${funcDefText}\`\`\`\n`;
        return getData(
            await codeGenTranslator.translate(
                request,
                createApiSections(availableApi),
            ),
        );
    }

    function createCodeGenPrompt(
        request: string,
        schema: string,
        typeName: string,
    ): string {
        return (
            `Generate code according to the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following is user request:\n` +
            `"""typescript\n${request}\n"""\n` +
            `The following is your JSON response of type ${typeName} with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }

    function createApiSections(
        apis?: Api[] | undefined,
    ): PromptSection[] | undefined {
        if (apis === undefined || apis.length === 0) {
            return undefined;
        }
        const sections: PromptSection[] = [];
        sections.push({
            role: MessageSourceRole.user,
            content: "Apis you can call are included below.",
        });
        for (const api of apis) {
            sections.push(createApiSection(api));
        }
        return sections;
    }
}
