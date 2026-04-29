// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defaultFileLoader } from "./defaultFileLoader.js";
import { compileGrammar, FileLoader, SchemaLoader } from "./grammarCompiler.js";
import { GrammarOptimizationOptions } from "./grammarOptimizer.js";
import { parseGrammarRules } from "./grammarRuleParser.js";
import { Grammar } from "./grammarTypes.js";

export type LoadGrammarRulesOptions = {
    start?: string; // Optional start symbol (default: "Start")
    startValueRequired?: boolean; // Whether the start rule must produce a value (default: true)
    schemaLoader?: SchemaLoader; // Optional loader for resolving .ts type imports
    enableValueExpressions?: boolean; // Enable JavaScript-like value expressions (default: false)
    /** Compile-time AST optimizations.  All optimizations default to off. */
    optimizations?: GrammarOptimizationOptions;
};

function parseAndCompileGrammar(
    fileName: string,
    contentOrLoader: string | FileLoader,
    errors: string[],
    warnings?: string[],
    options?: LoadGrammarRulesOptions,
) {
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

    const start = options?.start ?? "Start";
    const startValueRequired = options?.startValueRequired ?? true;
    const enableValueExpressions = options?.enableValueExpressions ?? false;
    const parseResult = parseGrammarRules(
        displayPath,
        content,
        undefined,
        enableValueExpressions,
    );
    const grammar = compileGrammar(
        displayPath,
        content,
        fullPath,
        fileUtils,
        parseResult.definitions,
        start,
        startValueRequired,
        errors,
        warnings,
        parseResult.imports,
        options?.schemaLoader,
        options?.optimizations,
    );
    return grammar;
}

// Throw exception when error.
export function loadGrammarRules(
    fileName: string,
    contentOrLoader: string | FileLoader = defaultFileLoader,
    options?: LoadGrammarRulesOptions,
): Grammar {
    const errors: string[] = [];
    const grammar = parseAndCompileGrammar(
        fileName,
        contentOrLoader,
        errors,
        undefined,
        options,
    );
    if (errors.length === 0) {
        return grammar;
    }

    const errorStr = errors.length === 1 ? "error" : "errors";
    errors.unshift(
        `Error detected in grammar compilation '${fileName}': ${errors.length} ${errorStr}.`,
    );
    throw new Error(errors.join("\n"));
}

export function loadGrammarRulesNoThrow(
    fileName: string,
    contentOrLoader: string | FileLoader = defaultFileLoader,
    errors: string[],
    warnings?: string[],
    options?: LoadGrammarRulesOptions,
): Grammar | undefined {
    try {
        const grammar = parseAndCompileGrammar(
            fileName,
            contentOrLoader,
            errors,
            warnings,
            options,
        );

        return errors.length === 0 ? grammar : undefined;
    } catch (e) {
        errors.push(
            `Exception thrown while loading grammar '${fileName}':\n${e}`,
        );
        return undefined;
    }
}
