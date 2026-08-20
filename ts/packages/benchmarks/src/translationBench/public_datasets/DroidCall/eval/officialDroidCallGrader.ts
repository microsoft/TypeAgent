// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type {
    DroidCallGoldAction,
    DroidCallTool,
} from "../toTypeAgentSchema.js";

export type DroidCallContractName =
    | "paper-described"
    | "released"
    | "typeagent-adjusted";

export interface DroidCallContractScore {
    softAccuracy: number;
    accuracy: number;
    counts: {
        rows: number;
        perfectRows: number;
        correctArguments: number;
        totalArguments: number;
        functionCalls: number;
    };
    contract: {
        name: DroidCallContractName;
        scorerRevision: string;
        bertScore: string;
        transformers: string;
        semanticThreshold: number;
        softAccuracyAggregation: "function-call-mean" | "sample-mean";
        overrides: {
            tool: "ACTION_OPEN_DOCUMENT";
            argument: "mime_types";
            comparison: "presence-only";
        }[];
    };
}

export interface DroidCallOfficialRow {
    response: { name: string; arguments: Record<string, unknown> }[];
    answers: readonly DroidCallGoldAction[];
}

interface PendingScore {
    resolve: (score: DroidCallContractScore) => void;
    reject: (error: Error) => void;
}

export class DroidCallContractGrader {
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly pending: PendingScore[] = [];
    private stderr = "";
    private processError: Error | undefined;

    public constructor(scriptPath: string) {
        this.child = spawn(
            "uv",
            [
                "run",
                "--with",
                "bert-score==0.3.13",
                "--with",
                "transformers==4.48.1",
                "python3",
                scriptPath,
                "--jsonl",
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
        );
        this.child.stderr.setEncoding("utf8");
        this.child.stderr.on("data", (chunk: string) => {
            this.stderr = (this.stderr + chunk).slice(-8_000);
        });
        this.child.stdin.on("error", (error) =>
            this.fail(
                new Error(
                    `Official DroidCall grader input failed: ${error.message}; ${this.stderr}`,
                ),
            ),
        );
        this.child.on("error", (error) => this.fail(error));
        this.child.on("exit", (code) => {
            if (code !== 0 && this.processError === undefined) {
                this.fail(
                    new Error(
                        `Official DroidCall grader exited ${code}: ${this.stderr}`,
                    ),
                );
            }
        });
        const lines = createInterface({ input: this.child.stdout });
        lines.on("line", (line) => {
            const next = this.pending.shift();
            if (next === undefined) return;
            try {
                const value = JSON.parse(line) as
                    | DroidCallContractScore
                    | { error: string };
                if ("error" in value) throw new Error(value.error);
                next.resolve(value);
            } catch (error) {
                next.reject(
                    error instanceof Error ? error : new Error(String(error)),
                );
            }
        });
    }

    public score(
        rows: readonly DroidCallOfficialRow[],
        apis: readonly DroidCallTool[],
        contract: DroidCallContractName,
    ): Promise<DroidCallContractScore> {
        if (this.processError !== undefined) {
            return Promise.reject(this.processError);
        }
        return new Promise((resolve, reject) => {
            this.pending.push({ resolve, reject });
            this.child.stdin.write(
                `${JSON.stringify({ rows, apis, contract })}\n`,
            );
        });
    }

    public async close(): Promise<void> {
        if (this.child.exitCode !== null) return;
        const exited = new Promise<void>((resolve) =>
            this.child.once("exit", () => resolve()),
        );
        this.child.stdin.end();
        await exited;
    }

    private fail(error: Error): void {
        this.processError = error;
        for (const pending of this.pending.splice(0)) pending.reject(error);
    }
}
