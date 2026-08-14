import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    ArmRecordingRequest,
    ClaimRecordingRequest,
    FinalizeRecordingRequest,
    RecordedInteractionTrace,
    RecordingState,
    RecordingToken,
    TraceSummary,
} from "./contracts.js";
import { redactTraceValue } from "./redaction.js";

const defaultRecordingTtlMs = 10 * 60 * 1000;

export class MacroManager {
    private readonly recordings = new Map<string, RecordingToken>();
    private readonly completed = new Map<string, TraceSummary>();
    private readonly failures = new Map<string, string>();
    private readonly rootDir: string;

    constructor(instanceDir: string) {
        this.rootDir = path.join(instanceDir, "copilot-macros");
    }

    armRecording(request: ArmRecordingRequest): RecordingToken {
        this.removeExpired(request.sessionId);
        if (this.recordings.has(request.sessionId)) {
            throw new Error(
                "A macro recording is already active for this session.",
            );
        }
        const ttlMs = request.ttlMs ?? defaultRecordingTtlMs;
        if (!request.sessionId || ttlMs <= 0) {
            throw new Error(
                "A session ID and positive recording TTL are required.",
            );
        }
        const token: RecordingToken = {
            id: randomUUID(),
            sessionId: request.sessionId,
            status: "armed",
            expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        };
        this.completed.delete(request.sessionId);
        this.failures.delete(request.sessionId);
        this.recordings.set(request.sessionId, token);
        return token;
    }

    getRecordingState(sessionId: string): RecordingState {
        this.removeExpired(sessionId);
        const token = this.recordings.get(sessionId);
        if (token) return { status: token.status, token };
        const trace = this.completed.get(sessionId);
        if (trace) return { status: "completed", trace };
        const error = this.failures.get(sessionId);
        return error ? { status: "failed", error } : { status: "idle" };
    }

    claimRecording(request: ClaimRecordingRequest): RecordingToken | undefined {
        this.removeExpired(request.sessionId);
        const current = this.recordings.get(request.sessionId);
        if (!current || current.status !== "armed") return undefined;
        if (!request.cwd || !request.promptHash) {
            throw new Error("Recording claims require cwd and promptHash.");
        }
        const claimed: RecordingToken = {
            ...current,
            status: "claimed",
            cwd: request.cwd,
            promptHash: request.promptHash,
        };
        this.recordings.set(request.sessionId, claimed);
        return claimed;
    }

    cancelRecording(sessionId: string): void {
        this.recordings.delete(sessionId);
        this.completed.delete(sessionId);
        this.failures.delete(sessionId);
    }

    failRecording(sessionId: string, tokenId: string, error: string): void {
        const token = this.recordings.get(sessionId);
        if (!token || token.id !== tokenId || token.status !== "claimed") {
            return;
        }
        this.recordings.delete(sessionId);
        this.failures.set(sessionId, error);
    }

    async finalizeRecording(
        request: FinalizeRecordingRequest,
    ): Promise<TraceSummary> {
        const token = [...this.recordings.values()].find(
            (candidate) => candidate.id === request.tokenId,
        );
        if (!token || token.status !== "claimed") {
            throw new Error("The macro recording token is not active.");
        }
        this.removeExpired(token.sessionId);
        if (!this.recordings.has(token.sessionId)) {
            throw new Error("The macro recording token has expired.");
        }
        this.validateTrace(token, request.trace);
        this.recordings.delete(token.sessionId);

        const traceId = randomUUID();
        const createdAt = new Date().toISOString();
        const storedTrace = redactTraceValue({
            ...request.trace,
            traceId,
            createdAt,
        }) as RecordedInteractionTrace & { traceId: string; createdAt: string };
        const tracesDir = path.join(this.rootDir, "traces");
        try {
            await mkdir(tracesDir, { recursive: true });
            const destination = path.join(tracesDir, `${traceId}.json`);
            const temporary = `${destination}.${randomUUID()}.tmp`;
            await writeFile(
                temporary,
                JSON.stringify(storedTrace, undefined, 2),
                {
                    encoding: "utf8",
                    flag: "wx",
                },
            );
            await rename(temporary, destination);
        } catch (error) {
            this.failures.set(
                token.sessionId,
                "The selected interaction could not be stored.",
            );
            throw error;
        }
        const summary: TraceSummary = {
            traceId,
            sessionId: token.sessionId,
            createdAt,
            toolCallCount: request.trace.toolCalls.length,
        };
        this.failures.delete(token.sessionId);
        this.completed.set(token.sessionId, summary);
        return summary;
    }

    private removeExpired(sessionId: string): void {
        const token = this.recordings.get(sessionId);
        if (token && Date.parse(token.expiresAt) <= Date.now()) {
            this.recordings.delete(sessionId);
        }
    }

    private validateTrace(
        token: RecordingToken,
        trace: RecordedInteractionTrace,
    ): void {
        if (
            trace.schemaVersion !== 1 ||
            trace.sessionId !== token.sessionId ||
            trace.cwd !== token.cwd ||
            createHash("sha256")
                .update(redactTraceValue(trace.prompt) as string)
                .digest("hex") !== token.promptHash ||
            !trace.prompt ||
            !trace.startedAt ||
            !trace.completedAt ||
            trace.toolCalls.some(
                (call) =>
                    !call.toolCallId || !call.name || call.result === undefined,
            )
        ) {
            throw new Error("The recorded interaction trace is incomplete.");
        }
    }
}
