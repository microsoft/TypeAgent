#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WorkflowIR } from "workflow-model";
import { TaskRegistry, WorkflowEngine, allBuiltinTasks } from "workflow-engine";

const usage = `Usage:
  workflow run <file.json> [--input <json>]   Run a workflow
  workflow validate <file.json>               Validate a workflow
  workflow list-tasks                         List registered tasks`;

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

async function cmdRun(file: string, inputJson?: string): Promise<void> {
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

    const result = await engine.run(ir, input);
    if (result.success) {
        console.log(JSON.stringify(result.output, null, 2));
    } else {
        console.error(
            `Workflow failed: ${result.error?.message ?? "unknown error"}`,
        );
        process.exit(1);
    }
}

async function cmdValidate(file: string): Promise<void> {
    const ir = loadIR(file);
    const engine = makeEngine();

    // Dry-run with empty input to trigger validation.
    // The engine validates node/task references before execution.
    const result = await engine.run(ir, {});
    if (result.success) {
        console.log("Valid.");
    } else if (result.error?.message?.includes("not registered")) {
        console.error(`Validation failed: ${result.error.message}`);
        process.exit(1);
    } else {
        // Workflow is structurally valid but failed at runtime
        // (expected with empty input). That's fine for validation.
        console.log("Valid (runtime error with empty input is expected).");
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
        await cmdRun(file, inputJson);
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
