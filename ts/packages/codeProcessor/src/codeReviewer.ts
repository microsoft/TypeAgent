// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import { MessageSourceRole, loadSchema } from "typeagent";
import {
    PromptSection,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    createJsonTranslator,
    getData,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { CodeReview, BreakPointSuggestions } from "./codeReviewSchema.js";
import {
    CodeBlock,
    Module,
    annotateCodeWithLineNumbers,
    codeSectionFromBlock,
    createCodeSection,
    createModuleSection,
} from "./code.js";
import { CodeAnswer } from "./codeAnswerSchema.js";
import { CodeDocumentation } from "./codeDocSchema.js";

/**
 * A code reviewer
 */
export interface CodeReviewer {
    readonly model: ChatModel;
    review(
        codeToReview: string | string[],
        module?: Module[],
    ): Promise<CodeReview>;
    debug(
        observation: string,
        codeToReview: string | string[],
        module?: Module[],
    ): Promise<CodeReview>;
    breakpoints(
        observation: string,
        codeToReview: string | string[],
        module?: Module[],
    ): Promise<BreakPointSuggestions>;
    answer(
        question: string,
        codeToReview: string | string[],
        language?: string,
    ): Promise<CodeAnswer>;
    document(code: CodeBlock, facets?: string): Promise<CodeDocumentation>;
}

export function createCodeReviewer(
    model?: ChatModel | undefined,
): CodeReviewer {
    model ??= openai.createChatModelDefault("codeReviewer");
    const codeReviewSchema = ["codeReviewSchema.ts"];
    const reviewTranslator = createReviewTranslator<CodeReview>(
        model,
        codeReviewSchema,
        "CodeReview",
    );
    const breakpointTranslator = createReviewTranslator<BreakPointSuggestions>(
        model,
        codeReviewSchema,
        "BreakPointSuggestions",
    );

    const answerTranslator = createAnswerTranslator(model);
    const docTranslator = createDocTranslator(model);
    return {
        get model() {
            return model;
        },
        review,
        debug,
        breakpoints,
        answer,
        document,
    };

    async function review(
        codeToReview: string | string[],
        modules?: Module[],
    ): Promise<CodeReview> {
        const annotatedCode = annotateCodeWithLineNumbers(codeToReview);
        let sections: PromptSection[];
        if (modules) {
            sections = createModuleSections(modules);
        } else {
            sections = [];
        }
        return getData(
            await reviewTranslator.translate(annotatedCode, sections),
        );
    }

    async function debug(
        observation: string,
        codeToReview: string | string[],
        modules?: Module[],
    ): Promise<CodeReview> {
        const annotatedCode = annotateCodeWithLineNumbers(codeToReview);
        let sections: PromptSection[];
        if (modules) {
            sections = createModuleSections(modules);
        } else {
            sections = [];
        }
        sections.push({ role: MessageSourceRole.user, content: observation });
        return getData(
            await reviewTranslator.translate(annotatedCode, sections),
        );
    }

    async function breakpoints(
        observation: string,
        codeToReview: string | string[],
        modules?: Module[],
    ): Promise<BreakPointSuggestions> {
        const annotatedCode = annotateCodeWithLineNumbers(codeToReview);
        let sections: PromptSection[];
        if (modules) {
            sections = createModuleSections(modules);
        } else {
            sections = [];
        }
        sections.push({ role: MessageSourceRole.user, content: observation });
        return getData(
            await breakpointTranslator.translate(annotatedCode, sections),
        );
    }

    async function answer(
        question: string,
        codeToReview: string | string[],
        language?: string,
    ): Promise<CodeAnswer> {
        const annotatedCode = createCodeSection(codeToReview, language);
        return getData(
            await answerTranslator.translate(question, [annotatedCode]),
        );
    }

    async function document(
        code: CodeBlock,
        facets?: string,
    ): Promise<CodeDocumentation> {
        const annotatedCode = codeSectionFromBlock(code);
        facets ??= "accurate, active voice, crisp, succinct";
        let request =
            "Understand the included code and document it where necessary, especially complicated loops. Also explain parameters as needed using JSDoc syntax." +
            `The docs must be: ${facets}`;
        return getData(await docTranslator.translate(request, [annotatedCode]));
    }

    function createModuleSections(modules: Module[]): PromptSection[] {
        const sections: PromptSection[] = [];
        sections.push({
            role: MessageSourceRole.user,
            content: "Imports used by user code are included below.",
        });
        for (const m of modules) {
            sections.push(createModuleSection(m));
        }
        return sections;
    }

    function createReviewTranslator<T extends object>(
        model: TypeChatLanguageModel,
        schemaPaths: string[],
        typeName: string,
    ): TypeChatJsonTranslator<T> {
        const schema = loadSchema(schemaPaths, import.meta.url);
        const validator = createTypeScriptJsonValidator<T>(schema, typeName);
        const translator = createJsonTranslator<T>(model, validator);
        translator.createRequestPrompt = (request) =>
            createCodeReviewPrompt(request, schema, typeName);
        return translator;
    }

    function createCodeReviewPrompt(
        request: string,
        schema: string,
        typeName: string,
    ): string {
        return (
            `Return a code review of user code according to the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following is user code prefixed with line numbers:\n` +
            `"""typescript\n${request}\n"""\n` +
            `The following is your JSON response of type ${typeName} with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }

    function createCodeAnswerPrompt(
        request: string,
        schema: string,
        typeName: string,
    ): string {
        return (
            `Answer questions about the included code. Return answers according to the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `QUESTION: ${request}` +
            `The following is your JSON response of type ${typeName} with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }

    function createAnswerTranslator(
        model: TypeChatLanguageModel,
    ): TypeChatJsonTranslator<CodeAnswer> {
        const typeName = "CodeAnswer";
        const schema = loadSchema(["codeAnswerSchema.ts"], import.meta.url);
        const validator = createTypeScriptJsonValidator<CodeAnswer>(
            schema,
            typeName,
        );
        const translator = createJsonTranslator<CodeAnswer>(model, validator);
        translator.createRequestPrompt = (request) =>
            createCodeAnswerPrompt(request, schema, typeName);
        return translator;
    }

    function createDocTranslator(
        model: TypeChatLanguageModel,
    ): TypeChatJsonTranslator<CodeDocumentation> {
        const typeName = "CodeDocumentation";
        const schema = loadSchema(["codeDocSchema.ts"], import.meta.url);
        const validator = createTypeScriptJsonValidator<CodeDocumentation>(
            schema,
            typeName,
        );
        const translator = createJsonTranslator<CodeDocumentation>(
            model,
            validator,
        );
        return translator;
    }
}
