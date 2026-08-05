#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SequenceIdGenerator, createAccessScope } from "../domain/index.js";
import { SqliteMemoryRepository } from "../repository/index.js";
import { RecordTurnService } from "../services/index.js";
import {
    createBatchedInvestigationPrompt,
    createFreshHandoffPrompt,
    finalHandoffRecall,
    incidentScenario,
} from "./incidentScenario.js";

const packageDirectory = fileURLToPath(new URL("../../../", import.meta.url));

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const workingDirectory =
        options.outputDirectory ??
        (await mkdtemp(path.join(os.tmpdir(), "agent-memory-incident-demo-")));
    await mkdir(workingDirectory, { recursive: true });
    const databasePath = path.join(workingDirectory, "incident-memory.db");
    const ids = new SequenceIdGenerator(Date.now());
    const scope = createAccessScope(ids.generate("Scope"), {
        userId: "incident-analyst",
        workspaceId: "IR-7421",
    });
    const repository = SqliteMemoryRepository.open(databasePath);
    repository.saveScope(scope);
    console.log(`Incident demo workspace: ${workingDirectory}`);
    console.log(
        "Session 1 investigates and stores evidence. Session 2 is fresh and must recover the incident from memory.\n",
    );
    recordAndPrintEvidenceTurns(repository, ids, scope);
    repository.close();
    const mcpConfigPath = path.join(workingDirectory, "mcp.json");
    await writeFile(
        mcpConfigPath,
        JSON.stringify(
            {
                mcpServers: {
                    "agent-memory": {
                        type: "stdio",
                        command: process.execPath,
                        args: [
                            path.join(
                                packageDirectory,
                                "dist",
                                "src",
                                "main.js",
                            ),
                            "--database",
                            databasePath,
                            "--allowed-scope",
                            scope.scopeId,
                            "--cursor-secret",
                            "incident-demo-cursor-secret-32-bytes",
                        ],
                    },
                },
            },
            undefined,
            2,
        ),
    );

    const startedAt = Date.now();
    try {
        console.log("=== Session 1/2: primary investigation ===");
        console.log("\nStarting Agency; memory tool activity follows:\n");
        const investigation = await runAgencyTurn(
            createBatchedInvestigationPrompt(scope),
            mcpConfigPath,
            options.model,
            "investigation",
        );
        console.log("\nPrimary investigation complete.\n");

        console.log("=== Session 2/2: fresh analyst handoff ===");
        console.log(
            "Starting a fresh Agency process with no incident evidence:\n",
        );
        const handoff = await runAgencyTurn(
            createFreshHandoffPrompt(scope),
            mcpConfigPath,
            options.model,
            "handoff",
        );
        console.log("\n");
        assertRecall(handoff);
        const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
        console.log(`Cross-session recall: ${finalHandoffRecall.join(", ")}`);
        console.log(`Incident memory demo passed in ${durationSeconds}s.`);
    } finally {
        if (options.outputDirectory === undefined && !options.keep) {
            await rm(workingDirectory, { recursive: true, force: true });
        }
    }
}

async function runAgencyTurn(
    prompt: string,
    mcpConfigPath: string,
    model: string,
    sessionName: string,
): Promise<string> {
    const args = [
        "copilot",
        "--prompt",
        prompt,
        "--no-default-mcps",
        "--no-config-plugins",
        "--no-org-config",
        "--no-input-processing",
        "--additional-mcp-config",
        `@${mcpConfigPath}`,
        "--allow-all-tools",
        "--no-ask-user",
        "--no-custom-instructions",
        "--disable-builtin-mcps",
        "--output-format",
        "text",
        "--stream",
        "off",
        "--model",
        model,
        "--name",
        `IR-7421-${sessionName}`,
        "-C",
        packageDirectory,
    ];
    return new Promise((resolve, reject) => {
        const child = spawn("agency", args, {
            cwd: packageDirectory,
            env: { ...process.env, NO_COLOR: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timeout = setTimeout(() => {
            child.kill();
            reject(
                new Error(
                    `Agency ${sessionName} session exceeded the 135-second demo limit`,
                ),
            );
        }, 135_000);
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
            process.stdout.write(chunk);
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
            process.stderr.write(chunk);
        });
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                const response = stdout.trim();
                if (response.length === 0) {
                    reject(
                        new Error(
                            `Agency ${sessionName} session returned no analyst response. ${stderr.trim()}`,
                        ),
                    );
                } else {
                    resolve(response);
                }
            } else {
                reject(
                    new Error(
                        `Agency turn failed with exit code ${code}: ${stderr.trim()}`,
                    ),
                );
            }
        });
    });
}

function recordAndPrintEvidenceTurns(
    repository: SqliteMemoryRepository,
    ids: SequenceIdGenerator,
    scope: ReturnType<typeof createAccessScope>,
): void {
    console.log("=== Evidence turns and topic-index updates ===\n");
    const recorder = new RecordTurnService(repository, undefined, ids);
    const evidenceTurns = incidentScenario.filter(
        (turn) => turn.type === "evidence",
    );
    for (const [index, turn] of evidenceTurns.entries()) {
        const result = recorder.record({
            turnId: ids.generate("Turn"),
            idempotencyKey: `incident-demo-turn-${turn.id}`,
            scope,
            conversationId: "IR-7421-live-demo",
            sequence: index,
            primaryTopicPath: turn.topicPath,
            requestSummary: `${turn.source} evidence`,
            outcomeSummary: turn.evidence,
            occurredAt: turn.at,
            provenance: {
                sourceType: "tool",
                actorId: "incident-demo",
                observedAt: turn.at,
            },
            terms: turn.tags.map((text) => ({ text, role: "subject" })),
        });
        console.log(`TURN ${index + 1}/${evidenceTurns.length}`);
        console.log(`  Time:   ${turn.at}`);
        console.log(`  Source: ${turn.source}`);
        console.log(`  Text:   ${turn.evidence}`);
        console.log("  MEMORY UPDATE (native topic index)");
        console.log(`    Topic path: ${turn.topicPath}`);
        console.log(`    Topic ID:   ${result.primaryTopicId}`);
        console.log(`    Turn ID:    ${result.turnId}`);
        console.log(`    Query path: /topics${turn.topicPath}/turns`);
        console.log(`    Terms:      ${turn.tags.join(", ")}\n`);
    }
}

function assertRecall(response: string): void {
    const normalized = response.toLocaleLowerCase("en-US");
    const missing = finalHandoffRecall.filter(
        (value) => !normalized.includes(value.toLocaleLowerCase("en-US")),
    );
    if (missing.length > 0) {
        throw new Error(
            `Fresh handoff missed recalled evidence: ${missing.join(", ")}`,
        );
    }
}

type DemoOptions = {
    model: string;
    keep: boolean;
    outputDirectory?: string;
};

function parseArguments(args: string[]): DemoOptions {
    let model = "auto";
    let keep = false;
    let outputDirectory: string | undefined;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--keep") {
            keep = true;
            continue;
        }
        const value = args[index + 1];
        if (value === undefined) {
            throw new Error(`Missing value for ${argument}`);
        }
        if (argument === "--model") {
            model = value;
        } else if (argument === "--output") {
            outputDirectory = path.resolve(value);
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
        index++;
    }
    return {
        model,
        keep,
        ...(outputDirectory === undefined ? {} : { outputDirectory }),
    };
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
