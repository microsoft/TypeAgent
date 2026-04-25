// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// server.ts - MCP server exposing plan-validated proxy tools
//
// Tools exposed:
//   Planning:  get_plan_schema, submit_plan, plan_status, plan_reset
//   Proxy:     validated_read, validated_write, validated_edit,
//              validated_glob, validated_grep, validated_bash
//
// Flow:
//   1. Model reads schema via get_plan_schema (or the create_plan prompt)
//   2. Model generates an AgentPlan JSON and calls submit_plan
//   3. Server validates the plan; if valid, stores it as the active plan
//   4. Model executes steps using validated_* tools
//   5. Each tool call is checked against the current plan step before executing
// ═══════════════════════════════════════════════════════════════════════════

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
    validatePlan,
    checkCircularDependencies,
    flattenPlan,
    checkInputConstraints,
    validatePlanAgainstPolicy,
    checkToolCallAgainstPolicy,
    checkPlanPermission,
    evaluatePostconditions,
    checkDockerAvailability,
    type AgentPlan,
    type OrgPolicy,
    type Tool,
    type ValidationError,
    type ValidationWarning,
    type PolicyViolation,
    type TraceEntry,
    type BindingDeclaration,
} from "validation";
import {
    type PlanState,
    createPlanState,
    resetState,
    abortPlan,
    initTrace,
    appendTraceEntry,
    finalizeTrace,
    TOOL_NAME_MAP,
} from "./planState.js";
import {
    executeRead,
    executeWrite,
    executeEdit,
    executeGlob,
    executeGrep,
    executeBash,
    executeBashInContainer,
    executeNpm,
    executeGit,
    executeNode,
    executeTsc,
} from "./executor.js";

// ─── Resolve spec schema source ────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_SCHEMA_PATH = resolve(
    __dirname,
    "../../validation/src/specSchema.ts",
);

function getSpecSchemaSource(): string {
    return readFileSync(SPEC_SCHEMA_PATH, "utf-8");
}

// ─── Response helpers ──────────────────────────────────────────────────

type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
};

function textResult(text: string): ToolResult {
    return { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolResult {
    return { content: [{ type: "text", text }], isError: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVER FACTORY
// ═══════════════════════════════════════════════════════════════════════════

export function createValidationServer(options?: { policy?: OrgPolicy }): {
    server: McpServer;
    state: PlanState;
} {
    const state = createPlanState(options?.policy);
    const server = new McpServer({
        name: "plan-validation",
        version: "0.1.0",
    });

    // ─── Resource: spec schema ──────────────────────────────────────────

    server.resource("spec-schema", "validation://spec-schema", async (uri) => ({
        contents: [
            {
                uri: uri.href,
                text: getSpecSchemaSource(),
                mimeType: "text/typescript",
            },
        ],
    }));

    // ─── Prompt: create_plan ────────────────────────────────────────────

    server.prompt(
        "create_plan",
        "Generate a validated execution plan for a task",
        {
            task: z.string().describe("The task to plan"),
            working_directory: z
                .string()
                .describe("Absolute path to the working directory")
                .optional(),
        },
        async ({ task, working_directory }) => ({
            messages: [
                {
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: [
                            "Create a structured execution plan for the following task.",
                            "",
                            `Task: ${task}`,
                            working_directory
                                ? `Working Directory: ${working_directory}`
                                : "",
                            "",
                            "Output a JSON object conforming to the AgentPlan interface below.",
                            "After creating the plan, call the submit_plan tool with the JSON string.",
                            "",
                            "=== Spec Schema (TypeScript) ===",
                            "",
                            getSpecSchemaSource(),
                            "",
                            "=== Key Rules ===",
                            "- version must be '1.1'",
                            "- Step indices must be unique, 0-based, and dependencies must reference earlier steps",
                            "- Every binding produced by a step must be declared in the bindings array",
                            "- Tools: Glob, Read, Write, Edit, Grep, Bash, Task, WebFetch, WebSearch, NotebookEdit, TodoWrite, AskUserQuestion",
                            "- limits.maxTotalSteps must be >= actual step count",
                            "- All tools used must appear in metadata.allowedTools",
                            "- permissions.allowedReadPaths/allowedWritePaths must cover all file operations",
                            "- After submitting, use the validated_* MCP tools (validated_read, validated_write, etc.) to execute",
                        ]
                            .filter(Boolean)
                            .join("\n"),
                    },
                },
            ],
        }),
    );

    // ═════════════════════════════════════════════════════════════════════
    // PLANNING TOOLS
    // ═════════════════════════════════════════════════════════════════════

    server.tool(
        "get_plan_schema",
        "Returns the TypeScript spec schema defining the AgentPlan format. Read this before creating a plan.",
        {},
        async () => textResult(getSpecSchemaSource()),
    );

    server.tool(
        "submit_plan",
        "Validate and activate an execution plan. Pass the AgentPlan as a JSON string. " +
            "On success the plan becomes active and you should proceed with validated_* tools.",
        { plan: z.string().describe("AgentPlan JSON string") },
        async ({ plan: planJson }) => {
            // Parse
            let parsed: AgentPlan;
            try {
                parsed = JSON.parse(planJson);
            } catch (e: any) {
                return errorResult(`Invalid JSON: ${e.message}`);
            }

            // Validate
            const result = validatePlan(parsed);
            if (!result.valid) {
                const errorLines = result.errors.map(
                    (e: ValidationError) =>
                        `[${e.phase}]${e.stepIndex !== undefined ? ` step ${e.stepIndex}:` : ""} ${e.message}`,
                );
                const warningLines = result.warnings.map(
                    (w: ValidationWarning) => `[${w.phase}] ${w.message}`,
                );
                return errorResult(
                    [
                        "Plan validation failed:",
                        ...errorLines,
                        ...(warningLines.length
                            ? ["", "Warnings:", ...warningLines]
                            : []),
                        "",
                        "Fix the errors and resubmit.",
                    ].join("\n"),
                );
            }

            // Cycle check
            const cycles = checkCircularDependencies(parsed);
            if (cycles.length > 0) {
                return errorResult(
                    `Circular dependencies detected:\n${cycles.join("\n")}`,
                );
            }

            // Policy check (if org policy is loaded)
            if (state.policy) {
                const policyResult = validatePlanAgainstPolicy(
                    parsed,
                    state.policy,
                );
                if (!policyResult.valid) {
                    const policyErrors = policyResult.errors
                        .map(
                            (e: PolicyViolation) =>
                                `[${e.rule}]${e.stepIndex !== undefined ? ` step ${e.stepIndex}:` : ""} ${e.message}`,
                        )
                        .join("\n");
                    return errorResult(
                        `Plan violates organization policy:\n${policyErrors}\n\nAdjust the plan to comply with policy and resubmit.`,
                    );
                }
            }

            // Activate
            resetState(state);
            state.plan = parsed;
            state.flatSteps = flattenPlan(parsed);
            initTrace(state);

            const warnings =
                result.warnings.length > 0
                    ? `\nWarnings:\n${result.warnings.map((w: ValidationWarning) => `  [${w.phase}] ${w.message}`).join("\n")}`
                    : "";

            return textResult(
                [
                    "Plan validated and activated.",
                    `  Steps: ${state.flatSteps.length}`,
                    `  Tools: ${[...new Set(state.flatSteps.map((s) => s.tool))].join(", ")}`,
                    `  Bindings: ${(parsed.bindings ?? []).map((b: BindingDeclaration) => b.name).join(", ") || "(none)"}`,
                    "",
                    "Proceed by calling validated_* tools in plan order.",
                    ...(state.policy?.container?.enabled
                        ? [
                              "",
                              `NOTE: Bash commands will run inside a Docker container (${state.policy.container.image}).`,
                              `  Network: ${state.policy.container.networkMode}`,
                              `  Working dir inside container: ${state.policy.container.workDir ?? "/workspace"}`,
                              "  Use paths relative to the working directory in bash commands.",
                          ]
                        : []),
                    ...(state.policy?.bash?.mode === "capabilities-only"
                        ? [
                              "",
                              "NOTE: Bash is restricted to capabilities-only mode.",
                              "  Use validated_npm, validated_git, validated_node, validated_tsc instead of validated_bash.",
                          ]
                        : []),
                    warnings,
                ].join("\n"),
            );
        },
    );

    server.tool(
        "plan_status",
        "Returns the current execution state of the active plan",
        {},
        async () => {
            if (!state.plan) {
                return textResult("No active plan.");
            }

            const expected =
                state.currentStep < state.flatSteps.length
                    ? state.flatSteps[state.currentStep]
                    : null;

            return textResult(
                JSON.stringify(
                    {
                        planId: state.plan.id,
                        goal: state.plan.goal,
                        totalSteps: state.flatSteps.length,
                        currentStep: state.currentStep,
                        completedSteps: [...state.completedSteps],
                        aborted: state.aborted,
                        abortReason: state.abortReason,
                        nextExpected: expected
                            ? {
                                  index: expected.index,
                                  tool: expected.tool,
                                  description: expected.description,
                              }
                            : null,
                        bindings: Object.fromEntries(state.bindings),
                    },
                    null,
                    2,
                ),
            );
        },
    );

    server.tool(
        "plan_reset",
        "Clear the active plan. Use after completion or abort to start a new plan.",
        {},
        async () => {
            resetState(state);
            return textResult("Plan cleared. Submit a new plan to continue.");
        },
    );

    server.tool(
        "plan_trace",
        "Returns the execution trace — a hash-chained audit log of every tool call, " +
            "with timing, inputs, outputs, and status. Available during and after execution.",
        {},
        async () => {
            if (!state.trace) {
                return textResult(
                    "No trace available. Submit and execute a plan first.",
                );
            }
            return textResult(
                JSON.stringify(
                    {
                        planId: state.trace.planId,
                        status: state.trace.status,
                        startedAt: new Date(
                            state.trace.startedAt,
                        ).toISOString(),
                        completedAt: state.trace.completedAt
                            ? new Date(state.trace.completedAt).toISOString()
                            : null,
                        entryCount: state.trace.entries.length,
                        entries: state.trace.entries.map((e: TraceEntry) => ({
                            index: e.index,
                            stepIndex: e.stepIndex,
                            tool: e.tool,
                            status: e.status,
                            durationMs: e.durationMs,
                            hash: e.hash.slice(0, 16) + "...",
                            previousHash: e.previousHash.slice(0, 16) + "...",
                            error: e.error ?? null,
                        })),
                        metrics: state.trace.metrics,
                        chainValid: verifyTraceChain(state.trace),
                    },
                    null,
                    2,
                ),
            );
        },
    );

    server.tool(
        "container_status",
        "Check if Docker is available and report the container sandbox configuration.",
        {},
        async () => {
            const docker = checkDockerAvailability();
            const containerPolicy = state.policy?.container;

            const info: Record<string, unknown> = {
                dockerAvailable: docker.available,
                dockerVersion: docker.version ?? null,
                dockerError: docker.error ?? null,
                containerEnabled: containerPolicy?.enabled ?? false,
            };

            if (containerPolicy?.enabled) {
                info.image = containerPolicy.image;
                info.networkMode = containerPolicy.networkMode;
                info.readOnly = containerPolicy.readOnly ?? false;
                info.memoryLimit = containerPolicy.memoryLimit ?? "unlimited";
                info.cpuLimit = containerPolicy.cpuLimit ?? "unlimited";
                info.pidsLimit = containerPolicy.pidsLimit ?? "unlimited";
                info.deriveVolumesFromPolicy =
                    containerPolicy.deriveVolumesFromPolicy ?? false;
                info.workDir = containerPolicy.workDir ?? "/workspace";
                info.note =
                    "Bash commands will run inside this container. " +
                    "Paths inside the container differ from host paths — the working directory is mounted at " +
                    (containerPolicy.workDir ?? "/workspace") +
                    ".";
            }

            return textResult(JSON.stringify(info, null, 2));
        },
    );

    // ═════════════════════════════════════════════════════════════════════
    // VALIDATION WRAPPER
    // ═════════════════════════════════════════════════════════════════════

    /**
     * Wraps a tool execution with plan validation.
     *
     * Before executing:
     *   - Checks that a plan is active and not aborted
     *   - Verifies the tool name matches the expected plan step
     *   - Validates input parameters against the step's InputSpec
     *   - Confirms all declared dependencies have completed
     *
     * After executing:
     *   - Captures output into bindings if the step has a 'produces' effect
     *   - Marks the step complete and advances the counter
     */
    async function withValidation(
        mcpToolName: string,
        input: Record<string, unknown>,
        execute: () => Promise<string>,
    ): Promise<ToolResult> {
        // Guard: plan active?
        if (!state.plan) {
            return errorResult("No active plan. Call submit_plan first.");
        }
        if (state.aborted) {
            return errorResult(
                `Plan aborted: ${state.abortReason}\nCall plan_reset to start over.`,
            );
        }
        if (state.currentStep >= state.flatSteps.length) {
            return errorResult(
                "All plan steps completed. No more tool calls expected.",
            );
        }

        const expected = state.flatSteps[state.currentStep];
        const planToolName = TOOL_NAME_MAP[mcpToolName];

        // Check: correct tool?
        if (expected.tool !== planToolName) {
            abortPlan(
                state,
                `Expected tool '${expected.tool}' at step ${state.currentStep}, got '${planToolName}'`,
            );
            return errorResult(`Plan violation: ${state.abortReason}`);
        }

        // Check: input constraints satisfied?
        const constraintResult = checkInputConstraints(
            input,
            expected.inputSpec,
            state.bindings,
        );
        if (!constraintResult.valid) {
            abortPlan(
                state,
                `Input constraint violated at step ${state.currentStep}: ${constraintResult.reason}`,
            );
            return errorResult(`Plan violation: ${state.abortReason}`);
        }

        // Check: dependencies met?
        for (const dep of expected.dependsOn) {
            if (!state.completedSteps.has(dep)) {
                abortPlan(
                    state,
                    `Step ${state.currentStep} depends on step ${dep} which hasn't completed`,
                );
                return errorResult(`Plan violation: ${state.abortReason}`);
            }
        }

        // Check: org policy allows this call?
        // Policy violations block but do NOT abort — model can adjust and retry.
        if (state.policy) {
            const policyViolation = checkToolCallAgainstPolicy(
                planToolName,
                input,
                state.policy,
            );
            if (policyViolation) {
                return errorResult(
                    `Policy violation: [${policyViolation.rule}] ${policyViolation.message}`,
                );
            }
        }

        // Check: plan's own permissions allow this path?
        // (Separate from org policy — these are the model's declared permissions.)
        if (state.plan.permissions) {
            const perms = state.plan.permissions;
            const READ_TOOLS: Tool[] = ["Read", "Grep", "Glob"];
            const WRITE_TOOLS: Tool[] = ["Write", "Edit"];

            if (READ_TOOLS.includes(planToolName)) {
                const filePath = (input.file_path ?? input.path) as
                    | string
                    | undefined;
                if (filePath) {
                    const permResult = checkPlanPermission(
                        filePath,
                        "read",
                        perms.allowedReadPaths,
                        perms.allowedWritePaths,
                        perms.deniedPaths,
                    );
                    if (!permResult.allowed) {
                        return errorResult(
                            `Plan permission denied: ${permResult.reason}`,
                        );
                    }
                }
            }
            if (WRITE_TOOLS.includes(planToolName)) {
                const filePath = input.file_path as string | undefined;
                if (filePath) {
                    const permResult = checkPlanPermission(
                        filePath,
                        "write",
                        perms.allowedReadPaths,
                        perms.allowedWritePaths,
                        perms.deniedPaths,
                    );
                    if (!permResult.allowed) {
                        return errorResult(
                            `Plan permission denied: ${permResult.reason}`,
                        );
                    }
                }
            }
        }

        // Execute the actual operation (with timing for trace)
        const startTime = Date.now();
        let result: string;
        try {
            result = await execute();
        } catch (err: any) {
            const durationMs = Date.now() - startTime;
            appendTraceEntry(
                state,
                expected.index,
                planToolName,
                input,
                null,
                durationMs,
                "failed",
                err.message,
            );
            return errorResult(`Tool execution error: ${err.message}`);
        }
        const durationMs = Date.now() - startTime;

        // Record successful trace entry
        appendTraceEntry(
            state,
            expected.index,
            planToolName,
            input,
            result,
            durationMs,
            "success",
        );

        // Capture bindings
        if (expected.effect.type === "produces") {
            state.bindings.set(expected.effect.bind, result);
        }

        // Advance plan state
        state.completedSteps.add(expected.index);
        state.currentStep++;

        const remaining = state.flatSteps.length - state.currentStep;

        // If all steps are done and postconditions are declared, evaluate them
        let postconditionReport = "";
        if (
            remaining === 0 &&
            state.plan.postconditions &&
            state.plan.postconditions.length > 0
        ) {
            const evalResult = evaluatePostconditions(
                state.plan.postconditions,
                {
                    bindings: state.bindings,
                    completedSteps: state.completedSteps,
                },
            );

            const lines: string[] = ["\n[Postcondition evaluation:]"];
            for (const r of evalResult.results) {
                const icon =
                    r.result.status === "pass"
                        ? "PASS"
                        : r.result.status === "fail"
                          ? "FAIL"
                          : r.result.status === "unsupported"
                            ? "SKIP"
                            : "ERR";
                const msg =
                    r.result.status === "pass"
                        ? ""
                        : `: ${"message" in r.result ? r.result.message : ""}`;
                lines.push(
                    `  [${icon}] postcondition[${r.index}] (${r.predicate.type})${msg}`,
                );
            }

            if (!evalResult.allPassed) {
                const failCount = evalResult.results.filter(
                    (r: { result: { status: string } }) =>
                        r.result.status === "fail",
                ).length;
                lines.push(`  ${failCount} postcondition(s) FAILED.`);
            } else {
                lines.push(`  All postconditions passed.`);
            }
            postconditionReport = lines.join("\n");
        }

        // Finalize trace when all steps complete
        if (remaining === 0) {
            finalizeTrace(state);
        }

        const progress =
            remaining > 0
                ? `\n[Step ${expected.index} complete. ${remaining} remaining.]`
                : `\n[All ${state.flatSteps.length} steps complete.]${postconditionReport}`;

        return textResult(result + progress);
    }

    // ═════════════════════════════════════════════════════════════════════
    // VALIDATED PROXY TOOLS
    // ═════════════════════════════════════════════════════════════════════

    server.tool(
        "validated_read",
        "Read a file (validated against the active plan)",
        {
            file_path: z.string().describe("Absolute path to the file"),
            offset: z
                .number()
                .optional()
                .describe("Line number to start from (0-based)"),
            limit: z
                .number()
                .optional()
                .describe("Maximum number of lines to read"),
        },
        async (args) =>
            withValidation("validated_read", args, async () =>
                executeRead(args.file_path, args.offset, args.limit),
            ),
    );

    server.tool(
        "validated_write",
        "Create or overwrite a file (validated against the active plan)",
        {
            file_path: z.string().describe("Absolute path to the file"),
            content: z.string().describe("File content to write"),
        },
        async (args) =>
            withValidation("validated_write", args, async () =>
                executeWrite(args.file_path, args.content),
            ),
    );

    server.tool(
        "validated_edit",
        "Edit a file via exact string replacement (validated against the active plan)",
        {
            file_path: z.string().describe("Absolute path to the file"),
            old_string: z
                .string()
                .describe("Exact string to find (must be unique in file)"),
            new_string: z.string().describe("Replacement string"),
        },
        async (args) =>
            withValidation("validated_edit", args, async () =>
                executeEdit(args.file_path, args.old_string, args.new_string),
            ),
    );

    server.tool(
        "validated_glob",
        "Find files by glob pattern (validated against the active plan)",
        {
            pattern: z.string().describe("Glob pattern (e.g. '**/*.ts')"),
            path: z.string().optional().describe("Directory to search in"),
        },
        async (args) =>
            withValidation("validated_glob", args, async () =>
                executeGlob(args.pattern, args.path),
            ),
    );

    server.tool(
        "validated_grep",
        "Search file contents with regex (validated against the active plan)",
        {
            pattern: z.string().describe("Regex pattern to search for"),
            path: z.string().optional().describe("Directory to search in"),
            include: z
                .string()
                .optional()
                .describe("Glob pattern to filter files (e.g. '**/*.ts')"),
        },
        async (args) =>
            withValidation("validated_grep", args, async () =>
                executeGrep(args.pattern, args.path, args.include),
            ),
    );

    server.tool(
        "validated_bash",
        "Execute a shell command (validated against the active plan). " +
            "May be restricted by policy — use validated_npm/git/node/tsc for safe alternatives.",
        {
            command: z.string().describe("Shell command to execute"),
            cwd: z.string().optional().describe("Working directory"),
            timeout: z
                .number()
                .optional()
                .describe("Timeout in milliseconds (default 30000)"),
        },
        async (args) => {
            // Check capabilities-only mode
            const bashMode = state.policy?.bash?.mode ?? "policy-checked";
            if (bashMode === "capabilities-only") {
                return errorResult(
                    "Bash is restricted to capabilities-only mode by organization policy. " +
                        "Use validated_npm, validated_git, validated_node, or validated_tsc instead.",
                );
            }

            // Enforce policy timeout cap
            const policyMaxTimeout = state.policy?.bash?.maxTimeoutMs;
            const requestedTimeout = args.timeout ?? 30000;
            const effectiveTimeout = policyMaxTimeout
                ? Math.min(requestedTimeout, policyMaxTimeout)
                : requestedTimeout;

            // Container routing: if container policy is enabled, run inside Docker
            const containerPolicy = state.policy?.container;
            if (containerPolicy?.enabled) {
                const cwd = args.cwd ?? process.cwd();
                const pathPolicy = state.policy?.paths;
                const networkPolicy = state.policy?.bash?.network;
                return withValidation("validated_bash", args, async () =>
                    executeBashInContainer(
                        args.command,
                        cwd,
                        containerPolicy,
                        pathPolicy,
                        networkPolicy,
                    ),
                );
            }

            return withValidation("validated_bash", args, async () =>
                executeBash(args.command, args.cwd, effectiveTimeout),
            );
        },
    );

    // ═════════════════════════════════════════════════════════════════════
    // CAPABILITY TOOLS (structured, no shell injection)
    // ═════════════════════════════════════════════════════════════════════

    server.tool(
        "validated_npm",
        "Run an npm command (structured, no shell injection)",
        {
            subcommand: z
                .string()
                .describe(
                    "npm subcommand (install, test, run, build, add, remove, etc.)",
                ),
            args: z.string().optional().describe("Additional arguments"),
            cwd: z.string().optional().describe("Working directory"),
        },
        async (args) =>
            withValidation("validated_npm", args, async () =>
                executeNpm(args.subcommand, args.args, args.cwd),
            ),
    );

    server.tool(
        "validated_git",
        "Run a git command (structured, no shell injection)",
        {
            subcommand: z
                .string()
                .describe(
                    "git subcommand (status, add, commit, diff, log, push, pull, checkout, branch, etc.)",
                ),
            args: z.string().optional().describe("Additional arguments"),
            cwd: z.string().optional().describe("Working directory"),
        },
        async (args) =>
            withValidation("validated_git", args, async () =>
                executeGit(args.subcommand, args.args, args.cwd),
            ),
    );

    server.tool(
        "validated_node",
        "Run a Node.js script file (structured, no shell injection — does not accept -e/-c)",
        {
            scriptPath: z
                .string()
                .describe("Path to the .js/.mjs/.ts script file"),
            args: z
                .string()
                .optional()
                .describe("Arguments to pass to the script"),
            cwd: z.string().optional().describe("Working directory"),
        },
        async (args) =>
            withValidation("validated_node", args, async () =>
                executeNode(args.scriptPath, args.args, args.cwd),
            ),
    );

    server.tool(
        "validated_tsc",
        "Run the TypeScript compiler (structured, no shell injection)",
        {
            args: z
                .string()
                .optional()
                .describe(
                    "Compiler arguments (e.g., '--noEmit', '-p tsconfig.json')",
                ),
            cwd: z.string().optional().describe("Working directory"),
        },
        async (args) =>
            withValidation("validated_tsc", args, async () =>
                executeTsc(args.args, args.cwd),
            ),
    );

    return { server, state };
}

/** Verify that a trace's hash chain is intact (no entries tampered with). */
function verifyTraceChain(trace: {
    entries: Array<{
        previousHash: string;
        hash: string;
        stepIndex: number;
        tool?: string;
        input: Record<string, unknown>;
        output?: unknown;
        durationMs: number;
        status: string;
        error?: string;
    }>;
}): boolean {
    for (let i = 0; i < trace.entries.length; i++) {
        const entry = trace.entries[i];
        const expectedPrev =
            i === 0
                ? "0000000000000000000000000000000000000000000000000000000000000000"
                : trace.entries[i - 1].hash;
        if (entry.previousHash !== expectedPrev) return false;

        // Re-compute hash
        const entryData = JSON.stringify({
            previousHash: entry.previousHash,
            stepIndex: entry.stepIndex,
            tool: entry.tool,
            input: entry.input,
            output:
                typeof entry.output === "string"
                    ? entry.output.slice(0, 1000)
                    : entry.output,
            durationMs: entry.durationMs,
            status: entry.status,
            error: entry.error,
        });
        const computed = createHash("sha256").update(entryData).digest("hex");
        if (entry.hash !== computed) return false;
    }
    return true;
}
