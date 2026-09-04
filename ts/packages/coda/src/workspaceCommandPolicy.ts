// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

const shellSyntax = /[;&|<>`$()\r\n^]/;
const shellExpansionSyntax = /[%!~*?[\]{}]/;

const directTools = new Set([
    "ava",
    "bazel",
    "eslint",
    "flake8",
    "jest",
    "mocha",
    "msbuild",
    "ninja",
    "prettier",
    "pytest",
    "ruff",
    "tsc",
    "vitest",
    "xcodebuild",
]);

const subcommandTools = new Map<string, RegExp>([
    ["bun", /^(?:run\s+(?:build|check|format|lint|test|typecheck)\b|test\b)/i],
    ["cargo", /^(?:build|check|clippy|fmt|test)\b/i],
    ["cmake", /^--build\b/i],
    ["dotnet", /^(?:build|format|test)\b/i],
    ["go", /^(?:build|test|vet)\b/i],
    ["gradle", /^(?:build|check|test)\b/i],
    ["gradlew", /^(?:build|check|test)\b/i],
    ["mvn", /^(?:compile|package|test|verify)\b/i],
    ["npm", /^(?:run\s+(?:build|check|format|lint|test|typecheck)\b|test\b)/i],
    ["pnpm", /^(?:run\s+(?:build|check|format|lint|test|typecheck)\b|test\b)/i],
    ["yarn", /^(?:run\s+(?:build|check|format|lint|test|typecheck)\b|test\b)/i],
]);

function tokenizeCommand(command: string): string[] | undefined {
    const tokens: string[] = [];
    let current = "";
    let quote: "'" | '"' | undefined;
    for (const character of command) {
        if (character === "'" || character === '"') {
            if (quote === character) {
                quote = undefined;
            } else if (quote === undefined) {
                quote = character;
            } else {
                current += character;
            }
        } else if (/\s/.test(character) && quote === undefined) {
            if (current.length > 0) {
                tokens.push(current);
                current = "";
            }
        } else {
            current += character;
        }
    }
    if (quote !== undefined) {
        return undefined;
    }
    if (current.length > 0) {
        tokens.push(current);
    }
    return tokens;
}

function isOutsideRoot(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
    );
}

function nearestExistingPath(candidate: string): string {
    let current = candidate;
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) {
            return current;
        }
        current = parent;
    }
    return current;
}

function validatePathArguments(
    tokens: string[],
    cwd: string,
    workspaceRoot: string,
): string | undefined {
    const resolvedRoot = path.resolve(workspaceRoot);
    const realRoot = fs.realpathSync.native(resolvedRoot);
    for (const token of tokens.slice(1)) {
        const equalsIndex = token.indexOf("=");
        let value =
            token.startsWith("-") && equalsIndex > 1
                ? token.slice(equalsIndex + 1)
                : token;
        if (equalsIndex < 0) {
            const attachedShortOption = /^-[A-Za-z](.+)$/.exec(token);
            if (attachedShortOption !== null) {
                value = attachedShortOption[1];
            }
        }
        const resolved = path.resolve(cwd, value);
        const isPath =
            value === "." ||
            value === ".." ||
            path.isAbsolute(value) ||
            /^[A-Za-z]:[\\/]/.test(value) ||
            value.startsWith("\\\\") ||
            value.includes("/") ||
            value.includes("\\") ||
            fs.existsSync(resolved);
        if (!isPath) {
            continue;
        }

        if (isOutsideRoot(resolvedRoot, resolved)) {
            return "Command path arguments must stay within the selected workspace root.";
        }
        const realCandidate = fs.realpathSync.native(
            nearestExistingPath(resolved),
        );
        if (isOutsideRoot(realRoot, realCandidate)) {
            return "Command path arguments must stay within the selected workspace root.";
        }
    }
    return undefined;
}

/**
 * Commands are intentionally restricted to focused build, test, lint, and
 * diagnostic tools. Accepting general shell syntax would make safety depend on
 * an incomplete denylist.
 */
export function validateFocusedWorkspaceCommand(
    command: string,
    cwd?: string,
    workspaceRoot?: string,
): string | undefined {
    const trimmed = command.trim();
    if (shellSyntax.test(trimmed)) {
        return "Shell composition is not supported for structured workspace commands.";
    }
    if (
        shellExpansionSyntax.test(trimmed) ||
        (process.platform !== "win32" && trimmed.includes("\\"))
    ) {
        return "Shell path expansion is not supported for structured workspace commands.";
    }
    const tokens = tokenizeCommand(trimmed);
    if (tokens === undefined) {
        return "Command contains an unterminated quoted argument.";
    }
    const [executable, ...argumentTokens] = tokens;
    if (executable === undefined || !/^[A-Za-z0-9_.-]+$/.test(executable)) {
        return "Command must begin with a supported focused build, test, lint, or diagnostic tool.";
    }
    const argumentsText = argumentTokens.join(" ");
    const normalizedExecutable = executable.toLowerCase();
    const isAllowed =
        directTools.has(normalizedExecutable) ||
        subcommandTools.get(normalizedExecutable)?.test(argumentsText) === true;
    if (!isAllowed) {
        return "Only focused build, test, lint, and diagnostic commands are supported.";
    }
    return cwd !== undefined && workspaceRoot !== undefined
        ? validatePathArguments(tokens, cwd, workspaceRoot)
        : undefined;
}
