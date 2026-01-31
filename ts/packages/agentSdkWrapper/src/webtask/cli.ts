#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { config } from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");
config({ path: path.join(repoRoot, ".env") });

import { WebTaskAgent } from "./webTaskAgent.js";
import { TaskLoader } from "./taskLoader.js";
import { TaskExecutionResult } from "./types.js";

/**
 * CLI options
 */
interface CliOptions {
    taskFile: string;
    categories?: string[] | undefined;
    difficulties?: string[] | undefined;
    limit?: number | undefined;
    taskIds?: string[] | undefined;
    model: string;
    output?: string | undefined;
    collectTraces?: boolean | undefined;
    traceDir?: string | undefined;
    noHtml?: boolean | undefined;
    noScreenshots?: boolean | undefined;
    usePlanning?: boolean | undefined;
    planDetailLevel?: "minimal" | "standard" | "detailed" | undefined;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliOptions {
    const args = process.argv.slice(2);

    // First positional argument is the task file (required)
    if (args.length === 0 || args[0].startsWith("-")) {
        console.error("Error: Task file is required as first argument\n");
        printUsage();
        process.exit(1);
    }

    const taskFile = args[0];
    let categories: string[] | undefined;
    let difficulties: string[] | undefined;
    let limit: number | undefined;
    let taskIds: string[] | undefined;
    let model = "claude-sonnet-4-5-20250929";
    let output: string | undefined;
    let collectTraces: boolean | undefined;
    let traceDir: string | undefined;
    let noHtml: boolean | undefined;
    let noScreenshots: boolean | undefined;
    let usePlanning: boolean | undefined;
    let planDetailLevel: "minimal" | "standard" | "detailed" | undefined;

    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "--categories":
            case "-c":
                categories = args[++i]?.split(",");
                break;
            case "--difficulties":
            case "-d":
                difficulties = args[++i]?.split(",");
                break;
            case "--limit":
            case "-l":
                limit = parseInt(args[++i]);
                break;
            case "--tasks":
            case "-t":
                taskIds = args[++i]?.split(",");
                break;
            case "--model":
            case "-m":
                const modelArg = args[++i]?.toLowerCase();
                if (modelArg === "sonnet") {
                    model = "claude-sonnet-4-5-20250929";
                } else if (modelArg === "opus") {
                    model = "claude-opus-4-5-20251101";
                } else {
                    model = args[i];
                }
                break;
            case "--output":
            case "-o":
                output = args[++i];
                break;
            case "--collect-traces":
                collectTraces = true;
                break;
            case "--trace-dir":
                traceDir = args[++i];
                break;
            case "--no-html":
                noHtml = true;
                break;
            case "--no-screenshots":
                noScreenshots = true;
                break;
            case "--use-planning":
                usePlanning = true;
                break;
            case "--plan-detail":
                const detailArg = args[++i]?.toLowerCase();
                if (detailArg === "minimal" || detailArg === "standard" || detailArg === "detailed") {
                    planDetailLevel = detailArg;
                } else {
                    planDetailLevel = "standard";
                }
                break;
            case "--help":
            case "-h":
                printUsage();
                process.exit(0);
        }
    }

    return {
        taskFile,
        categories,
        difficulties,
        limit,
        taskIds,
        model,
        output,
        collectTraces,
        traceDir,
        noHtml,
        noScreenshots,
        usePlanning,
        planDetailLevel,
    };
}

/**
 * Print usage information
 */
function printUsage(): void {
    console.log(`
WebTask Executor - Generic browser automation with subagents

Usage: pnpm run webtask <taskfile> [options]

Arguments:
  <taskfile>                Path to JSON task file

Options:
  -c, --categories <list>   Comma-separated categories (READ,CREATE,DELETE,UPDATE,etc.)
  -d, --difficulties <list> Comma-separated difficulties (easy,medium,hard)
  -l, --limit <n>           Limit number of tasks to execute
  -t, --tasks <list>        Comma-separated task IDs to execute
  -m, --model <name>        Model to use (sonnet|opus, default: sonnet)
  -o, --output <path>       Output file for results (JSON)
  -h, --help                Show this help message

Trace Collection:
  --collect-traces          Enable trace collection (captures execution steps)
  --trace-dir <path>        Directory for traces (default: ./traces)
  --no-html                 Skip HTML capture (saves space)
  --no-screenshots          Skip screenshot capture

Explicit Planning (Experimental):
  --use-planning            Enable explicit planning before execution
  --plan-detail <level>     Plan detail level: minimal|standard|detailed (default: standard)

Examples:
  pnpm run webtask tasks/webbench.json --categories READ --limit 5
  pnpm run webtask tasks/webarena.json --tasks wa-001,wa-002 --output results.json
  pnpm run webtask tasks/custom.json --difficulties easy --limit 10

  # With trace collection
  pnpm run webtask tasks/webbench.json --categories READ --limit 3 --collect-traces
  pnpm run webtask tasks/webbench.json --tasks wb-002 --collect-traces --trace-dir ./my-traces

  # With explicit planning (generates and learns from execution plans)
  pnpm run webtask tasks/webbench.json --tasks wb-001 --use-planning --collect-traces
  pnpm run webtask tasks/webbench.json --categories CREATE --limit 2 --use-planning --plan-detail detailed

Task File Format:
  {
    "metadata": {
      "benchmark": "webbench",
      "version": "1.0",
      "totalTasks": 100
    },
    "tasks": [
      {
        "id": "wb-001",
        "description": "Task description in natural language",
        "startingUrl": "https://example.com",
        "category": "READ",
        "difficulty": "easy",
        "metadata": { "domain": "example.com" }
      }
    ]
  }

Prerequisites:
  1. TypeAgent dispatcher running (pnpm run typeagent)
  2. Browser with TypeAgent extension open and connected
  3. Claude Code SSO authentication (no API key needed)
`);
}

/**
 * Calculate metrics from results
 */
interface WebTaskMetrics {
    totalTasks: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgDuration: number;
    medianDuration: number;
    p95Duration: number;
    byCategory: Record<string, any>;
    byDifficulty: Record<string, any>;
}

function calculateMetrics(results: TaskExecutionResult[]): WebTaskMetrics {
    const successCount = results.filter((r) => r.success).length;
    const durations = results.map((r) => r.duration);
    durations.sort((a, b) => a - b);

    const metrics: WebTaskMetrics = {
        totalTasks: results.length,
        successCount: successCount,
        failureCount: results.length - successCount,
        successRate: successCount / results.length,
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        medianDuration: durations[Math.floor(durations.length / 2)],
        p95Duration: durations[Math.floor(durations.length * 0.95)],
        byCategory: {},
        byDifficulty: {},
    };

    return metrics;
}

/**
 * Print results summary
 */
function printResults(results: TaskExecutionResult[]): void {
    const metrics = calculateMetrics(results);

    console.log(`\n=== WebTask Execution Results ===`);
    console.log(`\nTotal Tasks: ${metrics.totalTasks}`);
    console.log(`Success: ${metrics.successCount} (${(metrics.successRate * 100).toFixed(1)}%)`);
    console.log(`Failure: ${metrics.failureCount}`);
    console.log(`\nPerformance:`);
    console.log(`  Avg Duration: ${(metrics.avgDuration / 1000).toFixed(2)}s`);
    console.log(`  Median Duration: ${(metrics.medianDuration / 1000).toFixed(2)}s`);
    console.log(`  P95 Duration: ${(metrics.p95Duration / 1000).toFixed(2)}s`);

    console.log(`\nIndividual Results:`);
    for (const result of results) {
        const status = result.success ? "✓" : "✗";
        console.log(`  ${status} Task ${result.taskId}: ${(result.duration / 1000).toFixed(2)}s`);
        if (result.error) {
            console.log(`    Error: ${result.error}`);
        }
    }
}

/**
 * Main CLI entry point
 */
async function main() {
    const options = parseArgs();

    console.log(`=== WebTask Executor ===`);
    console.log(`Model: ${options.model}`);
    console.log(`SSO Authentication: Enabled (no API key needed)\n`);

    // Load tasks from JSON
    console.log(`Loading tasks from: ${options.taskFile}`);
    const loader = new TaskLoader();
    await loader.loadFromJSON(options.taskFile);

    // Build filter object with only defined properties
    const filter: any = {};
    if (options.categories) filter.categories = options.categories;
    if (options.difficulties) filter.difficulties = options.difficulties;
    if (options.taskIds) filter.taskIds = options.taskIds;
    if (options.limit !== undefined) filter.limit = options.limit;

    const tasks = loader.getTasks(filter);

    if (tasks.length === 0) {
        console.error("No tasks loaded. Check filters or JSON file.");
        process.exit(1);
    }

    // Print task summary
    const stats = loader.getStatistics();
    console.log(`\n=== Task Summary ===`);
    console.log(`Benchmark: ${stats.benchmark || "custom"}`);
    console.log(`Total tasks loaded: ${stats.total}`);
    console.log(`Tasks to execute: ${tasks.length}`);
    console.log(`\nBy Category:`);
    for (const [category, count] of Object.entries(stats.byCategory)) {
        console.log(`  ${category}: ${count}`);
    }
    console.log(`\nBy Difficulty:`);
    for (const [difficulty, count] of Object.entries(stats.byDifficulty)) {
        console.log(`  ${difficulty}: ${count}`);
    }

    // Confirm execution
    console.log(`\n⚠ About to execute ${tasks.length} tasks with subagents`);
    console.log(`Make sure:`);
    console.log(`  1. TypeAgent dispatcher is running`);
    console.log(`  2. Browser with TypeAgent extension is open`);
    console.log(`  3. Extension shows "Connected" status\n`);

    // Get current file path for commandExecutor
    const currentDir = path.dirname(__filename);
    const commandExecutorPath = path.resolve(
        currentDir,
        "../../../commandExecutor/dist/server.js",
    );

    // Create WebTask agent
    const agent = new WebTaskAgent({
        systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append:
                "# WebTask Browser Automation\n\n" +
                "You are executing web automation tasks using subagents.\n" +
                "Launch subagents via the Task tool to autonomously execute browser operations.\n" +
                "Subagents have access to browser automation tools via the command-executor MCP server.\n" +
                "They can analyze HTML naturally using inherited SSO authentication.",
        },
        model: options.model,
        permissionMode: "acceptEdits",
        allowedTools: [
            "Task",
            "mcp__command-executor__*",
        ],
        cwd: process.cwd(),
        settingSources: ["project"],
        maxTurns: 30,
        mcpServers: {
            "command-executor": {
                command: "node",
                args: [commandExecutorPath],
            },
        },
    });

    // Prepare execution options
    const execOptions = {
        collectTraces: options.collectTraces,
        traceDir: options.traceDir,
        captureHTML: !options.noHtml,
        captureScreenshots: options.collectTraces && !options.noScreenshots,
        usePlanning: options.usePlanning,
        planDetailLevel: options.planDetailLevel,
    };

    // Execute tasks
    const results = await agent.executeTasks(tasks, execOptions);

    // Print results
    printResults(results);

    // Save to file if requested
    if (options.output) {
        const output = {
            timestamp: new Date().toISOString(),
            model: options.model,
            metadata: loader.getMetadata(),
            tasks: tasks,
            results: results,
            metrics: calculateMetrics(results),
        };

        fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
        console.log(`\nResults saved to: ${options.output}`);
    }
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
