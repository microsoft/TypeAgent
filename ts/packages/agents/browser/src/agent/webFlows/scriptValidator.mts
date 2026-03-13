// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ValidationResult, ValidationError } from "./types.js";

const BLOCKED_IDENTIFIERS = new Set([
    "eval",
    "Function",
    "require",
    "import",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "window",
    "document",
    "globalThis",
    "self",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "chrome",
    "process",
    "Buffer",
    "__dirname",
    "__filename",
]);

export const ALLOWED_GLOBALS = new Set([
    "browser",
    "params",
    "console",
    "JSON",
    "Math",
    "String",
    "Number",
    "Boolean",
    "Array",
    "Object",
    "Date",
    "RegExp",
    "Map",
    "Set",
    "Promise",
    "Error",
    "TypeError",
    "RangeError",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "undefined",
    "null",
    "NaN",
    "Infinity",
    "true",
    "false",
]);

/**
 * Validates a webFlow script using regex-based analysis.
 * Checks that only allowed APIs are used and blocked constructs are absent.
 *
 * This is a conservative, pattern-based validator. It scans for:
 * 1. Blocked global identifiers (eval, fetch, document, etc.)
 * 2. Dynamic code execution patterns (new Function, import())
 * 3. Presence of the execute function signature
 * 4. Usage of declared parameters
 */
export function validateWebFlowScript(
    source: string,
    declaredParams: string[],
): ValidationResult {
    const errors: ValidationError[] = [];

    // Check for execute function signature
    if (!/async\s+function\s+execute\s*\(\s*browser\s*,\s*params\s*\)/.test(source)) {
        errors.push({
            line: 1,
            column: 0,
            message:
                'Script must define "async function execute(browser, params)"',
            severity: "error",
        });
    }

    const lines = source.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Skip comments
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        // Check for blocked identifiers used as standalone references
        for (const blocked of BLOCKED_IDENTIFIERS) {
            // Match as standalone identifier (not as part of a larger word, not in a string)
            const pattern = new RegExp(`\\b${blocked}\\b`);
            if (pattern.test(line)) {
                // Exclude occurrences inside string literals (basic check)
                const withoutStrings = line
                    .replace(/"[^"]*"/g, '""')
                    .replace(/'[^']*'/g, "''")
                    .replace(/`[^`]*`/g, "``");
                if (pattern.test(withoutStrings)) {
                    errors.push({
                        line: lineNum,
                        column: line.search(pattern),
                        message: `Disallowed identifier: '${blocked}'`,
                        severity: "error",
                    });
                }
            }
        }

        // Check for dynamic import
        if (/\bimport\s*\(/.test(line)) {
            errors.push({
                line: lineNum,
                column: line.search(/\bimport\s*\(/),
                message: "Dynamic import() is not allowed",
                severity: "error",
            });
        }

        // Check for new Function()
        if (/new\s+Function\s*\(/.test(line)) {
            errors.push({
                line: lineNum,
                column: line.search(/new\s+Function\s*\(/),
                message: "new Function() is not allowed",
                severity: "error",
            });
        }
    }

    // Check that all declared parameters are referenced
    for (const param of declaredParams) {
        const paramPattern = new RegExp(`params\\.${param}\\b`);
        if (!paramPattern.test(source)) {
            errors.push({
                line: 0,
                column: 0,
                message: `Declared parameter '${param}' is never used in the script`,
                severity: "warning",
            });
        }
    }

    return {
        valid: errors.filter((e) => e.severity === "error").length === 0,
        errors,
    };
}
