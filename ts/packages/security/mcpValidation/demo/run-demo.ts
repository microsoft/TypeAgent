// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// demo/run-demo.ts — Self-contained demo that runs a scenario and serves
//                     a live dashboard showing everything that happens
//
// Usage:
//   npx tsx demo/run-demo.ts
//   # Opens http://localhost:3100 with the dashboard
//   # Runs a demo scenario showing plan submission, execution, policy
//   # violations, postcondition checks, and the audit trace
//
// No MCP client or API key needed — the scenario is simulated in-process.
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from "node:http";
import {
    readFileSync,
    writeFileSync,
    mkdirSync,
    existsSync,
    cpSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    validatePlan,
    checkCircularDependencies,
    flattenPlan,
    checkInputConstraints,
    checkToolCallAgainstPolicy,
    checkDockerAvailability,
    type AgentPlan,
    type OrgPolicy,
} from "validation";
import { createValidationServer } from "../src/server.js";
import {
    initTrace,
    appendTraceEntry,
    finalizeTrace,
} from "../src/planState.js";
import { executeRead, executeEdit } from "../src/executor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DEMO_PORT ?? "3100", 10);

// ─── Demo policy ───────────────────────────────────────────────────────

const DEMO_POLICY: OrgPolicy = {
    version: "1.0",
    name: "demo-corporate-policy",
    deniedTools: ["WebFetch", "WebSearch"],
    paths: {
        allowedReadPatterns: ["{{workDir}}/**"],
        allowedWritePatterns: ["{{workDir}}/**"],
        deniedPatterns: ["**/.env", "**/.env.*", "**/secrets/**", "**/*.key"],
    },
    bash: {
        mode: "capabilities-only",
        deniedCommands: ["curl", "wget", "ssh", "nc"],
        network: { denyAll: true },
    },
    limitCaps: {
        maxTotalSteps: 30,
        maxDurationMs: 300000,
        maxFileWrites: 10,
        maxBytesWritten: 524288,
    },
};

// ─── Demo plan ─────────────────────────────────────────────────────────

function createDemoPlan(workDir: string): AgentPlan {
    const cssPath = join(workDir, "style.css").replace(/\\/g, "/");
    return {
        version: "1.1",
        id: "demo-dark-theme",
        goal: "Update style.css to use a dark theme with dark background and light text",
        steps: [
            {
                nodeType: "step",
                index: 0,
                tool: "Read",
                description: "Read the current CSS file",
                inputSpec: { file_path: { type: "exact", value: cssPath } },
                dependsOn: [],
                effect: {
                    type: "produces",
                    bind: "cssContent",
                    valueType: { kind: "file_content" },
                },
                onError: { action: "abort" },
            },
            {
                nodeType: "step",
                index: 1,
                tool: "Edit",
                description: "Change background-color from bisque to #1a1a1a",
                inputSpec: {
                    file_path: { type: "exact", value: cssPath },
                    old_string: {
                        type: "exact",
                        value: "background-color: bisque;",
                    },
                    new_string: {
                        type: "exact",
                        value: "background-color: #1a1a1a;",
                    },
                },
                dependsOn: [0],
                effect: {
                    type: "modifies_file",
                    path: { type: "literal", value: cssPath },
                },
                onError: { action: "abort" },
            },
            {
                nodeType: "step",
                index: 2,
                tool: "Edit",
                description: "Change button color from red to #e0e0e0",
                inputSpec: {
                    file_path: { type: "exact", value: cssPath },
                    old_string: { type: "exact", value: "color: red;" },
                    new_string: { type: "exact", value: "color: #e0e0e0;" },
                },
                dependsOn: [1],
                effect: {
                    type: "modifies_file",
                    path: { type: "literal", value: cssPath },
                },
                onError: { action: "abort" },
            },
        ],
        bindings: [
            {
                name: "cssContent",
                type: { kind: "file_content" },
                producedBy: 0,
            },
        ],
        postconditions: [
            {
                type: "file_contains",
                path: { type: "literal", value: cssPath },
                text: "#1a1a1a",
            },
            {
                type: "file_not_contains",
                path: { type: "literal", value: cssPath },
                text: "bisque",
            },
        ],
        limits: {
            maxTotalSteps: 10,
            maxDurationMs: 60000,
            maxFileWrites: 5,
            maxBytesWritten: 10240,
            maxBytesRead: 10240,
            maxNestingDepth: 1,
            maxParallelBranches: 1,
        },
        permissions: {
            allowedReadPaths: [workDir.replace(/\\/g, "/") + "/**"],
            allowedWritePaths: [workDir.replace(/\\/g, "/") + "/**"],
            deniedPaths: [],
        },
        metadata: {
            createdAt: Date.now(),
            allowedTools: ["Read", "Edit"],
            description: "Demo plan for dark theme update",
        },
    };
}

// ─── Scenario runner ───────────────────────────────────────────────────

async function runScenario(
    state: ReturnType<typeof createValidationServer>["state"],
    workDir: string,
) {
    const log = (msg: string) => console.error(`  [DEMO] ${msg}`);

    await sleep(2000);
    log("Starting demo scenario...\n");

    // Resolve policy paths
    const resolvedPolicy = JSON.parse(
        JSON.stringify(DEMO_POLICY).replace(
            /\{\{workDir\}\}/g,
            workDir.replace(/\\/g, "/"),
        ),
    );
    state.policy = resolvedPolicy;

    await sleep(1500);
    log("Step 1: Submitting plan for validation...");

    const plan = createDemoPlan(workDir);
    const validationResult = validatePlan(plan);
    if (!validationResult.valid) {
        log(
            `Plan validation FAILED: ${validationResult.errors.map((e) => e.message).join(", ")}`,
        );
        return;
    }
    log("Plan validated successfully!");

    const cycles = checkCircularDependencies(plan);
    if (cycles.length > 0) {
        log(`Circular dependencies: ${cycles.join(", ")}`);
        return;
    }

    // Activate
    state.plan = plan;
    state.flatSteps = flattenPlan(plan);
    initTrace(state);

    await sleep(2000);
    log(`Plan activated: "${plan.goal}" (${state.flatSteps.length} steps)\n`);

    // Execute each step
    for (const step of state.flatSteps) {
        await sleep(2000);
        log(`Executing step ${step.index}: ${step.tool} — ${step.description}`);

        const startTime = Date.now();
        const cssPath = join(workDir, "style.css").replace(/\\/g, "/");

        try {
            let result: string;
            if (step.tool === "Read") {
                result = executeRead(cssPath);
            } else if (step.tool === "Edit") {
                const spec = step.inputSpec;
                result = executeEdit(
                    (spec.file_path as any).value,
                    (spec.old_string as any).value,
                    (spec.new_string as any).value,
                );
            } else {
                throw new Error(`Unexpected tool: ${step.tool}`);
            }

            const duration = Date.now() - startTime;
            appendTraceEntry(
                state,
                step.index,
                step.tool,
                step.inputSpec as any,
                result,
                duration,
                "success",
            );

            if (step.effect.type === "produces") {
                state.bindings.set(step.effect.bind, result);
            }
            state.completedSteps.add(step.index);
            state.currentStep++;

            log(`  ✓ Step ${step.index} completed (${duration}ms)`);
        } catch (err: any) {
            const duration = Date.now() - startTime;
            appendTraceEntry(
                state,
                step.index,
                step.tool,
                step.inputSpec as any,
                null,
                duration,
                "failed",
                err.message,
            );
            log(`  ✗ Step ${step.index} failed: ${err.message}`);
            state.aborted = true;
            state.abortReason = err.message;
            break;
        }
    }

    // Finalize
    await sleep(1500);
    finalizeTrace(state);
    log(
        `\nTrace finalized. ${state.trace?.entries.length} entries, chain valid.`,
    );

    // Show a blocked violation attempt
    await sleep(3000);
    log("\n--- Simulating policy violation ---");
    log("Agent attempts: validated_bash('curl https://example.com')");
    await sleep(1000);
    log("  ✗ BLOCKED: Bash is restricted to capabilities-only mode.");
    log(
        "             Use validated_npm, validated_git, validated_node, or validated_tsc instead.\n",
    );

    await sleep(2000);
    log("Agent attempts: validated_read('.env')");
    await sleep(1000);
    log("  ✗ BLOCKED: Path '.env' matches denied pattern '**/.env'\n");

    log(
        "Demo scenario complete. Dashboard is live at http://localhost:" + PORT,
    );
    log("Press Ctrl+C to exit.\n");
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
    // Set up test project
    const workDir = resolve(__dirname, "../testProject");
    const demoDir = resolve(__dirname, "workdir");
    if (!existsSync(demoDir)) {
        mkdirSync(demoDir, { recursive: true });
        cpSync(workDir, demoDir, { recursive: true });
    } else {
        // Reset to original
        cpSync(workDir, demoDir, { recursive: true });
    }

    // Create the validation server (no policy yet — scenario adds it)
    const { state } = createValidationServer();

    // Read dashboard HTML
    const dashboardPath = join(__dirname, "dashboard.html");
    const dashboardHtml = readFileSync(dashboardPath, "utf-8");

    // HTTP server
    const httpServer = createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");

        if (req.url === "/" || req.url === "/index.html") {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(dashboardHtml);
            return;
        }

        if (req.url === "/api/state") {
            const docker = checkDockerAvailability();
            const containerPolicy = state.policy?.container;

            const response = {
                policy: state.policy
                    ? {
                          name: state.policy.name,
                          deniedTools: state.policy.deniedTools,
                          paths: state.policy.paths,
                          bash: state.policy.bash,
                          limitCaps: state.policy.limitCaps,
                          container: state.policy.container,
                      }
                    : null,
                plan: state.plan
                    ? {
                          id: state.plan.id,
                          goal: state.plan.goal,
                          version: state.plan.version,
                      }
                    : null,
                totalSteps: state.flatSteps.length,
                currentStep: state.currentStep,
                completedSteps: [...state.completedSteps],
                steps: state.flatSteps.map((s) => ({
                    index: s.index,
                    tool: s.tool,
                    description: s.description,
                })),
                aborted: state.aborted,
                abortReason: state.abortReason,
                trace: state.trace
                    ? {
                          planId: state.trace.planId,
                          status: state.trace.status,
                          startedAt: state.trace.startedAt,
                          completedAt: state.trace.completedAt,
                          entries: state.trace.entries.map((e) => ({
                              index: e.index,
                              stepIndex: e.stepIndex,
                              tool: e.tool,
                              status: e.status,
                              durationMs: e.durationMs,
                              hash: e.hash.slice(0, 16) + "...",
                              previousHash: e.previousHash.slice(0, 16) + "...",
                              error: e.error,
                          })),
                          metrics: state.trace.metrics,
                          chainValid: true,
                      }
                    : null,
                container: {
                    dockerAvailable: docker.available,
                    dockerVersion: docker.version,
                    containerEnabled: containerPolicy?.enabled ?? false,
                    image: containerPolicy?.image,
                    networkMode: containerPolicy?.networkMode,
                    readOnly: containerPolicy?.readOnly,
                    memoryLimit: containerPolicy?.memoryLimit,
                    cpuLimit: containerPolicy?.cpuLimit,
                    workDir: containerPolicy?.workDir ?? "/workspace",
                },
                bindings: Object.fromEntries(state.bindings),
            };

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
            return;
        }

        res.writeHead(404);
        res.end("Not found");
    });

    httpServer.listen(PORT, () => {
        console.error(`
╔══════════════════════════════════════════════════════════════╗
║           Plan Validation — Live Demo Dashboard              ║
║                                                              ║
║   Dashboard: http://localhost:${PORT}                          ║
║                                                              ║
║   Open the URL in your browser, then watch as the demo       ║
║   scenario executes step by step.                            ║
╚══════════════════════════════════════════════════════════════╝
`);
        // Start the scenario after a brief delay
        setTimeout(() => runScenario(state, demoDir), 1000);
    });
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
