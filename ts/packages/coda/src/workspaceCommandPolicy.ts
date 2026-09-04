// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const shellSyntax = /[;&|<>`$()\r\n^]/;

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

/**
 * Commands are intentionally restricted to focused build, test, lint, and
 * diagnostic tools. Accepting general shell syntax would make safety depend on
 * an incomplete denylist.
 */
export function validateFocusedWorkspaceCommand(
    command: string,
): string | undefined {
    const trimmed = command.trim();
    if (shellSyntax.test(trimmed)) {
        return "Shell composition is not supported for structured workspace commands.";
    }
    const match = /^([A-Za-z0-9_.-]+)(?:\s+(.*))?$/.exec(trimmed);
    if (!match) {
        return "Command must begin with a supported focused build, test, lint, or diagnostic tool.";
    }
    const [, executable, argumentsText = ""] = match;
    const normalizedExecutable = executable.toLowerCase();
    if (directTools.has(normalizedExecutable)) {
        return undefined;
    }
    const subcommand = subcommandTools.get(normalizedExecutable);
    if (subcommand?.test(argumentsText)) {
        return undefined;
    }
    return "Only focused build, test, lint, and diagnostic commands are supported.";
}
