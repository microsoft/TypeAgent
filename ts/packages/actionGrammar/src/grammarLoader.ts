// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { compileGrammar, GrammarCompileError } from "./grammarCompiler.js";
import { parseGrammarRules } from "./grammarRuleParser.js";
import { Grammar } from "./grammarTypes.js";
import { getLineCol } from "./utils.js";

// REVIEW: start symbol should be configurable
const start = "Start";

function convertCompileError(
    fileName: string,
    content: string,
    type: "error" | "warning",
    errors: GrammarCompileError[],
) {
    return errors.map((e) => {
        const lineCol = getLineCol(content, e.pos ?? 0);
        return `${fileName}(${lineCol.line},${lineCol.col}): ${type}: ${e.message}${e.definition ? ` in definition '<${e.definition}>'` : ""}`;
    });
}

// Throw exception when error.
export function loadGrammarRules(fileName: string, content: string): Grammar;
// Return undefined when error if errors array provided.
export function loadGrammarRules(
    fileName: string,
    content: string,
    errors: string[],
    warnings?: string[],
): Grammar | undefined;
export function loadGrammarRules(
    fileName: string,
    content: string,
    errors?: string[],
    warnings?: string[],
): Grammar | undefined {
    const definitions = parseGrammarRules(fileName, content);
    const result = compileGrammar(definitions, start);

    if (result.warnings.length > 0 && warnings !== undefined) {
        warnings.push(
            ...convertCompileError(
                fileName,
                content,
                "warning",
                result.warnings,
            ),
        );
    }

    if (result.errors.length === 0) {
        return result.grammar;
    }
    const errorMessages = convertCompileError(
        fileName,
        content,
        "error",
        result.errors,
    );
    if (errors) {
        errors.push(...errorMessages);
        return undefined;
    }

    const errorStr = result.errors.length === 1 ? "error" : "errors";
    errorMessages.unshift(
        `Error detected in grammar compilation '${fileName}': ${result.errors.length} ${errorStr}.`,
    );
    throw new Error(errorMessages.join("\n"));
}
