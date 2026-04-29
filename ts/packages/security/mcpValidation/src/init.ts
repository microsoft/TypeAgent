// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// init.ts — Scaffold plan-validation into an existing project
//
// Usage:
//   node dist/init.js [--client claude|copilot|cursor|all] [--policy strict|dev|ml|ci] [--project-dir .]
//
// Creates:
//   .plan-validation-policy.json       — org policy (from template, paths resolved)
//   Client-specific MCP settings file  — auto-detected or specified
//   CLAUDE.md / .github/copilot-instructions.md / .cursorrules — model instructions
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");

// ─── Client definitions ────────────────────────────────────────────────

type ClientName = "claude" | "copilot" | "cursor";

interface ClientConfig {
    /** Display name */
    displayName: string;

    /** Directory for settings file (relative to project root) */
    settingsDir: string;

    /** Settings filename */
    settingsFile: string;

    /** JSON key structure for MCP servers */
    buildSettings: (serverArgs: string[]) => object;

    /** How to merge into existing settings */
    mergeKey: string;

    /** Instructions file path (relative to project root) */
    instructionsFile: string;

    /** What to tell the user to do next */
    nextStep: string;
}

const CLIENTS: Record<ClientName, ClientConfig> = {
    claude: {
        displayName: "Claude Code",
        settingsDir: ".claude",
        settingsFile: "settings.local.json",
        buildSettings: (serverArgs) => ({
            mcpServers: {
                "plan-validation": {
                    command: "node",
                    args: serverArgs,
                },
            },
        }),
        mergeKey: "mcpServers",
        instructionsFile: "CLAUDE.md",
        nextStep:
            "Start Claude Code — the MCP server will be picked up automatically",
    },
    copilot: {
        displayName: "GitHub Copilot (VS Code)",
        settingsDir: ".vscode",
        settingsFile: "mcp.json",
        buildSettings: (serverArgs) => ({
            servers: {
                "plan-validation": {
                    type: "stdio",
                    command: "node",
                    args: serverArgs,
                },
            },
        }),
        mergeKey: "servers",
        instructionsFile: ".github/copilot-instructions.md",
        nextStep:
            "Open VS Code — Copilot will discover the MCP server via .vscode/mcp.json",
    },
    cursor: {
        displayName: "Cursor",
        settingsDir: ".cursor",
        settingsFile: "mcp.json",
        buildSettings: (serverArgs) => ({
            mcpServers: {
                "plan-validation": {
                    command: "node",
                    args: serverArgs,
                },
            },
        }),
        mergeKey: "mcpServers",
        instructionsFile: ".cursorrules",
        nextStep:
            "Open Cursor — the MCP server will be picked up from .cursor/mcp.json",
    },
};

// ─── CLI argument parsing ──────────────────────────────────────────────

interface InitOptions {
    policyName: string;
    projectDir: string;
    clients: ClientName[];
}

function parseArgs(): InitOptions {
    const args = process.argv.slice(2);
    let policyName = "strict";
    let projectDir = process.cwd();
    let clientArg: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--policy" && args[i + 1]) {
            policyName = args[++i];
        } else if (args[i] === "--project-dir" && args[i + 1]) {
            projectDir = resolve(args[++i]);
        } else if (args[i] === "--client" && args[i + 1]) {
            clientArg = args[++i];
        } else if (args[i] === "--help" || args[i] === "-h") {
            printUsage();
            process.exit(0);
        }
    }

    // Resolve clients
    let clients: ClientName[];
    if (clientArg === "all") {
        clients = ["claude", "copilot", "cursor"];
    } else if (clientArg && clientArg in CLIENTS) {
        clients = [clientArg as ClientName];
    } else if (clientArg) {
        console.error(
            `Unknown client: "${clientArg}". Available: claude, copilot, cursor, all`,
        );
        process.exit(1);
    } else {
        // Auto-detect from existing files
        clients = detectClients(projectDir);
        if (clients.length === 0) {
            clients = ["claude"]; // default
        }
    }

    return { policyName, projectDir, clients };
}

function detectClients(projectDir: string): ClientName[] {
    const detected: ClientName[] = [];

    if (
        existsSync(join(projectDir, ".claude")) ||
        existsSync(join(projectDir, "CLAUDE.md"))
    ) {
        detected.push("claude");
    }
    if (existsSync(join(projectDir, ".vscode"))) {
        detected.push("copilot");
    }
    if (existsSync(join(projectDir, ".cursor"))) {
        detected.push("cursor");
    }

    return detected;
}

function printUsage() {
    console.log(
        `
Usage: mcp-plan-validation init [options]

Scaffold plan-validated execution into your project.

Options:
  --client <name>       Client: claude, copilot, cursor, all (default: auto-detect)
  --policy <name>       Policy template: strict, dev, ml, ci (default: strict)
  --project-dir <path>  Project directory (default: current directory)
  --help, -h            Show this help

Clients:
  claude    Claude Code — writes .claude/settings.local.json + CLAUDE.md
  copilot   GitHub Copilot — writes .vscode/mcp.json + .github/copilot-instructions.md
  cursor    Cursor — writes .cursor/mcp.json + .cursorrules
  all       Configure all three clients

  If omitted, auto-detects from existing .claude/, .vscode/, .cursor/ directories.

Policy templates:
  strict    Maximum restriction. Capability tools only, no bash, no network.
  dev       Development workflow. Policy-checked bash, common tools allowed.
  ml        Machine learning. GPU access, Python container, large limits.
  ci        CI/CD pipeline. Read-only, tight timeouts, no interactive tools.
`.trim(),
    );
}

// ─── Policy resolution ─────────────────────────────────────────────────

function loadPolicyTemplate(name: string): string {
    const policyPath = join(PACKAGE_ROOT, "policies", `${name}.json`);
    if (!existsSync(policyPath)) {
        const available = ["strict", "dev", "ml", "ci"];
        console.error(
            `Unknown policy: "${name}". Available: ${available.join(", ")}`,
        );
        process.exit(1);
    }
    return readFileSync(policyPath, "utf-8");
}

function resolvePolicy(template: string, projectDir: string): string {
    const normalized = projectDir.replace(/\\/g, "/");
    return template.replace(/\{\{projectDir\}\}/g, normalized);
}

// ─── Instructions template ─────────────────────────────────────────────

function loadInstructionsTemplate(policyDescription: string): string {
    const templatePath = join(PACKAGE_ROOT, "templates", "CLAUDE.md.template");
    const template = readFileSync(templatePath, "utf-8");
    return template.replace("{{policyDescription}}", policyDescription);
}

// ─── Settings writer ───────────────────────────────────────────────────

function writeSettings(
    projectDir: string,
    client: ClientConfig,
    serverArgs: string[],
): void {
    const settingsDir = join(projectDir, client.settingsDir);
    const settingsPath = join(settingsDir, client.settingsFile);
    const newSettings = client.buildSettings(serverArgs);

    if (!existsSync(settingsDir)) {
        mkdirSync(settingsDir, { recursive: true });
    }

    if (existsSync(settingsPath)) {
        try {
            const existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
            existing[client.mergeKey] = {
                ...(existing[client.mergeKey] ?? {}),
                ...(newSettings as any)[client.mergeKey],
            };
            writeFileSync(
                settingsPath,
                JSON.stringify(existing, null, 2) + "\n",
                "utf-8",
            );
            console.log(`  [merged]  ${settingsPath}`);
        } catch {
            writeFileSync(
                settingsPath,
                JSON.stringify(newSettings, null, 2) + "\n",
                "utf-8",
            );
            console.log(
                `  [created] ${settingsPath} (existing file was invalid)`,
            );
        }
    } else {
        writeFileSync(
            settingsPath,
            JSON.stringify(newSettings, null, 2) + "\n",
            "utf-8",
        );
        console.log(`  [created] ${settingsPath}`);
    }
}

// ─── Instructions writer ───────────────────────────────────────────────

function writeInstructions(
    projectDir: string,
    instructionsFile: string,
    content: string,
): void {
    const fullPath = join(projectDir, instructionsFile);
    const marker = "# Plan-Validated Agent Execution";

    // Ensure parent directory exists (for .github/copilot-instructions.md)
    const parentDir = dirname(fullPath);
    if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
    }

    if (existsSync(fullPath)) {
        const existing = readFileSync(fullPath, "utf-8");
        if (existing.includes(marker)) {
            console.log(
                `  [skip]    ${fullPath} already contains plan validation instructions`,
            );
        } else {
            writeFileSync(fullPath, existing + "\n\n" + content, "utf-8");
            console.log(`  [appended] ${fullPath}`);
        }
    } else {
        writeFileSync(fullPath, content, "utf-8");
        console.log(`  [created] ${fullPath}`);
    }
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
    const { policyName, projectDir, clients } = parseArgs();

    const clientNames = clients.map((c) => CLIENTS[c].displayName).join(", ");
    console.log(`\nPlan Validation Setup`);
    console.log(`  Project:  ${projectDir}`);
    console.log(`  Policy:   ${policyName}`);
    console.log(`  Clients:  ${clientNames}\n`);

    // 1. Write policy file (shared across all clients)
    const policyTemplate = loadPolicyTemplate(policyName);
    const resolvedPolicy = resolvePolicy(policyTemplate, projectDir);
    const policyDest = join(projectDir, ".plan-validation-policy.json");

    if (existsSync(policyDest)) {
        console.log(`  [skip]    ${policyDest} already exists`);
    } else {
        writeFileSync(policyDest, resolvedPolicy, "utf-8");
        console.log(`  [created] ${policyDest}`);
    }

    const policy = JSON.parse(resolvedPolicy);
    const policyDescription = policy.description ?? `Policy: ${policyName}`;
    const instructionsContent = loadInstructionsTemplate(policyDescription);

    // Server args (shared)
    const serverPath = join(PACKAGE_ROOT, "dist", "index.js").replace(
        /\\/g,
        "/",
    );
    const policyPath = policyDest.replace(/\\/g, "/");
    const serverArgs = [serverPath, "--policy", policyPath];

    // 2. Write settings and instructions for each client
    for (const clientName of clients) {
        const client = CLIENTS[clientName];
        console.log(`\n  ── ${client.displayName} ──`);
        writeSettings(projectDir, client, serverArgs);
        writeInstructions(
            projectDir,
            client.instructionsFile,
            instructionsContent,
        );
    }

    // 3. Summary
    const bashMode = policy.bash?.mode ?? "policy-checked";
    const containerEnabled = policy.container?.enabled ?? false;

    console.log(`\nDone! Configuration:`);
    console.log(`  Bash mode:    ${bashMode}`);
    console.log(
        `  Container:    ${containerEnabled ? `enabled (${policy.container.image})` : "disabled"}`,
    );
    console.log(
        `  Denied tools: ${(policy.deniedTools ?? []).join(", ") || "none"}`,
    );
    console.log(`\nNext steps:`);
    for (const clientName of clients) {
        const client = CLIENTS[clientName];
        console.log(`  ${client.displayName}: ${client.nextStep}`);
    }
    if (containerEnabled) {
        console.log(
            `  Ensure Docker is running (container sandbox is enabled)`,
        );
    }
    console.log(
        `\n  Review .plan-validation-policy.json and adjust paths/limits as needed.`,
    );
    console.log();
}

main();
