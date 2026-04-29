// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// demo/server.ts — Demo dashboard server
//
// Runs the MCP validation server in-process, exposes its state via HTTP,
// and serves a live dashboard at http://localhost:3100
//
// Usage:
//   npx tsx demo/server.ts [--policy ../policies/dev.json]
//   # Then open http://localhost:3100
//
// The dashboard polls /api/state every second and renders:
//   - Organization policy config
//   - Active plan with step progress
//   - Execution trace with hash chain
//   - Container sandbox status
//   - Real-time event log
//
// To see it in action, connect Claude Code or another MCP client to the
// same validation server, or use the Agent SDK to run a scenario.
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    loadOrgPolicy,
    checkDockerAvailability,
    type OrgPolicy,
} from "validation";
import { createValidationServer } from "../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DEMO_PORT ?? "3100", 10);

// ─── Parse args ────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    let policyPath: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--policy" && args[i + 1]) {
            policyPath = resolve(args[++i]);
        }
    }

    return { policyPath };
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
    const { policyPath } = parseArgs();

    // Load policy
    let policy: OrgPolicy | undefined;
    if (policyPath && existsSync(policyPath)) {
        policy = loadOrgPolicy(policyPath);
        console.log(`Loaded policy: "${policy.name}" from ${policyPath}`);
    } else {
        console.log("No policy loaded (use --policy <path> to load one)");
    }

    // Create the MCP validation server
    const { server: mcpServer, state } = createValidationServer({ policy });

    // Start MCP on stdio (so a real client can connect)
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("MCP server running on stdio");

    // Read dashboard HTML
    const dashboardPath = join(__dirname, "dashboard.html");
    const dashboardHtml = readFileSync(dashboardPath, "utf-8");

    // HTTP server for the dashboard
    const httpServer = createServer((req, res) => {
        // CORS
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
                // Policy
                policy: state.policy
                    ? {
                          name: state.policy.name,
                          deniedTools: state.policy.deniedTools,
                          allowedTools: state.policy.allowedTools,
                          paths: state.policy.paths,
                          bash: state.policy.bash,
                          limitCaps: state.policy.limitCaps,
                          container: state.policy.container,
                      }
                    : null,

                // Plan
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

                // Trace
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
                          chainValid: verifyChainQuick(state.trace.entries),
                      }
                    : null,

                // Container
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

                // Bindings
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
        console.error(`\n  Dashboard: http://localhost:${PORT}\n`);
        console.error(
            "  The dashboard polls the MCP server state every second.",
        );
        console.error(
            "  Connect an MCP client to this process's stdio to see live updates.\n",
        );
    });
}

/** Quick hash chain verification without crypto import overhead */
function verifyChainQuick(
    entries: Array<{ previousHash: string; hash: string }>,
): boolean {
    for (let i = 1; i < entries.length; i++) {
        // We can only check chain linkage, not recompute hashes (no access to full data here)
        // The full verify happens in the plan_trace tool
        if (
            !entries[i].previousHash.startsWith(
                entries[i - 1].hash.slice(0, 16),
            )
        ) {
            return false;
        }
    }
    return true;
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
