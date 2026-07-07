// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    AgentMessageKind,
    AppAgent,
    DisplayContent,
    SessionContext,
    Storage,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { TimerAction } from "./timerSchema.js";

type Reminder = {
    id: string;
    message: string;
    fireAt: number; // Date.now() ms
    kind: AgentMessageKind;
    // For repeating reminders. After firing, the loop re-schedules
    // fireAt = now + repeatMs and decrements remainingFires (if set).
    repeatMs?: number;
    remainingFires?: number;
};

type TimerContext = {
    reminders: Map<string, Reminder>;
    nextId: number;
    intervalHandle?: ReturnType<typeof setInterval>;
};

// Persistence: pending reminders survive a dispatcher restart so timers
// the user set don't vanish silently. Stored under sessionStorage so the
// state is per-conversation. A reminder whose fireAt is in the past on
// rehydration fires on the next tick (intentional — "you missed this,
// here it is now").
const STORAGE_FILE = "reminders.json";

type PersistedState = {
    nextId: number;
    reminders: Reminder[];
};

async function loadPersistedState(
    storage: Storage | undefined,
): Promise<PersistedState> {
    if (!storage) return { nextId: 0, reminders: [] };
    try {
        if (!(await storage.exists(STORAGE_FILE))) {
            return { nextId: 0, reminders: [] };
        }
        const data = await storage.read(STORAGE_FILE, "utf8");
        const parsed = JSON.parse(data);
        return {
            nextId: typeof parsed.nextId === "number" ? parsed.nextId : 0,
            reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        };
    } catch {
        return { nextId: 0, reminders: [] };
    }
}

// Best-effort save. Fire-and-forget — a failed write doesn't propagate
// to the caller (e.g. the action result still succeeds).
function persistAsync(storage: Storage | undefined, ctx: TimerContext): void {
    if (!storage) return;
    const state: PersistedState = {
        nextId: ctx.nextId,
        reminders: Array.from(ctx.reminders.values()),
    };
    storage.write(STORAGE_FILE, JSON.stringify(state)).catch((e) => {
        console.error("timer-agent: failed to persist reminders", e);
    });
}

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
    if (action.actionName === "repeatReminder") {
        return tryParseWhen(action.parameters.every) !== undefined;
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
    // Rehydrate any reminders persisted in a previous session. A reminder
    // whose fireAt has already passed will fire on the next tick.
    const persisted = await loadPersistedState(context.sessionStorage);
    ctx.nextId = Math.max(ctx.nextId, persisted.nextId);
    for (const r of persisted.reminders) {
        ctx.reminders.set(r.id, r);
    }
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
    if (due.length === 0) return;

    for (const reminder of due) {
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

            console.error(
                `timer-agent: failed to fire reminder ${reminder.id}`,
                e,
            );
        }

        if (reminder.repeatMs !== undefined) {
            // Repeating: decrement remaining-fires counter (if set) and
            // re-schedule. Drop if the counter hits zero.
            if (reminder.remainingFires !== undefined) {
                reminder.remainingFires -= 1;
                if (reminder.remainingFires <= 0) {
                    ctx.reminders.delete(reminder.id);
                    continue;
                }
            }
            reminder.fireAt = now + reminder.repeatMs;
        } else {
            ctx.reminders.delete(reminder.id);
        }
    }
    // State has changed — save once per tick after all due reminders
    // are processed, instead of once per reminder.
    persistAsync(context.sessionStorage, ctx);
}

async function executeTimerAction(
    action: TypeAgentAction<TimerAction>,
    actionContext: ActionContext<TimerContext>,
): Promise<ActionResult | undefined> {
    const ctx = actionContext.sessionContext.agentContext;
    const storage = actionContext.sessionContext.sessionStorage;
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
            persistAsync(storage, ctx);
            const delaySec = Math.max(
                0,
                Math.round((fireAt - Date.now()) / 1000),
            );
            return createActionResultFromTextDisplay(
                `Reminder ${id} set: "${message}" in ${delaySec}s (kind: ${resolvedKind}).`,
            );
        }
        case "repeatReminder": {
            const { message, every, kind, count } = action.parameters;
            const interval = parseWhen(every);
            const repeatMs = Math.max(1000, interval - Date.now());
            const id = String(ctx.nextId++);
            const resolvedKind: AgentMessageKind = kind ?? "bubble";
            const reminder: Reminder = {
                id,
                message,
                fireAt: Date.now() + repeatMs,
                kind: resolvedKind,
                repeatMs,
            };
            if (count !== undefined && count > 0) {
                reminder.remainingFires = count;
            }
            ctx.reminders.set(id, reminder);
            persistAsync(storage, ctx);
            const intervalSec = Math.round(repeatMs / 1000);
            const limitSuffix =
                reminder.remainingFires !== undefined
                    ? ` for ${reminder.remainingFires} fires`
                    : "";
            return createActionResultFromTextDisplay(
                `Repeat reminder ${id} set: "${message}" every ${intervalSec}s${limitSuffix} (kind: ${resolvedKind}).`,
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
                if (r.repeatMs !== undefined) {
                    const intervalSec = Math.round(r.repeatMs / 1000);
                    const remaining =
                        r.remainingFires !== undefined
                            ? `, ${r.remainingFires} left`
                            : "";
                    lines.push(
                        `- ${r.id}: "${r.message}" every ${intervalSec}s (next in ${sec}s, ${r.kind}${remaining})`,
                    );
                } else {
                    lines.push(
                        `- ${r.id}: "${r.message}" in ${sec}s (${r.kind})`,
                    );
                }
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
                persistAsync(storage, ctx);
                return createActionResultFromTextDisplay(
                    `Cancelled ${n} reminder(s).`,
                );
            }
            if (ctx.reminders.delete(id)) {
                persistAsync(storage, ctx);
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
