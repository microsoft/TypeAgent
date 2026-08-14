import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
    MacroManager,
    type RecordedInteractionTrace,
} from "@typeagent/copilot-macros";

function completeTrace(
    sessionId: string,
    cwd: string,
): RecordedInteractionTrace {
    return {
        schemaVersion: 1,
        sessionId,
        cwd,
        prompt: "Use token=prompt-secret",
        response: "Done",
        startedAt: "2026-08-14T10:00:00.000Z",
        completedAt: "2026-08-14T10:00:01.000Z",
        toolCalls: [
            {
                toolCallId: "call-1",
                name: "read_data",
                arguments: { apiKey: "argument-secret" },
                result: { password: "result-secret", ok: true },
                status: "completed",
            },
        ],
    };
}

describe("MacroManager recording lifecycle", () => {
    it("claims one interaction and stores an immutable redacted trace", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "macros-"));
        const manager = new MacroManager(instanceDir);
        const armed = manager.armRecording({ sessionId: "session-1" });
        const claimed = manager.claimRecording({
            sessionId: "session-1",
            cwd: "C:\\repo",
            promptHash: createHash("sha256")
                .update("Use [REDACTED]")
                .digest("hex"),
        });

        const summary = await manager.finalizeRecording({
            tokenId: claimed!.id,
            trace: completeTrace("session-1", "C:\\repo"),
        });
        const stored = await readFile(
            path.join(
                instanceDir,
                "copilot-macros",
                "traces",
                `${summary.traceId}.json`,
            ),
            "utf8",
        );

        expect(armed.status).toBe("armed");
        expect(manager.getRecordingState("session-1")).toEqual({
            status: "completed",
            trace: summary,
        });
        expect(stored).not.toContain("prompt-secret");
        expect(stored).not.toContain("argument-secret");
        expect(stored).not.toContain("result-secret");
        await expect(
            manager.finalizeRecording({
                tokenId: claimed!.id,
                trace: completeTrace("session-1", "C:\\repo"),
            }),
        ).rejects.toThrow("not active");
    });

    it("does not store an incomplete trace", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "macros-"));
        const manager = new MacroManager(instanceDir);
        manager.armRecording({ sessionId: "session-1" });
        const claimed = manager.claimRecording({
            sessionId: "session-1",
            cwd: ".",
            promptHash: createHash("sha256")
                .update("Use [REDACTED]")
                .digest("hex"),
        });
        const trace = completeTrace("session-1", ".");
        trace.toolCalls[0].result = undefined;

        await expect(
            manager.finalizeRecording({ tokenId: claimed!.id, trace }),
        ).rejects.toThrow("incomplete");
        expect(manager.getRecordingState("session-1").status).toBe("claimed");
    });

    it("rejects a trace for a different claimed prompt", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "macros-"));
        const manager = new MacroManager(instanceDir);
        manager.armRecording({ sessionId: "session-1" });
        const claimed = manager.claimRecording({
            sessionId: "session-1",
            cwd: ".",
            promptHash: createHash("sha256").update("different").digest("hex"),
        });

        await expect(
            manager.finalizeRecording({
                tokenId: claimed!.id,
                trace: completeTrace("session-1", "."),
            }),
        ).rejects.toThrow("incomplete");
    });

    it("allows only one simultaneous finalization", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "macros-"));
        const manager = new MacroManager(instanceDir);
        manager.armRecording({ sessionId: "session-1" });
        const claimed = manager.claimRecording({
            sessionId: "session-1",
            cwd: ".",
            promptHash: createHash("sha256")
                .update("Use [REDACTED]")
                .digest("hex"),
        });
        const request = {
            tokenId: claimed!.id,
            trace: completeTrace("session-1", "."),
        };

        const results = await Promise.allSettled([
            manager.finalizeRecording(request),
            manager.finalizeRecording(request),
        ]);

        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            results.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);
    });

    it("expires recording tokens", async () => {
        const manager = new MacroManager("unused");
        manager.armRecording({ sessionId: "session-1", ttlMs: 1 });
        await new Promise((resolve) => setTimeout(resolve, 5));

        expect(manager.getRecordingState("session-1")).toEqual({
            status: "idle",
        });
    });
});
