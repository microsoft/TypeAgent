// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineTool, type Tool } from "@github/copilot-sdk";
import {
    createRepositoryTools,
    type RepositoryTools,
} from "explorer-typeagent";
import { realpath } from "node:fs/promises";
import { resolvePackagedRipgrepPath } from "./ripgrep.js";
import type { CopilotToolCallTrace } from "./types.js";

interface ReadArgs {
    path: string;
    offset?: number;
    limit?: number;
}

interface GrepArgs {
    pattern: string;
    path?: string;
    glob?: string;
    literal?: boolean;
    maxMatches?: number;
}

interface GlobArgs {
    pattern: string;
    maxMatches?: number;
}

interface LsArgs {
    path?: string;
    depth?: number;
    maxEntries?: number;
}

interface ToolBudget {
    executed: number;
    limit: number;
    exhaustedRecorded: boolean;
}

export type CopilotExplorationTools = Tool<any>[] & {
    close(): Promise<void>;
};

const DEFAULT_MAX_TOOL_CALLS = 8;
const MAX_TOOL_CALLS = 100;
const MAX_TRACE_STRING = 2_000;
const MAX_TRACE_OUTPUT = 12_000;

export async function createCopilotExplorationTools(
    repoPath: string,
    trace: CopilotToolCallTrace[],
    maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
    packagedRipgrepPath?: string,
): Promise<CopilotExplorationTools> {
    const root = await realpath(repoPath);
    const ripgrepPath =
        packagedRipgrepPath ?? (await resolvePackagedRipgrepPath());
    const repositoryTools = await createRepositoryTools({
        repoRoot: root,
        maxCalls: MAX_TOOL_CALLS,
        ripgrepPath,
    });
    const limit = Number.isFinite(maxToolCalls)
        ? Math.min(MAX_TOOL_CALLS, Math.max(0, Math.floor(maxToolCalls)))
        : DEFAULT_MAX_TOOL_CALLS;
    const budget = {
        executed: Math.min(trace.length, limit),
        limit,
        exhaustedRecorded: trace.length > limit,
    };

    const tools: Tool<any>[] = [
        defineTool<ReadArgs>("read", {
            description:
                "Read a UTF-8 text file inside the benchmark repository with line numbers.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Repository-relative file path",
                    },
                    offset: {
                        type: "number",
                        description: "1-based first line to return",
                        default: 1,
                    },
                    limit: {
                        type: "number",
                        description: "Maximum lines to return",
                        default: 200,
                    },
                },
                required: ["path"],
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "read", args, budget, () =>
                    readTool(repositoryTools, args),
                ),
        }),
        defineTool<GrepArgs>("grep", {
            description:
                "Search files inside the benchmark repository using ripgrep and return path:line matches.",
            parameters: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: "Search pattern" },
                    path: {
                        type: "string",
                        description:
                            "Optional repository-relative file or directory",
                    },
                    glob: {
                        type: "string",
                        description: "Optional ripgrep glob, e.g. *.ts",
                    },
                    literal: {
                        type: "boolean",
                        description: "Treat pattern as a fixed string",
                        default: false,
                    },
                    maxMatches: {
                        type: "number",
                        description: "Maximum matching lines",
                        default: 50,
                    },
                },
                required: ["pattern"],
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "grep", args, budget, () =>
                    grepTool(repositoryTools, args),
                ),
        }),
        defineTool<GlobArgs>("glob", {
            description:
                "Find repository-relative file paths matching a glob pattern.",
            parameters: {
                type: "object",
                properties: {
                    pattern: {
                        type: "string",
                        description:
                            "Repository-relative POSIX glob, e.g. *.ts or **/test_*.py",
                    },
                    maxMatches: {
                        type: "number",
                        description: "Maximum matching paths",
                        default: 200,
                    },
                },
                required: ["pattern"],
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "glob", args, budget, () =>
                    globTool(repositoryTools, args),
                ),
        }),
        defineTool<LsArgs>("ls", {
            description:
                "List files from the immutable filtered repository snapshot.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Optional repository-relative directory",
                        default: ".",
                    },
                    depth: {
                        type: "number",
                        description: "Maximum directory depth",
                        default: 2,
                    },
                    maxEntries: {
                        type: "number",
                        description: "Maximum paths to return",
                        default: 200,
                    },
                },
            },
            overridesBuiltInTool: true,
            skipPermission: true,
            handler: (args) =>
                traced(trace, "ls", args, budget, () =>
                    lsTool(repositoryTools, args),
                ),
        }),
    ];
    Object.defineProperty(tools, "close", {
        configurable: false,
        enumerable: false,
        value: () => repositoryTools.close(),
        writable: false,
    });
    return tools as CopilotExplorationTools;
}

async function readTool(
    repositoryTools: RepositoryTools,
    args: ReadArgs,
): Promise<string> {
    const offset = Math.max(1, Math.floor(args.offset ?? 1));
    const limit = Math.min(1000, Math.max(1, Math.floor(args.limit ?? 200)));
    const result = await repositoryTools.api.read(args.path, {
        offset: offset - 1,
        limit,
    });
    return result.text
        .split("\n")
        .filter(Boolean)
        .map((line) => `${args.path}:${line.replace("\t", ": ")}`)
        .join("\n");
}

async function grepTool(
    repositoryTools: RepositoryTools,
    args: GrepArgs,
): Promise<string> {
    const result = await repositoryTools.api.grep(args.pattern, args);
    const matches =
        result.matches
            .map((match) => `${match.path}:${match.line}:${match.text}`)
            .join("\n") || "No matches";
    return result.truncated
        ? `${matches}\n[Search results truncated; narrow the pattern or path.]`
        : matches;
}

async function globTool(
    repositoryTools: RepositoryTools,
    args: GlobArgs,
): Promise<string> {
    const matches = await repositoryTools.api.glob(args.pattern, args);
    return matches.join("\n") || "No matches";
}

async function lsTool(
    repositoryTools: RepositoryTools,
    args: LsArgs,
): Promise<string> {
    const matches = await repositoryTools.api.ls(args.path, args);
    return matches.join("\n") || "No matches";
}

async function traced<T>(
    trace: CopilotToolCallTrace[],
    tool: string,
    args: unknown,
    budget: ToolBudget,
    run: () => Promise<T>,
): Promise<T | string> {
    const start = Date.now();
    if (budget.executed >= budget.limit) {
        const output =
            "TOOL_BUDGET_EXHAUSTED: answer now using the evidence already gathered.";
        if (!budget.exhaustedRecorded) {
            trace.push({
                tool,
                args: boundTraceValue(args),
                ok: true,
                durationMs: Date.now() - start,
                output,
            });
            budget.exhaustedRecorded = true;
        }
        return output;
    }
    budget.executed += 1;
    try {
        const value = await run();
        trace.push({
            tool,
            args: boundTraceValue(args),
            ok: true,
            durationMs: Date.now() - start,
            output: String(value).slice(0, MAX_TRACE_OUTPUT),
        });
        return value;
    } catch (error) {
        const message = (error as Error).message;
        trace.push({
            tool,
            args: boundTraceValue(args),
            ok: false,
            durationMs: Date.now() - start,
            output: message.slice(0, MAX_TRACE_OUTPUT),
        });
        throw error;
    }
}

function boundTraceValue(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return value.slice(0, MAX_TRACE_STRING);
    if (
        value === null ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }
    if (depth >= 3) return "[truncated]";
    if (Array.isArray(value)) {
        return value
            .slice(0, 20)
            .map((item) => boundTraceValue(item, depth + 1));
    }
    if (typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .slice(0, 20)
                .map(([key, item]) => [
                    key.slice(0, 100),
                    boundTraceValue(item, depth + 1),
                ]),
        );
    }
    return String(value).slice(0, MAX_TRACE_STRING);
}
