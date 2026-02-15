// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defaultFileLoader } from "./defaultFileLoader.js";
import {
    compileGrammar,
    GrammarCompileError,
    FileLoader,
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
    contentOrLoader: string | FileLoader | undefined,
): Grammar;
// Return undefined when error if errors array provided.
export function loadGrammarRules(
    fileName: string,
    contentOrLoader: string | FileLoader | undefined,
    errors: string[],
    warnings?: string[],
): Grammar | undefined;
export function loadGrammarRules(
    fileName: string,
    contentOrLoader: string | FileLoader = defaultFileLoader,
    errors?: string[],
    warnings?: string[],
): Grammar | undefined {
    let displayPath, fullPath, content: string;
    let fileUtils: FileLoader | undefined;
    if (typeof contentOrLoader === "object") {
        fileUtils = contentOrLoader;
        fullPath = fileUtils.resolvePath(fileName);
        content = fileUtils.readContent(fullPath);
        displayPath = fileUtils.displayPath(fullPath);
    } else {
        displayPath = fileName;
        fullPath = fileName;
        content = contentOrLoader;
    }

    const parseResult = parseGrammarRules(displayPath, content);
    const result = compileGrammar(
        displayPath,
        fullPath,
        fileUtils,
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
