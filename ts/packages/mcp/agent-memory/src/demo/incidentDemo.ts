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
    createFreshHandoffPrompt,
    createInvestigationRoundPrompt,
    finalHandoffRecall,
    incidentConversationRounds,
    incidentScenario,
} from "./incidentScenario.js";

const packageDirectory = fileURLToPath(new URL("../../../", import.meta.url));
const sessionTimeoutMs = 90_000;

type IndexedEvidence = {
    topicPath: string;
    topicId: string;
    turnId: string;
};

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
        "A security analyst investigates with an agent, then hands the incident to a fresh agent session.\n",
    );
    const indexedEvidence = indexEvidenceTurns(repository, ids, scope);
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
    const investigationSession = `IR-7421-investigation-${scope.scopeId}`;
    try {
        console.log("SESSION 1 - INCIDENT INVESTIGATION\n");
        for (const [index, round] of incidentConversationRounds.entries()) {
            printAnalystMessage(round.at, round.analystMessage);
            await runAgencyTurn({
                prompt: createInvestigationRoundPrompt(round, scope, index > 0),
                mcpConfigPath,
                model: options.model,
                sessionName: investigationSession,
                resume: index > 0,
                indexedEvidence,
            });
        }

        console.log("\nSESSION 2 - FRESH ANALYST HANDOFF");
        console.log("(new Copilot process; no incident evidence in context)\n");
        printAnalystMessage(
            "2026-08-05T10:40:00.000Z",
            "I'm taking over IR-7421. Reconstruct the incident from durable memory and give me the current diagnosis, containment status, false leads, and next actions.",
        );
        const handoff = await runAgencyTurn({
            prompt: createFreshHandoffPrompt(scope),
            mcpConfigPath,
            model: options.model,
            sessionName: `IR-7421-handoff-${scope.scopeId}`,
            resume: false,
            indexedEvidence,
        });
        assertRecall(handoff);
        const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
        console.log("DEMO RESULT");
        console.log(`  Cross-session recall: ${finalHandoffRecall.join(", ")}`);
        console.log(`  Passed in ${durationSeconds}s.\n`);
    } finally {
        if (options.outputDirectory === undefined && !options.keep) {
            await rm(workingDirectory, { recursive: true, force: true });
        }
    }
}

async function runAgencyTurn(options: {
    prompt: string;
    mcpConfigPath: string;
    model: string;
    sessionName: string;
    resume: boolean;
    indexedEvidence: ReadonlyMap<string, IndexedEvidence>;
}): Promise<string> {
    const args = [
        "copilot",
        "--prompt",
        options.prompt,
        "--no-default-mcps",
        "--no-config-plugins",
        "--no-org-config",
        "--no-input-processing",
        "--additional-mcp-config",
        `@${options.mcpConfigPath}`,
        "--allow-all-tools",
        "--no-ask-user",
        "--no-custom-instructions",
        "--disable-builtin-mcps",
        "--output-format",
        "json",
        "--stream",
        "off",
        "--model",
        options.model,
        ...(options.resume
            ? ["--resume", options.sessionName]
            : ["--name", options.sessionName]),
        "-C",
        packageDirectory,
    ];
    return new Promise((resolve, reject) => {
        const child = spawn("agency", args, {
            cwd: packageDirectory,
            env: { ...process.env, NO_COLOR: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        const transcript = new AgencyTranscriptRenderer(
            options.indexedEvidence,
        );
        let stdoutBuffer = "";
        let stderr = "";
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill();
            reject(
                new Error(
                    `Agency ${options.sessionName} session exceeded the 90-second demo limit`,
                ),
            );
        }, sessionTimeoutMs);
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdoutBuffer += chunk;
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() ?? "";
            for (const line of lines) {
                transcript.accept(line);
            }
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (timedOut) {
                return;
            }
            transcript.accept(stdoutBuffer);
            if (code === 0) {
                const response = transcript.response;
                if (response.length === 0) {
                    reject(
                        new Error(
                            `Agency ${options.sessionName} session returned no agent response. ${stderr.trim()}`,
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

class AgencyTranscriptRenderer {
    readonly #responses: string[] = [];
    readonly #printedResponses = new Set<string>();
    readonly #memoryRequests = new Map<string, Record<string, unknown>>();
    readonly #queryRequests = new Map<string, Record<string, unknown>>();
    readonly #indexedEvidence: ReadonlyMap<string, IndexedEvidence>;
    #printedRetrieval = false;

    public constructor(indexedEvidence: ReadonlyMap<string, IndexedEvidence>) {
        this.#indexedEvidence = indexedEvidence;
    }

    public get response(): string {
        return this.#responses.join("\n").trim();
    }

    public accept(line: string): void {
        if (line.trim().length === 0) {
            return;
        }
        let event: Record<string, unknown>;
        try {
            event = JSON.parse(line) as Record<string, unknown>;
        } catch {
            return;
        }
        const type = stringValue(event.type);
        const data = recordValue(event.data);
        if (type === "assistant.message") {
            this.printAgentResponse(stringValue(data?.content));
            return;
        }
        if (type === "session.task_complete") {
            if (this.#responses.length === 0) {
                this.printAgentResponse(stringValue(data?.summary));
            }
            return;
        }
        if (type === "tool.execution_start") {
            this.startTool(data);
            return;
        }
        if (type === "tool.execution_complete") {
            this.completeTool(data);
        }
    }

    private startTool(data: Record<string, unknown> | undefined): void {
        const toolCallId = stringValue(data?.toolCallId);
        const toolName = stringValue(data?.toolName);
        const argumentsValue = recordValue(data?.arguments);
        if (toolName === undefined) {
            return;
        }
        if (toolName.endsWith("memory_store") && toolCallId !== undefined) {
            this.#memoryRequests.set(toolCallId, argumentsValue ?? {});
            return;
        }
        if (toolName.endsWith("memory_query")) {
            if (toolCallId !== undefined) {
                this.#queryRequests.set(toolCallId, argumentsValue ?? {});
            }
        }
    }

    private completeTool(data: Record<string, unknown> | undefined): void {
        if (data?.success !== true) {
            return;
        }
        const toolCallId = stringValue(data.toolCallId);
        if (toolCallId === undefined) {
            return;
        }
        const queryRequest = this.#queryRequests.get(toolCallId);
        if (queryRequest !== undefined) {
            this.#queryRequests.delete(toolCallId);
            if (!this.#printedRetrieval) {
                this.#printedRetrieval = true;
                this.printRetrieval(queryRequest, data);
            }
            return;
        }
        const request = this.#memoryRequests.get(toolCallId);
        if (request === undefined) {
            return;
        }
        this.#memoryRequests.delete(toolCallId);
        const result = recordValue(data.result);
        const payload = parseJsonRecord(stringValue(result?.content));
        const memory = recordValue(payload?.memory);
        const revision = recordValue(memory?.revision);
        const head = recordValue(memory?.head);
        const observedAt = stringValue(
            recordValue(revision?.provenance)?.observedAt,
        );
        const indexed =
            observedAt === undefined
                ? undefined
                : this.#indexedEvidence.get(observedAt);
        const tags = arrayOfStrings(revision?.tags);

        console.log("MEMORY  stored durable observation");
        console.log(
            `  Memory: ${stringValue(revision?.memoryId) ?? "unknown"}  rev ${numberValue(revision?.revision) ?? "?"}  ${stringValue(head?.state) ?? "active"}`,
        );
        if (indexed !== undefined) {
            console.log(`  Topic:  ${indexed.topicPath}`);
            console.log(
                `  Index:  topic ${indexed.topicId} | turn ${indexed.turnId}`,
            );
            console.log(`  Query:  /topics${indexed.topicPath}/turns`);
        }
        if (tags.length > 0) {
            console.log(`  Tags:   ${tags.join(", ")}`);
        }
        console.log(
            `  Fact:   ${stringValue(revision?.content) ?? stringValue(request.content) ?? "stored"}`,
        );
        console.log();
    }

    private printRetrieval(
        request: Record<string, unknown>,
        data: Record<string, unknown>,
    ): void {
        const result = recordValue(data.result);
        const payload = parseJsonRecord(stringValue(result?.content));
        const packet = recordValue(payload?.packet);
        const references = Array.isArray(packet?.references)
            ? packet.references.length
            : undefined;
        console.log("MEMORY  recalled durable evidence");
        console.log(
            `  Query:     ${stringValue(request.query) ?? "/memories"}`,
        );
        const retrievalId = stringValue(payload?.retrievalId);
        if (retrievalId !== undefined) {
            console.log(`  Retrieval: ${retrievalId}`);
        }
        if (references !== undefined) {
            console.log(`  Records:   ${references}`);
        }
        console.log();
    }

    private printAgentResponse(content: string | undefined): void {
        const response = content?.trim();
        if (
            response === undefined ||
            response.length === 0 ||
            this.#printedResponses.has(response)
        ) {
            return;
        }
        this.#printedResponses.add(response);
        this.#responses.push(response);
        console.log("AGENT");
        console.log(indent(response));
        console.log();
    }
}

function indexEvidenceTurns(
    repository: SqliteMemoryRepository,
    ids: SequenceIdGenerator,
    scope: ReturnType<typeof createAccessScope>,
): ReadonlyMap<string, IndexedEvidence> {
    const recorder = new RecordTurnService(repository, undefined, ids);
    const indexed = new Map<string, IndexedEvidence>();
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
        indexed.set(turn.at, {
            topicPath: turn.topicPath,
            topicId: result.primaryTopicId,
            turnId: result.turnId,
        });
    }
    return indexed;
}

function printAnalystMessage(at: string, message: string): void {
    console.log(`ANALYST  ${formatTime(at)}`);
    console.log(indent(message));
    console.log();
}

function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
    });
}

function indent(text: string): string {
    return text
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

function arrayOfStrings(value: unknown): readonly string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
}

function parseJsonRecord(
    value: string | undefined,
): Record<string, unknown> | undefined {
    if (value === undefined) {
        return undefined;
    }
    try {
        return recordValue(JSON.parse(value));
    } catch {
        return undefined;
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
