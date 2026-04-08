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
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { PackagingActions } from "./packagingSchema.js";
import {
    loadState,
    updatePhase,
    readArtifact,
    readArtifactJson,
    writeArtifact,
} from "../lib/workspace.js";
import { getPackagingModel } from "../lib/llm.js";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";

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
        case "generateDemo":
            return handleGenerateDemo(
                action.parameters.integrationName,
                action.parameters.durationMinutes,
            );
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

async function handleGenerateDemo(
    integrationName: string,
    durationMinutes?: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.testing.status !== "approved") {
        return { error: `Testing phase must be approved before generating a demo.` };
    }

    // Load discovery artifacts
    const apiSurface = await readArtifactJson<{
        actions: { name: string; description: string; category?: string }[];
    }>(integrationName, "discovery", "api-surface.json");
    if (!apiSurface) {
        return { error: `No approved API surface found. Complete discovery first.` };
    }

    const subSchemaGroups = await readArtifactJson<
        Record<string, string[]>
    >(integrationName, "discovery", "sub-schema-groups.json");

    // Load the generated schema
    const schemaTs = await readArtifact(
        integrationName,
        "schemaGen",
        "schema.ts",
    );

    const duration = durationMinutes ?? "3-5";
    const description = state.config.description ?? integrationName;

    // Build action listing — grouped by sub-schema if available
    let actionListing: string;
    if (subSchemaGroups) {
        const groupLines: string[] = [];
        for (const [group, actionNames] of Object.entries(subSchemaGroups)) {
            groupLines.push(`### ${group}`);
            for (const actionName of actionNames) {
                const action = apiSurface.actions.find(
                    (a) => a.name === actionName,
                );
                groupLines.push(
                    `- **${actionName}**: ${action?.description ?? "(no description)"}`,
                );
            }
            groupLines.push("");
        }
        actionListing = groupLines.join("\n");
    } else {
        actionListing = apiSurface.actions
            .map((a) => `- **${a.name}**: ${a.description}`)
            .join("\n");
    }

    const model = getPackagingModel();
    const prompt = buildDemoPrompt(
        integrationName,
        description,
        actionListing,
        schemaTs ?? "",
        duration,
    );

    const result = await model.complete(prompt);
    if (!result.success) {
        return { error: `Demo generation failed: ${result.message}` };
    }

    // Parse the LLM response — expect two fenced blocks:
    //   ```demo ... ```  and  ```narration ... ```
    const responseText = result.data;
    const demoScript = extractFencedBlock(responseText, "demo") ??
        extractFirstFencedBlock(responseText) ?? responseText;
    const narrationScript = extractFencedBlock(responseText, "narration") ??
        extractSecondFencedBlock(responseText) ?? "";

    // Find the scaffolded agent directory
    const scaffoldedTo = await readArtifact(
        integrationName,
        "scaffolder",
        "scaffolded-to.txt",
    );

    // Write to the shell demo directory alongside other demo scripts
    const shellDemoDir = path.resolve(
        scaffoldedTo?.trim() ?? ".",
        "../../shell/demo",
    );
    await fs.mkdir(shellDemoDir, { recursive: true });

    const demoFilename = `${integrationName}_agent.txt`;
    const narrationFilename = `${integrationName}_agent_narration.md`;

    const demoPath = path.join(shellDemoDir, demoFilename);
    const narrationPath = path.join(shellDemoDir, narrationFilename);

    await fs.writeFile(demoPath, demoScript, "utf-8");
    await fs.writeFile(narrationPath, narrationScript, "utf-8");

    // Also save as artifacts in the onboarding workspace
    await writeArtifact(integrationName, "packaging", demoFilename, demoScript);
    await writeArtifact(
        integrationName,
        "packaging",
        narrationFilename,
        narrationScript,
    );

    const lines = [
        `## Demo scripts generated: ${integrationName}`,
        ``,
        `**Demo script:** \`${demoPath}\``,
        `**Narration script:** \`${narrationPath}\``,
        ``,
        `**Target duration:** ${duration} minutes`,
        ``,
        `### Demo script preview`,
        `\`\`\``,
        demoScript.split("\n").slice(0, 20).join("\n"),
        demoScript.split("\n").length > 20 ? "..." : "",
        `\`\`\``,
        ``,
        `### Narration preview`,
        narrationScript.split("\n").slice(0, 15).join("\n"),
        narrationScript.split("\n").length > 15 ? "\n..." : "",
    ];

    return createActionResultFromMarkdownDisplay(lines.join("\n"));
}

function buildDemoPrompt(
    integrationName: string,
    description: string,
    actionListing: string,
    schemaTs: string,
    duration: string,
): string {
    return `You are generating a demo script for a TypeAgent integration called "${integrationName}".

**Integration description:** ${description}

**Available actions (grouped by category if applicable):**
${actionListing}

${schemaTs ? `**TypeScript action schema:**\n\`\`\`typescript\n${schemaTs}\n\`\`\`` : ""}

Generate TWO outputs:

## 1. Demo script (shell format)

Create a demo script with 5-8 acts that showcase each action category. The demo should be ${duration} minutes long (approximately 50-80 natural language commands).

Format rules:
- One natural language command per line (what a user would type, NOT @action syntax)
- Use \`# Section Title\` comments for section headers
- Use \`@pauseForInput\` between acts/sections
- Commands should be realistic, conversational requests a user would make
- Progress from simple to complex usage
- Show off different capabilities in each act
- Include some multi-step scenarios

Wrap the entire demo script in a fenced code block with the label \`demo\`:
\`\`\`demo
# Act 1: Getting Started
...
\`\`\`

## 2. Narration script (markdown)

Create a matching narration script with timestamped sections that correspond to each act. Include:
- Approximate timestamp for each section (e.g., [0:00], [0:30])
- Voice-over text explaining what is being demonstrated
- Key talking points for each act
- Transition text between acts

Wrap the narration in a fenced code block with the label \`narration\`:
\`\`\`narration
# Demo Narration: ${integrationName} Agent
...
\`\`\``;
}

function extractFencedBlock(text: string, label: string): string | undefined {
    const regex = new RegExp(
        "```" + label + "\\s*\\n([\\s\\S]*?)\\n```",
        "i",
    );
    const match = text.match(regex);
    return match?.[1]?.trim();
}

function extractFirstFencedBlock(text: string): string | undefined {
    const match = text.match(/```[\w]*\s*\n([\s\S]*?)\n```/);
    return match?.[1]?.trim();
}

function extractSecondFencedBlock(text: string): string | undefined {
    const blocks = [...text.matchAll(/```[\w]*\s*\n([\s\S]*?)\n```/g)];
    if (blocks.length >= 2) {
        return blocks[1][1]?.trim();
    }
    return undefined;
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
