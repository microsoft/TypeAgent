// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QueuedRequest, QueueSnapshot } from "@typeagent/dispatcher-types";
import {
    attachDoubleEscape,
    QueueChipChatPanel,
    QueueChipController,
} from "../src/queueChipController.js";

// ── Test scaffolding ────────────────────────────────────────────────────

interface ChipCall {
    rid: string;
    status: "queued" | "running" | null;
    onCancel?: () => void;
}

function makePanel(messages: string[] = []) {
    const known = new Set(messages);
    const chipCalls: ChipCall[] = [];
    const addedRemote: { text: string; rid: string }[] = [];
    let activeRequestId: string | undefined;
    const panel: QueueChipChatPanel & {
        getActiveRequestId(): string | undefined;
    } = {
        hasUserMessage: (rid) => known.has(rid),
        addRemoteUserMessage: (text, rid) => {
            known.add(rid);
            addedRemote.push({ text, rid });
        },
        setUserBubbleQueueStatus: (rid, status, onCancel) => {
            chipCalls.push({ rid, status, onCancel });
        },
        getActiveRequestId: () => activeRequestId,
    };
    return {
        panel,
        known,
        chipCalls,
        addedRemote,
        setActive(id: string | undefined) {
            activeRequestId = id;
        },
    };
}

let nextVersion = 1;
function newVersion() {
    return nextVersion++;
}

function entry(over: Partial<QueuedRequest> = {}): QueuedRequest {
    return {
        requestId: "r1",
        originatorConnectionId: "conn-1",
        text: "hello",
        submittedAt: 0,
        state: "queued",
        ...over,
    };
}

function snapshot(over: Partial<QueueSnapshot> = {}): QueueSnapshot {
    return {
        running: null,
        queued: [],
        paused: false,
        version: newVersion(),
        ...over,
    };
}

// ── chipTargetRid narrowing ────────────────────────────────────────────

describe("QueueChipController.chipTargetRid", () => {
    let ctrl: QueueChipController;
    beforeEach(() => {
        const fx = makePanel();
        ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
    });

    test("uses clientRequestId when it is a string", () => {
        const e = entry({ clientRequestId: "client-abc" });
        expect(ctrl.chipTargetRid(e)).toBe("client-abc");
    });

    test("ignores non-string clientRequestId and falls back to server requestId", () => {
        const e = entry({
            clientRequestId: 42 as unknown as string,
            requestId: "srv-fallback",
        });
        expect(ctrl.chipTargetRid(e)).toBe("srv-fallback");
    });

    test("falls back to server requestId when neither is usable", () => {
        const e = entry({ requestId: "srv-7" });
        expect(ctrl.chipTargetRid(e)).toBe("srv-7");
    });
});

// ── applyQueueChip defer-and-flush ─────────────────────────────────────

describe("applyQueueChip / flushPending", () => {
    test("stashes chip when bubble does not yet exist, applies on flush", () => {
        const fx = makePanel();
        let cancelled: string | undefined;
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: (id) => {
                cancelled = id;
            },
        });

        ctrl.applyQueueChip("peer-1", "server-peer-1", "queued");
        // Nothing stamped — bubble doesn't exist yet.
        expect(fx.chipCalls).toEqual([]);

        // Materialize bubble, flush pending.
        fx.known.add("peer-1");
        ctrl.flushPending("peer-1");
        expect(fx.chipCalls).toHaveLength(1);
        expect(fx.chipCalls[0].rid).toBe("peer-1");
        expect(fx.chipCalls[0].status).toBe("queued");
        // The × button must cancel by the SERVER id.
        fx.chipCalls[0].onCancel?.();
        expect(cancelled).toBe("server-peer-1");
    });

    test("clearQueueChip removes pending stash, subsequent flush is a no-op", () => {
        const fx = makePanel();
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        ctrl.applyQueueChip("peer-1", "server-peer-1", "queued");
        ctrl.clearQueueChip("peer-1");
        // clearQueueChip emits a null setUserBubbleQueueStatus and drops
        // the stash; a subsequent flush after the bubble materializes
        // must NOT resurrect the chip.
        fx.known.add("peer-1");
        fx.chipCalls.length = 0;
        ctrl.flushPending("peer-1");
        expect(fx.chipCalls).toEqual([]);
    });

    test("running chips have no onCancel binding", () => {
        const fx = makePanel(["local-1"]);
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        ctrl.applyQueueChip("local-1", "server-r1", "running");
        expect(fx.chipCalls[0].status).toBe("running");
        expect(fx.chipCalls[0].onCancel).toBeUndefined();
    });
});

// ── onRequestStarted clears previousRunning ────────────────────────────

describe("onRequestStarted", () => {
    test("clears chip on the previous running entry's bubble", () => {
        const fx = makePanel(["client-A", "client-B"]);
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        const a = entry({ requestId: "A", clientRequestId: "client-A" });
        const b = entry({ requestId: "B", clientRequestId: "client-B" });

        const v1 = newVersion();
        ctrl.onRequestStarted(a, v1);
        const v2 = newVersion();
        ctrl.onRequestStarted(b, v2);

        const clearedAids = fx.chipCalls.filter(
            (c) => c.rid === "client-A" && c.status === null,
        );
        expect(clearedAids).toHaveLength(1);
        const bStarted = fx.chipCalls.find(
            (c) => c.rid === "client-B" && c.status === "running",
        );
        expect(bStarted).toBeDefined();
    });
});

// ── onRequestCancelled returns matched + clears under both id forms ────

describe("onRequestCancelled", () => {
    test("returns matched entry and clears chip under both id forms", () => {
        const fx = makePanel(["client-X"]);
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        const e = entry({ requestId: "server-X", clientRequestId: "client-X" });
        ctrl.onRequestQueued(e, newVersion());
        fx.chipCalls.length = 0;

        const res = ctrl.onRequestCancelled("server-X", newVersion());
        expect(res.admitted).toBe(true);
        expect(res.matched?.requestId).toBe("server-X");
        const cleared = fx.chipCalls.filter((c) => c.status === null);
        // chips cleared by BOTH the bubble key AND the raw server id
        expect(cleared.map((c) => c.rid).sort()).toEqual(
            ["client-X", "server-X"].sort(),
        );
    });

    test("stale version is reported (admitted=false) but chips still clear", () => {
        const fx = makePanel(["client-Y"]);
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        const e = entry({ requestId: "server-Y", clientRequestId: "client-Y" });
        ctrl.onRequestQueued(e, 10);
        fx.chipCalls.length = 0;
        const res = ctrl.onRequestCancelled("server-Y", 5);
        expect(res.admitted).toBe(false);
        // Even though stale, controller still clears the (now misleading)
        // chip so a dangling pill doesn't outlive the cancellation intent.
        const cleared = fx.chipCalls.filter((c) => c.status === null);
        expect(cleared.length).toBeGreaterThan(0);
    });
});

// ── reconcileQueueChips clears chips for entries no longer present ─────

describe("onQueueStateChanged / reconcile", () => {
    test("chips for entries dropped from the new snapshot are cleared", () => {
        const fx = makePanel(["client-A", "client-B"]);
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });

        // Snapshot 1: A running, B queued.
        const snap1 = snapshot({
            running: entry({ requestId: "A", clientRequestId: "client-A" }),
            queued: [entry({ requestId: "B", clientRequestId: "client-B" })],
        });
        ctrl.onQueueStateChanged(snap1);

        fx.chipCalls.length = 0;
        // Snapshot 2: B finished, A still running.
        const snap2 = snapshot({
            running: entry({ requestId: "A", clientRequestId: "client-A" }),
            queued: [],
        });
        ctrl.onQueueStateChanged(snap2);

        const clearedB = fx.chipCalls.find(
            (c) => c.rid === "client-B" && c.status === null,
        );
        expect(clearedB).toBeDefined();
    });
});

// ── reset clears pending + emits null for stashed bubbles ──────────────

describe("reset", () => {
    test("clears stashed pending chips and resets mirror", () => {
        const fx = makePanel();
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        ctrl.applyQueueChip("p1", "srv-1", "queued");
        ctrl.applyQueueChip("p2", "srv-2", "queued");
        fx.chipCalls.length = 0;

        ctrl.reset();
        // Each stashed bubble id received a null chip so any future
        // materialization doesn't show a stale pill.
        expect(fx.chipCalls.map((c) => c.rid).sort()).toEqual(
            ["p1", "p2"].sort(),
        );
        expect(fx.chipCalls.every((c) => c.status === null)).toBe(true);
        expect(ctrl.snapshot).toBeUndefined();
    });
});

// ── attachDoubleEscape ────────────────────────────────────────────────

describe("attachDoubleEscape", () => {
    function makeTarget() {
        const listeners: Array<(e: any) => void> = [];
        const target = {
            addEventListener: (_t: string, fn: (e: any) => void) => {
                listeners.push(fn);
            },
            removeEventListener: (_t: string, fn: (e: any) => void) => {
                const i = listeners.indexOf(fn);
                if (i >= 0) listeners.splice(i, 1);
            },
        } as unknown as Document;
        return {
            target,
            dispatch: (event: { key: string; defaultPrevented?: boolean }) => {
                let prevented = !!event.defaultPrevented;
                const e: any = {
                    ...event,
                    preventDefault: () => {
                        prevented = true;
                    },
                    get defaultPrevented() {
                        return prevented;
                    },
                };
                for (const fn of listeners) fn(e);
                return e;
            },
        };
    }

    test("single Esc cancels active request when one exists", () => {
        const fx = makePanel();
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        fx.setActive("running-1");
        const cancels: string[] = [];
        const alls: number[] = [];
        const t = makeTarget();
        attachDoubleEscape(fx.panel as any, ctrl, {
            target: t.target,
            onCancelActive: (id) => cancels.push(id),
            onCancelAll: () => alls.push(1),
        });
        const ev = t.dispatch({ key: "Escape" });
        expect(cancels).toEqual(["running-1"]);
        expect(alls).toEqual([]);
        expect(ev.defaultPrevented).toBe(true);
    });

    test("two Esc presses within window fire onCancelAll", () => {
        const fx = makePanel();
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        fx.setActive(undefined);
        const cancels: string[] = [];
        const alls: number[] = [];
        const t = makeTarget();
        attachDoubleEscape(fx.panel as any, ctrl, {
            target: t.target,
            windowMs: 1000,
            onCancelActive: (id) => cancels.push(id),
            onCancelAll: () => alls.push(1),
        });
        t.dispatch({ key: "Escape" });
        t.dispatch({ key: "Escape" });
        expect(alls).toEqual([1]);
    });

    test("defaultPrevented Esc still updates double-Esc clock", () => {
        const fx = makePanel();
        const ctrl = new QueueChipController({
            chatPanel: fx.panel,
            cancelById: () => {},
        });
        fx.setActive("a");
        const cancels: string[] = [];
        const alls: number[] = [];
        const t = makeTarget();
        attachDoubleEscape(fx.panel as any, ctrl, {
            target: t.target,
            onCancelActive: (id) => cancels.push(id),
            onCancelAll: () => alls.push(1),
        });
        // chat-ui's input handler "consumed" this one.
        t.dispatch({ key: "Escape", defaultPrevented: true });
        // A second press completes the gesture.
        t.dispatch({ key: "Escape" });
        expect(alls).toEqual([1]);
        // The first (prevented) press must NOT have routed to cancelActive.
        expect(cancels).toEqual(["a"]); // only the second non-prevented press
    });
});
