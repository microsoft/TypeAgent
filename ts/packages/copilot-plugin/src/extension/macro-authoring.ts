// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentServerConnection } from "@typeagent/agent-server-client";
import type {
    MacroAuthoringRequest,
    MacroAuthoringSubmission,
} from "@typeagent/copilot-macros";
import { randomUUID } from "node:crypto";
import { redactTraceValue } from "@typeagent/copilot-macros";

type AuthoringConnection = Pick<
    AgentServerConnection,
    | "claimMacroAuthoringRequest"
    | "submitMacroAuthoringResponse"
    | "getMacroLearningPreference"
    | "getMacroLearningJob"
    | "close"
>;

function waitForAuthoringPoll(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, 1000);
        timer.unref();
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
    });
}

async function callAuthoringBackend<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
): Promise<T> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    deadline.throwIfAborted();
    let interrupt!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        interrupt = () => reject(deadline.reason);
        deadline.addEventListener("abort", interrupt, { once: true });
    });
    try {
        return await Promise.race([operation(), interrupted]);
    } finally {
        deadline.removeEventListener("abort", interrupt);
    }
}

export interface MacroAuthoringWorkerOptions {
    sessionId: string;
    cwd: string;
    connect(): Promise<AuthoringConnection>;
    launch(
        prompt: string,
        signal: AbortSignal,
    ): Promise<{ text: string; childId: string }>;
    report(message: string): void;
}

export class MacroAuthoringWorker {
    private readonly workerId = randomUUID();
    private running: Promise<void> | undefined;
    private controller?: AbortController;
    private stopped = false;
    private until = 0;
    private rerunRequested = false;

    constructor(private readonly options: MacroAuthoringWorkerOptions) {}

    kick(): void {
        if (this.stopped) return;
        this.until = Date.now() + 125_000;
        if (this.running) {
            this.rerunRequested = this.controller?.signal.aborted === true;
            return;
        }
        this.controller = new AbortController();
        this.running = this.drain(this.controller.signal)
            .catch((error) => {
                if (!this.controller?.signal.aborted)
                    this.options.report(
                        `Copilot macro authoring stopped: ${error instanceof Error ? error.message : String(error)}. The original answer is unchanged; inspect macro status.`,
                    );
            })
            .finally(() => {
                this.running = undefined;
                if (this.rerunRequested) {
                    this.rerunRequested = false;
                    this.kick();
                }
            });
    }

    async close(): Promise<void> {
        this.stopped = true;
        this.controller?.abort(new Error("The Copilot authoring host closed."));
        await this.running;
    }

    pause(): void {
        this.until = 0;
        this.controller?.abort(
            new Error(
                "A new user task takes priority over background authoring.",
            ),
        );
    }

    private async drain(signal: AbortSignal): Promise<void> {
        const connection = await this.options.connect();
        try {
            if (
                (
                    await callAuthoringBackend(
                        () =>
                            connection.getMacroLearningPreference(
                                this.options.cwd,
                            ),
                        signal,
                    )
                ).mode === "off"
            )
                return;
            while (!signal.aborted && Date.now() < this.until) {
                const claim = {
                    cwd: this.options.cwd,
                    sessionId: this.options.sessionId,
                    workerId: this.workerId,
                };
                const request = await callAuthoringBackend(
                    () => connection.claimMacroAuthoringRequest(claim),
                    signal,
                );
                if (!request) {
                    await waitForAuthoringPoll(signal);
                    continue;
                }
                const outcome = await this.author(request, connection, signal);
                signal.throwIfAborted();
                if (!outcome) return;
                await callAuthoringBackend(
                    () =>
                        connection.submitMacroAuthoringResponse({
                            ...claim,
                            requestId: request.requestId,
                            leaseId: request.leaseId,
                            promptDigest: request.promptDigest,
                            outcome,
                        }),
                    signal,
                );
                this.until = Date.now() + 125_000;
            }
        } finally {
            await connection.close();
        }
    }

    private async author(
        request: MacroAuthoringRequest,
        connection: AuthoringConnection,
        signal: AbortSignal,
    ): Promise<MacroAuthoringSubmission["outcome"] | undefined> {
        const child = new AbortController();
        const monitoring = new AbortController();
        let stopped = false;
        let monitorError: unknown;
        const monitor = this.monitor(
            request,
            connection,
            monitoring.signal,
        ).then(
            (reason) => {
                if (reason) {
                    stopped = true;
                    child.abort(reason);
                }
            },
            (error) => {
                monitorError = error;
                child.abort(error);
            },
        );
        try {
            const result = await this.options.launch(
                `You are a restricted TypeAgent recipe-authoring child. Use only this explicit supported context, not inherited conversation or hidden reasoning. Do not call tools, read files, access credentials, execute business effects, or delegate. Return only the exact JSON required by the phase request. TypeAgent independently checks and publishes it.\nSEALED_CONTEXT:\n${JSON.stringify(request.context)}\nAUTHORING_PHASE:\n${request.prompt}`,
                AbortSignal.any([
                    signal,
                    child.signal,
                    AbortSignal.timeout(60_000),
                ]),
            );
            if (monitorError !== undefined) throw monitorError;
            if (stopped) return undefined;
            return { status: "completed", ...result };
        } catch (error) {
            signal.throwIfAborted();
            if (monitorError !== undefined) throw monitorError;
            if (stopped) return undefined;
            return {
                status: "failed",
                error: String(
                    redactTraceValue(
                        error instanceof Error ? error.message : String(error),
                    ),
                ).slice(0, 2000),
            };
        } finally {
            monitoring.abort();
            await monitor;
        }
    }

    private async monitor(
        request: MacroAuthoringRequest,
        connection: AuthoringConnection,
        signal: AbortSignal,
    ): Promise<Error | undefined> {
        while (!signal.aborted) {
            try {
                const [preference, job] = await callAuthoringBackend(
                    () =>
                        Promise.all([
                            connection.getMacroLearningPreference(
                                this.options.cwd,
                            ),
                            connection.getMacroLearningJob(request.jobId),
                        ]),
                    signal,
                );
                if (
                    preference.mode === "off" ||
                    ![
                        "queued",
                        "extracting",
                        "building",
                        "awaitingAuthor",
                    ].includes(job.status)
                )
                    return new Error(
                        "Learning was disabled or the authoring job is no longer active.",
                    );
            } catch (error) {
                if (signal.aborted) return undefined;
                throw error;
            }
            await waitForAuthoringPoll(signal);
        }
        return undefined;
    }
}
