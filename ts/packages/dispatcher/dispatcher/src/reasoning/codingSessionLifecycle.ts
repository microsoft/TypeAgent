// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotClient } from "@github/copilot-sdk";

const DEFAULT_STALE_SESSION_DAYS = 7;

function positiveNumber(value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getCodingSessionMaxAgeMs(
    env: NodeJS.ProcessEnv = process.env,
): number {
    const days =
        positiveNumber(env.TYPEAGENT_CODING_SESSION_MAX_AGE_DAYS) ??
        DEFAULT_STALE_SESSION_DAYS;
    return days * 24 * 60 * 60 * 1000;
}

export function isStaleTypeAgentCodingSession(
    session: { sessionId: string; modifiedTime: Date },
    now: number,
    maxAgeMs: number,
): boolean {
    return (
        session.sessionId.startsWith("typeagent-code-") &&
        now - session.modifiedTime.getTime() > maxAgeMs
    );
}

export async function pruneStaleCodingSessions(
    client: Pick<CopilotClient, "listSessions" | "deleteSession">,
    maxAgeMs: number,
    now = Date.now(),
): Promise<number> {
    const sessions = await client.listSessions();
    const stale = sessions.filter((session) =>
        isStaleTypeAgentCodingSession(session, now, maxAgeMs),
    );
    await Promise.all(
        stale.map((session) => client.deleteSession(session.sessionId)),
    );
    return stale.length;
}
