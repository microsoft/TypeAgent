// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    compileGrammar,
    GrammarCompileError,
    LoadFileContentFunction,
} from "./grammarCompiler.js";
import { parseGrammarRules } from "./grammarRuleParser.js";
import { Grammar } from "./grammarTypes.js";
import { getLineCol } from "./utils.js";

// REVIEW: start symbol should be configurable
const start = "Start";

function convertCompileError(
    content: string,
    type: "error" | "warning",
    errors: GrammarCompileError[],
) {
    return errors.map((e) => {
        const lineCol = getLineCol(content, e.pos ?? 0);
        return `${e.displayPath}(${lineCol.line},${lineCol.col}): ${type}: ${e.message}${e.definition ? ` in definition '<${e.definition}>'` : ""}`;
    });
}

// Throw exception when error.
export function loadGrammarRules(
    fileName: string,
    contentOrLoadFileContent: string | LoadFileContentFunction,
): Grammar;
// Return undefined when error if errors array provided.
export function loadGrammarRules(
    fileName: string,
    contentOrLoadFileContent: string | LoadFileContentFunction,
    errors: string[],
    warnings?: string[],
): Grammar | undefined;
export function loadGrammarRules(
    fileName: string,
    contentOrLoadFileContent: string | LoadFileContentFunction,
    errors?: string[],
    warnings?: string[],
): Grammar | undefined {
    let displayPath, fullPath, content: string;
    let loadFileContent: LoadFileContentFunction | undefined;
    if (typeof contentOrLoadFileContent === "function") {
        loadFileContent = contentOrLoadFileContent;
        const loadResult = loadFileContent(fileName);
        displayPath = loadResult.displayPath;
        fullPath = loadResult.fullPath;
        content = loadResult.content;
    } else {
        displayPath = fileName;
        fullPath = fileName;
        content = contentOrLoadFileContent;
    }

    const parseResult = parseGrammarRules(displayPath, content);
    const result = compileGrammar(
        displayPath,
        fullPath,
        loadFileContent,
        parseResult.definitions,
        start,
        parseResult.imports,
    );

    if (result.warnings.length > 0 && warnings !== undefined) {
        warnings.push(
            ...convertCompileError(content, "warning", result.warnings),
        );
    }

    if (result.errors.length === 0) {
        // Add entity declarations to the grammar
        const grammar = result.grammar;
        if (parseResult.entities.length > 0) {
            grammar.entities = parseResult.entities;
        }
        return grammar;
    }
    const errorMessages = convertCompileError(content, "error", result.errors);
    if (errors) {
        errors.push(...errorMessages);
        return undefined;
    }

    const errorStr = result.errors.length === 1 ? "error" : "errors";
    errorMessages.unshift(
        `Error detected in grammar compilation '${displayPath}': ${result.errors.length} ${errorStr}.`,
    );
    throw new Error(errorMessages.join("\n"));
}
