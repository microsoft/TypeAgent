// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type {
    MacroChildCapture,
    MacroChildAuthoringIdentity,
    RecordedInteractionTrace,
} from "../src/contracts.js";
import { sealMacroChildCapture } from "../src/macroChildCapture.js";

export function childCapture(
    trace: RecordedInteractionTrace,
    tokenId: string,
): MacroChildCapture {
    return {
        taskId: `${trace.sessionId}:root-user`,
        firstEventId: "root-user",
        successEventId: "root-success-receipt",
        outputEventId: "root-final-answer",
        recordingTokenId: tokenId,
    };
}

export function childIdentity(
    traceId: string,
    trace: RecordedInteractionTrace,
): MacroChildAuthoringIdentity {
    const token = {
        id: randomUUID(),
        sessionId: trace.sessionId,
        status: "claimed" as const,
        expiresAt: new Date(
            Date.parse(trace.completedAt) + 60_000,
        ).toISOString(),
    };
    const envelope = sealMacroChildCapture(
        traceId,
        trace,
        token,
        childCapture(trace, token.id),
        "all",
    );
    return {
        captureId: traceId,
        taskId: envelope.context.capture.taskId,
        tokenId: token.id,
        contextDigest: envelope.digest,
    };
}
