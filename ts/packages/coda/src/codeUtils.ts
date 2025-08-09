// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function ensureFunctionDeclarationClosure(
    declaration: string,
    language: string,
): string {
    const decl = declaration.trim();
    if (language === "python") {
        return decl.endsWith(":") ? decl : decl + ":";
    }
    return decl.endsWith("{") ? decl : decl + " {";
}

export function generateDocComment(
    docstring: string | undefined,
    language: string,
    indent: string = "",
): string {
    if (!docstring) return "";
    if (language === "python") {
        return `${indent}"""${docstring}"""\n`;
    }
    return `${indent}/** ${docstring} */\n`;
}

export function needsClosingBrace(language: string): boolean {
    return language !== "python";
}

export function getClosingBraceIfNeeded(language: string): string {
    return needsClosingBrace(language) ? "}\n" : "";
}
