// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AgentMessageKind,
    AppAgent,
    DisplayContent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { TimerAction } from "./timerSchema.js";

type Reminder = {
    id: string;
    message: string;
    fireAt: number; // Date.now() ms
    kind: AgentMessageKind;
};

type TimerContext = {
    reminders: Map<string, Reminder>;
    nextId: number;
    intervalHandle?: ReturnType<typeof setInterval>;
};

// Parse a "when" string. Accepts:
//   - duration suffixes: "5s", "30 sec", "10m", "10 minutes", "1h", "2 hours"
//   - absolute ISO 8601 timestamps: "2026-05-04T15:30:00"
// Returns the absolute fire time in ms, or undefined if the string is not
// a recognized duration or timestamp. Used both at execution time and from
// validateWildcardMatch to reject bad grammar groupings (e.g. when the
// wildcard captures trailing words that aren't part of the duration).
function tryParseWhen(when: string): number | undefined {
    const trimmed = when.trim();
    const m = trimmed.match(
        /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i,
    );
    if (m) {
        const n = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        const seconds = unit.startsWith("s")
            ? n
            : unit.startsWith("m")
              ? n * 60
              : n * 3600;
        return Date.now() + seconds * 1000;
    }
    const t = Date.parse(trimmed);
    if (!Number.isNaN(t)) return t;
    return undefined;
}

function parseWhen(when: string): number {
    const t = tryParseWhen(when);
    if (t === undefined) {
        throw new Error(
            `Cannot parse 'when' value: "${when}". Expected a duration like "5s" / "10m" / "1h" or an ISO 8601 timestamp.`,
        );
    }
    return t;
}

// Reject grammar matches where the $(when:wildcard) capture isn't a real
// duration / timestamp — e.g. "in 5s (kind toast)" matches the grammar but
// the wildcard greedily swallows trailing tokens. Returning false makes the
// dispatcher discard this match and fall back to LLM translation.
async function timerValidateWildcardMatch(
    action: TimerAction,
): Promise<boolean> {
    if (action.actionName === "setReminder") {
        return tryParseWhen(action.parameters.when) !== undefined;
    }
    return true;
}

async function initializeTimerContext(): Promise<TimerContext> {
    return {
        reminders: new Map(),
        nextId: 0,
    };
}

async function startBackgroundTasks(
    context: SessionContext<TimerContext>,
): Promise<void> {
    const ctx = context.agentContext;
    // Idempotent: if a previous startBackgroundTasks didn't get torn down,
    // clear it before installing a new tick. (Shouldn't happen under normal
    // lifecycle, but defends against double-init during dev reloads.)
    if (ctx.intervalHandle !== undefined) {
        clearInterval(ctx.intervalHandle);
    }
    ctx.intervalHandle = setInterval(() => fireDueReminders(context), 1000);
}

async function stopBackgroundTasks(
    context: SessionContext<TimerContext>,
): Promise<void> {
    const ctx = context.agentContext;
    if (ctx.intervalHandle !== undefined) {
        clearInterval(ctx.intervalHandle);
        delete ctx.intervalHandle;
    }
}

function fireDueReminders(context: SessionContext<TimerContext>) {
    const ctx = context.agentContext;
    const now = Date.now();
    // Snapshot first so we can mutate the map inside the loop.
    const due: Reminder[] = [];
    for (const r of ctx.reminders.values()) {
        if (r.fireAt <= now) due.push(r);
    }
    for (const reminder of due) {
        ctx.reminders.delete(reminder.id);
        try {
            const thread = context.beginAgentThread(reminder.kind);
            const content: DisplayContent = {
                type: "text",
                content: `⏰ ${reminder.message}`,
                kind: "info",
            };
            thread.setDisplay(content);
            thread.complete();
        } catch (e) {
            // Don't let one bad reminder kill the loop.
            // eslint-disable-next-line no-console
            console.error(
                `timer-agent: failed to fire reminder ${reminder.id}`,
                e,
            );
        }
    }
}

async function executeTimerAction(
    action: TypeAgentAction<TimerAction>,
    actionContext: ActionContext<TimerContext>,
): Promise<ActionResult | undefined> {
    const ctx = actionContext.sessionContext.agentContext;
    switch (action.actionName) {
        case "setReminder": {
            const { message, when, kind } = action.parameters;
            const fireAt = parseWhen(when);
            const id = String(ctx.nextId++);
            const resolvedKind: AgentMessageKind = kind ?? "bubble";
            ctx.reminders.set(id, {
                id,
                message,
                fireAt,
                kind: resolvedKind,
            });
            const delaySec = Math.max(
                0,
                Math.round((fireAt - Date.now()) / 1000),
            );
            return createActionResultFromTextDisplay(
                `Reminder ${id} set: "${message}" in ${delaySec}s (kind: ${resolvedKind}).`,
            );
        }
        case "listReminders": {
            if (ctx.reminders.size === 0) {
                return createActionResultFromTextDisplay(
                    "No pending reminders.",
                );
            }
            const now = Date.now();
            const lines: string[] = [];
            for (const r of ctx.reminders.values()) {
                const sec = Math.max(0, Math.round((r.fireAt - now) / 1000));
                lines.push(
                    `- ${r.id}: "${r.message}" in ${sec}s (${r.kind})`,
                );
            }
            return createActionResultFromTextDisplay(
                `Pending reminders:\n${lines.join("\n")}`,
            );
        }
        case "cancelReminder": {
            const { id } = action.parameters;
            if (id === "all") {
                const n = ctx.reminders.size;
                ctx.reminders.clear();
                return createActionResultFromTextDisplay(
                    `Cancelled ${n} reminder(s).`,
                );
            }
            if (ctx.reminders.delete(id)) {
                return createActionResultFromTextDisplay(
                    `Cancelled reminder ${id}.`,
                );
            }
            return createActionResultFromTextDisplay(
                `No reminder with id ${id}.`,
            );
        }
    }
}

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeTimerContext,
        executeAction: executeTimerAction,
        validateWildcardMatch: timerValidateWildcardMatch,
        startBackgroundTasks,
        stopBackgroundTasks,
    };
}
