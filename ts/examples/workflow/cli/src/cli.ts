#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
    WorkflowIR,
    TaskPolicy,
    ApprovalFn,
    ApprovalResult,
    validateWorkflowIR,
} from "workflow-model";
import {
    TaskRegistry,
    WorkflowEngine,
    RunOptions,
    allBuiltinTasks,
} from "workflow-engine";

const usage = `Usage:
  workflow run <file.json> [--input <json>] [--dry-run | --allow-all]   Run a workflow
  workflow validate <file.json>                                        Validate a workflow
  workflow list-tasks                                                  List registered tasks

Options:
  --dry-run     Deny all side-effecting tasks (shell, network, file, LLM)
                without prompting. Useful for testing workflow structure.
  --allow-all   Allow all tasks without prompting. Use for scripted/CI runs
                where you trust the workflow.`;

function fail(msg: string): never {
    console.error(msg);
    process.exit(1);
}

function loadIR(filePath: string): WorkflowIR {
    const abs = resolve(filePath);
    let raw: string;
    try {
        raw = readFileSync(abs, "utf8");
    } catch {
        fail(`Cannot read file: ${abs}`);
    }
    try {
        return JSON.parse(raw) as WorkflowIR;
    } catch {
        fail(`Invalid JSON in: ${abs}`);
    }
}

function makeEngine(): WorkflowEngine {
    const reg = new TaskRegistry();
    for (const task of allBuiltinTasks) {
        reg.register(task);
    }
    return new WorkflowEngine(reg);
}

async function cmdRun(
    file: string,
    inputJson?: string,
    mode?: "dry-run" | "allow-all",
): Promise<void> {
    const ir = loadIR(file);
    const input = inputJson ? JSON.parse(inputJson) : {};
    const engine = makeEngine();

    engine.on((event) => {
        switch (event.type) {
            case "nodeStarted":
                console.error(`[node] ${event.nodeId}`);
                break;
            case "nodeCompleted":
                console.error(`[done] ${event.nodeId}`);
                break;
            case "nodeFailed":
                console.error(`[fail] ${event.nodeId}: ${event.error.message}`);
                break;
            case "loopIterationStarted":
                console.error(
                    `[loop] ${event.nodeId} iteration ${event.iteration}`,
                );
                break;
        }
    });

    // Build policy based on mode.
    let policy: TaskPolicy | undefined;
    let approve: ApprovalFn | undefined;

    if (mode === "dry-run") {
        policy = {};
        for (const task of allBuiltinTasks) {
            if (task.sideEffects) {
                policy[task.name] = "deny";
            }
        }
        console.error("[dry-run] Side-effecting tasks will be denied.");
    } else if (mode === "allow-all") {
        // Explicitly allow all side-effecting tasks.
        policy = {};
        for (const task of allBuiltinTasks) {
            if (task.sideEffects) {
                policy[task.name] = "allow";
            }
        }
    } else {
        // Interactive approval via readline (30s timeout)
        const APPROVAL_TIMEOUT_MS = 30_000;
        approve = async (
            taskName: string,
            inputs: unknown,
        ): Promise<ApprovalResult> => {
            const summary = JSON.stringify(inputs, null, 2)
                .split("\n")
                .slice(0, 10)
                .join("\n");
            const rl = createInterface({
                input: process.stdin,
                output: process.stderr,
            });
            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    rl.close();
                    console.error(
                        `[timeout] Approval for "${taskName}" timed out after ${APPROVAL_TIMEOUT_MS / 1000}s`,
                    );
                    resolve({ kind: "timed-out" });
                }, APPROVAL_TIMEOUT_MS);
                rl.question(
                    `\n[approve] Task "${taskName}" wants to execute with:\n${summary}\nAllow? (y/N) `,
                    (answer) => {
                        clearTimeout(timer);
                        rl.close();
                        const yes =
                            answer.trim().toLowerCase() === "y" ||
                            answer.trim().toLowerCase() === "yes";
                        resolve(
                            yes ? { kind: "approved" } : { kind: "denied" },
                        );
                    },
                );
            });
        };
    }

    const opts: RunOptions = {
        input,
        ...(policy ? { policy } : {}),
        ...(approve ? { approve } : {}),
    };
    const result = await engine.run(ir, opts);
    if (result.success) {
        console.log(JSON.stringify(result.output, null, 2));
    } else {
        const prefix = result.error?.message?.startsWith("Validation failed")
            ? "[validation]"
            : "[runtime]";
        console.error(
            `${prefix} Workflow failed: ${result.error?.message ?? "unknown error"}`,
        );
        process.exit(1);
    }
}

async function cmdValidate(file: string): Promise<void> {
    const ir = loadIR(file);
    const reg = new TaskRegistry();
    for (const task of allBuiltinTasks) {
        reg.register(task);
    }
    const result = validateWorkflowIR(ir, reg.all());
    if (result.valid) {
        console.log("Valid.");
    } else {
        const msgs = result.errors.map((e) => `  ${e.path}: ${e.message}`);
        console.error(`[validation] Validation failed:\n${msgs.join("\n")}`);
        process.exit(1);
    }
}

function cmdListTasks(): void {
    const reg = new TaskRegistry();
    for (const task of allBuiltinTasks) {
        reg.register(task);
    }
    for (const task of allBuiltinTasks) {
        console.log(`${task.name}`);
        if (task.inputSchema) {
            const props = (task.inputSchema as any).properties ?? {};
            const required = (task.inputSchema as any).required ?? [];
            const fields = Object.keys(props)
                .map((k) => {
                    const req = required.includes(k) ? "" : "?";
                    const type = props[k].type ?? "any";
                    return `${k}${req}: ${type}`;
                })
                .join(", ");
            if (fields) {
                console.log(`  input:  { ${fields} }`);
            }
        }
        if (task.outputSchema) {
            const props = (task.outputSchema as any).properties ?? {};
            const fields = Object.keys(props)
                .map((k) => {
                    const type = props[k].type ?? "any";
                    return `${k}: ${type}`;
                })
                .join(", ");
            if (fields) {
                console.log(`  output: { ${fields} }`);
            }
        }
        console.log();
    }
}

// --- Argument parsing ---

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case "run": {
        const file = args[1];
        if (!file) fail(usage);
        const inputIdx = args.indexOf("--input");
        const inputJson = inputIdx >= 0 ? args[inputIdx + 1] : undefined;
        const mode = args.includes("--dry-run")
            ? "dry-run"
            : args.includes("--allow-all")
              ? "allow-all"
              : undefined;
        await cmdRun(file, inputJson, mode);
        break;
    }
    case "validate": {
        const file = args[1];
        if (!file) fail(usage);
        await cmdValidate(file);
        break;
    }
    case "list-tasks":
        cmdListTasks();
        break;
    default:
        console.log(usage);
        break;
}
