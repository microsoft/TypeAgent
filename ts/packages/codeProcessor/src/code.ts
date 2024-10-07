// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageSourceRole, readAllText } from "typeagent";
import { PromptSection } from "typechat";

/**
 * Split the given code into individual lines
 * @param code
 * @returns
 */
export function codeToLines(code: string): string[] {
    return code.split(/\r?\n/);
}

/**
 * Annotate the given code with line numbers
 * @param codeText code to annotate
 * @returns
 */
export function annotateCodeWithLineNumbers(
    codeText: string | string[],
): string {
    const lines =
        typeof codeText === "string" ? codeToLines(codeText) : codeText;
    codeText = "";
    for (let i = 0; i < lines.length; ++i) {
        codeText += `//${i + 1}: ` + lines[i];
    }
    return codeText;
}

/**
 * Load code from given file and return it annotated with line numbers
 * Does not parse the code; just views the code as lines...
 * @param filePath
 * @param basePath
 * @returns
 */
export async function loadCodeWithLineNumbers(
    filePath: string,
    basePath?: string,
): Promise<string> {
    let codeText: string = await readAllText(filePath, basePath);
    return annotateCodeWithLineNumbers(codeText);
}

export type CodeBlock = {
    code: string | string[];
    language: string;
};

export function codeBlockToString(code: CodeBlock): string {
    const text = code.code;
    return typeof text === "string" ? text : text.join("\n");
}

export interface StoredCodeBlock {
    code: CodeBlock;
    sourcePath?: string | undefined;
}

/**
 * The text of a code module
 */
export type Module = {
    text: string;
    moduleName?: string | undefined; // if text is from an imported module
};

//---
// Code related prompt sections
//--

// A prompt section to tell the LLM about an imported module
export function createModuleSection(module: Module): PromptSection {
    if (module.moduleName) {
        return {
            role: MessageSourceRole.user,
            content: `Module name: ${module.moduleName}\n${module.text}`,
        };
    }
    return {
        role: MessageSourceRole.user,
        content: module.text,
    };
}

export function codeSectionFromBlock(code: CodeBlock): PromptSection {
    return createCodeSection(code.code, code.language ?? "typescript");
}

/**
 * Return a prompt section full of code, with each line annotated with line numbers
 * @param code string or array of string lines
 * @param language default language is typescript
 * @returns
 */
export function createCodeSection(
    code: string | string[],
    language: string = "typescript",
): PromptSection {
    code = annotateCodeWithLineNumbers(code);
    let content = `${language} code prefixed with line numbers:\n"""\n${code}\n"""\n`;
    return {
        role: MessageSourceRole.user,
        content,
    };
}

export type Api = {
    callConditions?: string | undefined;
    apiSignatures: string;
};

export function createApiSection(api: Api): PromptSection {
    let content = api.callConditions
        ? `Call this Api when the following conditions are met:\n${api.callConditions}\n\n${api.apiSignatures}`
        : api.apiSignatures;
    return {
        role: MessageSourceRole.user,
        content,
    };
}
