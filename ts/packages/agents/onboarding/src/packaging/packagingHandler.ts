// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 7 — Packaging handler.
// Builds the scaffolded agent package and optionally registers it
// with the local TypeAgent dispatcher configuration.

import {
    ActionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { PackagingActions } from "./packagingSchema.js";
import {
    loadState,
    updatePhase,
    readArtifact,
    writeArtifactJson,
    getWorkspacePath,
} from "../lib/workspace.js";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";

export async function executePackagingAction(
    action: TypeAgentAction<PackagingActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "packageAgent":
            return handlePackageAgent(
                action.parameters.integrationName,
                action.parameters.register ?? false,
            );
        case "validatePackage":
            return handleValidatePackage(action.parameters.integrationName);
    }
}

async function handlePackageAgent(
    integrationName: string,
    register: boolean,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.testing.status !== "approved") {
        return { error: `Testing phase must be approved before packaging.` };
    }

    // Find where the scaffolded agent lives
    const scaffoldedTo = await readArtifact(
        integrationName,
        "scaffolder",
        "scaffolded-to.txt",
    );
    if (!scaffoldedTo) {
        return { error: `No scaffolded agent found. Run scaffoldAgent first.` };
    }

    const agentDir = scaffoldedTo.trim();

    await updatePhase(integrationName, "packaging", { status: "in-progress" });

    // Run pnpm install + build in the agent directory
    const installResult = await runCommand("pnpm", ["install"], agentDir);
    if (!installResult.success) {
        return {
            error: `pnpm install failed:\n${installResult.output}`,
        };
    }

    const buildResult = await runCommand("pnpm", ["run", "build"], agentDir);
    if (!buildResult.success) {
        return {
            error: `Build failed:\n${buildResult.output}`,
        };
    }

    const summary = [
        `## Package built: ${integrationName}`,
        ``,
        `**Agent directory:** \`${agentDir}\``,
        `**Build output:** \`${path.join(agentDir, "dist")}\``,
        ``,
        buildResult.output ? `\`\`\`\n${buildResult.output.slice(0, 500)}\n\`\`\`` : "",
    ];

    if (register) {
        const registerResult = await registerWithDispatcher(integrationName, agentDir);
        summary.push(``, registerResult);
    }

    await updatePhase(integrationName, "packaging", { status: "approved" });

    summary.push(
        ``,
        `**Onboarding complete!** 🎉`,
        ``,
        `The \`${integrationName}\` agent is ready for end-user testing.`,
        register
            ? `It has been registered with the local TypeAgent dispatcher.`
            : `Run with \`register: true\` to register with the local dispatcher, or add it manually to \`ts/packages/defaultAgentProvider/data/config.json\`.`,
    );

    return createActionResultFromMarkdownDisplay(summary.join("\n"));
}

async function handleValidatePackage(integrationName: string): Promise<ActionResult> {
    const scaffoldedTo = await readArtifact(
        integrationName,
        "scaffolder",
        "scaffolded-to.txt",
    );
    if (!scaffoldedTo) {
        return { error: `No scaffolded agent found. Run scaffoldAgent first.` };
    }

    const agentDir = scaffoldedTo.trim();
    const checks: { name: string; passed: boolean; detail?: string }[] = [];

    // Check required files exist
    const requiredFiles = [
        "package.json",
        "tsconfig.json",
        "src/tsconfig.json",
    ];
    for (const file of requiredFiles) {
        const exists = await fileExists(path.join(agentDir, file));
        checks.push({ name: `File: ${file}`, passed: exists });
    }

    // Check package.json exports
    try {
        const pkgJson = JSON.parse(
            await fs.readFile(path.join(agentDir, "package.json"), "utf-8"),
        );
        const hasManifestExport =
            !!pkgJson.exports?.["./agent/manifest"];
        const hasHandlerExport =
            !!pkgJson.exports?.["./agent/handlers"];
        checks.push({
            name: "package.json: exports ./agent/manifest",
            passed: hasManifestExport,
        });
        checks.push({
            name: "package.json: exports ./agent/handlers",
            passed: hasHandlerExport,
        });
    } catch {
        checks.push({
            name: "package.json: parse",
            passed: false,
            detail: "Could not read package.json",
        });
    }

    // Check dist exists (agent has been built)
    const distExists = await fileExists(path.join(agentDir, "dist"));
    checks.push({ name: "dist/ directory exists (built)", passed: distExists });

    const passed = checks.filter((c) => c.passed).length;
    const failed = checks.filter((c) => !c.passed).length;

    const lines = [
        `## Package validation: ${integrationName}`,
        ``,
        `**Passed:** ${passed} / ${checks.length}`,
        ``,
        ...checks.map(
            (c) =>
                `${c.passed ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`,
        ),
    ];

    if (failed === 0) {
        lines.push(``, `Package is valid and ready for distribution.`);
    } else {
        lines.push(``, `Fix the failing checks above before packaging.`);
    }

    return createActionResultFromMarkdownDisplay(lines.join("\n"));
}

async function registerWithDispatcher(
    integrationName: string,
    agentDir: string,
): Promise<string> {
    // Add agent to defaultAgentProvider config.json
    const configPath = path.resolve(
        agentDir,
        "../../../../defaultAgentProvider/data/config.json",
    );

    try {
        const configRaw = await fs.readFile(configPath, "utf-8");
        const config = JSON.parse(configRaw);

        if (!config.agents) config.agents = {};
        if (config.agents[integrationName]) {
            return `Agent "${integrationName}" is already registered in the dispatcher config.`;
        }

        config.agents[integrationName] = {
            name: `${integrationName}-agent`,
        };

        await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
        return `✅ Registered "${integrationName}" in dispatcher config at \`${configPath}\`\n\nRestart TypeAgent to load the new agent.`;
    } catch (err: any) {
        return `⚠️ Could not auto-register — update dispatcher config manually.\n${err?.message ?? err}`;
    }
}

async function runCommand(
    cmd: string,
    args: string[],
    cwd: string,
): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
        });

        let output = "";
        proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
        proc.stderr?.on("data", (d: Buffer) => { output += d.toString(); });

        proc.on("close", (code) => {
            resolve({ success: code === 0, output });
        });

        proc.on("error", (err) => {
            resolve({ success: false, output: err.message });
        });
    });
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}
