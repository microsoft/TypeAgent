// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ValidationResult, ValidationError } from "./types.mjs";

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

/**
 * Validates a taskFlow script using regex-based analysis.
 * Checks that only allowed APIs are used and blocked constructs are absent.
 */
export function validateTaskFlowScript(
    source: string,
    declaredParams: string[],
): ValidationResult {
    const errors: ValidationError[] = [];

    if (
        !/async\s+function\s+execute\s*\(\s*api\s*,\s*params\s*\)/.test(source)
    ) {
        errors.push({
            line: 1,
            column: 0,
            message: 'Script must define "async function execute(api, params)"',
            severity: "error",
        });
    }

    const lines = source.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        for (const blocked of BLOCKED_IDENTIFIERS) {
            const pattern = new RegExp(`\\b${blocked}\\b`);
            if (pattern.test(line)) {
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

        if (/\bimport\s*\(/.test(line)) {
            errors.push({
                line: lineNum,
                column: line.search(/\bimport\s*\(/),
                message: "Dynamic import() is not allowed",
                severity: "error",
            });
        }

        if (/new\s+Function\s*\(/.test(line)) {
            errors.push({
                line: lineNum,
                column: line.search(/new\s+Function\s*\(/),
                message: "new Function() is not allowed",
                severity: "error",
            });
        }
    }

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
