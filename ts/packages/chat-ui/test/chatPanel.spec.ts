// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    describe,
    it,
    expect,
    afterEach,
    beforeEach,
    jest,
} from "@jest/globals";
import { ChatPanel } from "../src/chatPanel.js";
import { iconStop, iconJumpQueue, iconX, iconRetry } from "../src/icons.js";

// chat-ui is DOM-rendering; these tests run under jsdom (see jest.config.cjs)
// and assert the DOM produced by the status-rail / roadrunner affordances.

function makePanel(opts?: {
    onCancel?: (requestId: string) => void;
    onSend?: (
        text: string,
        attachments: string[] | undefined,
        requestId: string,
    ) => void;
}) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const panel = new ChatPanel(root, {
        platformAdapter: { handleLinkClick() {} },
        onCancel: opts?.onCancel,
        onSend: opts?.onSend,
    });
    return { root, panel };
}

function cancelledRail(
    root: HTMLElement,
    requestId: string,
): HTMLElement | null {
    return userBubble(root, requestId).querySelector<HTMLElement>(
        ".chat-message-user > .chat-message-cancelled-rail",
    );
}

function userBubble(root: HTMLElement, requestId: string): HTMLElement {
    const container = root.querySelector<HTMLElement>(
        `[data-request-id="${requestId}"]`,
    );
    if (!container) throw new Error(`no user bubble for ${requestId}`);
    return container;
}

function userRail(root: HTMLElement, requestId: string): HTMLElement | null {
    return userBubble(root, requestId).querySelector<HTMLElement>(
        ".chat-message-user > .chat-message-status-rail",
    );
}

function agentRail(root: HTMLElement): HTMLElement | null {
    return root.querySelector<HTMLElement>(
        ".chat-message-agent > .chat-message-status-rail",
    );
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("user status rail — queue state", () => {
    // The running ("sent") state schedules a real timer to auto-dismiss;
    // fake timers make that deterministic and avoid dangling timers.
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it("queued: renders 'queued' label + jump + remove, wiring callbacks", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");

        const onCancel = jest.fn();
        const onPromote = jest.fn();
        panel.setUserBubbleQueueStatus("req-1", "queued", onCancel, onPromote);

        const rail = userRail(root, "req-1");
        expect(rail).not.toBeNull();
        expect(rail!.dataset.status).toBe("queued");
        expect(
            rail!.querySelector(".chat-status-state")!.textContent,
        ).toContain("queued");

        const jump = rail!.querySelector<HTMLButtonElement>(
            '[data-action="jump-queue"]',
        );
        const remove = rail!.querySelector<HTMLButtonElement>(
            '[data-action="remove-from-queue"]',
        );
        expect(jump).not.toBeNull();
        expect(remove).not.toBeNull();

        jump!.click();
        expect(onPromote).toHaveBeenCalledTimes(1);
        remove!.click();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("running: shows 'sent' label and no queue controls", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");

        panel.setUserBubbleQueueStatus(
            "req-1",
            "running",
            jest.fn(),
            jest.fn(),
        );

        const rail = userRail(root, "req-1");
        expect(rail).not.toBeNull();
        expect(rail!.dataset.status).toBe("running");
        // The wire status is "running" but the user-facing label reads "sent".
        const stateText =
            rail!.querySelector(".chat-status-state")!.textContent;
        expect(stateText).toContain("sent");
        expect(stateText).not.toContain("running");
        expect(rail!.querySelector('[data-action="jump-queue"]')).toBeNull();
        expect(
            rail!.querySelector('[data-action="remove-from-queue"]'),
        ).toBeNull();
    });

    it("running: 'sent' auto-dismisses after the timeout", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");
        panel.setUserBubbleQueueStatus("req-1", "running");
        // Shown immediately as a transient acknowledgement.
        expect(userRail(root, "req-1")).not.toBeNull();

        // ...then removed once the timeout elapses, independent of any
        // agent/completion signal.
        jest.advanceTimersByTime(1500);
        expect(userRail(root, "req-1")).toBeNull();
    });

    it("running: the agent's first message dismisses 'sent' early", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");
        panel.setUserBubbleQueueStatus("req-1", "running");
        expect(userRail(root, "req-1")).not.toBeNull();

        // Agent starts responding before the timeout — "sent" clears now,
        // not at completion.
        panel.addAgentMessage("hi", "agent", undefined, undefined, "req-1");
        expect(userRail(root, "req-1")).toBeNull();
    });

    it("running: a later snapshot does not resurrect a dismissed 'sent'", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");
        panel.setUserBubbleQueueStatus("req-1", "running");

        // Dismiss via the timeout.
        jest.advanceTimersByTime(1500);
        expect(userRail(root, "req-1")).toBeNull();

        // The server keeps the request `running` and re-broadcasts it on the
        // next snapshot; the consumed guard keeps "sent" from reappearing.
        panel.setUserBubbleQueueStatus("req-1", "running");
        expect(userRail(root, "req-1")).toBeNull();
    });

    it("queued: persists across the timeout window (only 'sent' is transient)", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");
        panel.setUserBubbleQueueStatus("req-1", "queued", jest.fn(), jest.fn());

        jest.advanceTimersByTime(1500);
        const rail = userRail(root, "req-1");
        expect(rail).not.toBeNull();
        expect(rail!.dataset.status).toBe("queued");
    });

    it("null: cancels a pending 'sent' timer (no late dismissal)", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");
        panel.setUserBubbleQueueStatus("req-1", "running");
        panel.setUserBubbleQueueStatus("req-1", null);
        expect(userRail(root, "req-1")).toBeNull();

        // A full clear resets the id: a fresh running state shows "sent"
        // again (the earlier timer was cancelled and the consumed marker
        // dropped), and still auto-dismisses on its own timer.
        panel.setUserBubbleQueueStatus("req-1", "running");
        expect(userRail(root, "req-1")).not.toBeNull();
        jest.advanceTimersByTime(1500);
        expect(userRail(root, "req-1")).toBeNull();
    });

    it("null: clears the state and removes the rail (no empty title row)", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");
        panel.setUserBubbleQueueStatus("req-1", "queued", jest.fn(), jest.fn());
        expect(userRail(root, "req-1")).not.toBeNull();

        panel.setUserBubbleQueueStatus("req-1", null);
        expect(userRail(root, "req-1")).toBeNull();
    });

    it("no rail is rendered on an idle user bubble", () => {
        // An idle user bubble shows no rail until there's a queue state.
        const { root, panel } = makePanel();
        panel.addUserMessage("hello", "req-1");
        expect(userRail(root, "req-1")).toBeNull();
    });
});

describe("agent running rail", () => {
    it("stamps a 'working' rail + Stop once the agent bubble materializes", () => {
        const onCancel = jest.fn();
        const { root, panel } = makePanel({ onCancel });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");

        // No agent bubble yet → no agent rail.
        expect(agentRail(root)).toBeNull();

        panel.addAgentMessage(
            "response",
            "agent",
            undefined,
            undefined,
            "req-1",
        );

        const rail = agentRail(root);
        expect(rail).not.toBeNull();
        expect(rail!.dataset.status).toBe("running");
        expect(
            rail!.querySelector(".chat-status-state")!.textContent,
        ).toContain("working");

        const stop = rail!.querySelector<HTMLButtonElement>(
            '[data-action="stop"]',
        );
        expect(stop).not.toBeNull();
        stop!.click();
        expect(onCancel).toHaveBeenCalledWith("req-1");
    });

    it("completeRequest removes the working rail", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            "response",
            "agent",
            undefined,
            undefined,
            "req-1",
        );
        expect(agentRail(root)).not.toBeNull();

        panel.completeRequest("req-1");
        expect(agentRail(root)).toBeNull();
    });

    it("setIdle removes the working rail", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            "response",
            "agent",
            undefined,
            undefined,
            "req-1",
        );
        expect(agentRail(root)).not.toBeNull();

        panel.setIdle();
        expect(agentRail(root)).toBeNull();
    });

    it("step mode clears prior running rails and completion applies token metrics", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");

        panel.addAgentMessage(
            "phase 1",
            "dispatcher",
            undefined,
            "step",
            "req-1",
        );
        expect(
            root.querySelectorAll(
                ".chat-message-agent > .chat-message-status-rail",
            ).length,
        ).toBe(1);

        panel.addAgentMessage(
            "phase 2",
            "dispatcher",
            undefined,
            "step",
            "req-1",
        );
        // Only the current step bubble should still be marked running.
        expect(
            root.querySelectorAll(
                ".chat-message-agent > .chat-message-status-rail",
            ).length,
        ).toBe(1);

        panel.completeRequest("req-1", {
            totalDuration: 1500,
            actionTokenUsage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
            },
        });

        expect(
            root.querySelectorAll(
                ".chat-message-agent > .chat-message-status-rail",
            ).length,
        ).toBe(0);
        expect(root.textContent).toContain("Action Tokens:");
        expect(root.textContent).toContain("12");
    });
});

describe("roadrunner (explained) placement", () => {
    it("anchors the icon inside the content and tooltip on the bubble body", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("what's on my calendar?", "req-1");

        panel.notifyExplained("req-1", {
            fromCache: "construction",
            fromUser: false,
            time: "12:00:00 PM",
        });

        const bubble = userBubble(root, "req-1");
        const content = bubble.querySelector<HTMLElement>(
            ".chat-message-content",
        )!;
        // Icon lives inside the content bubble (with the command text).
        expect(content.classList.contains("chat-message-explained-host")).toBe(
            true,
        );
        expect(
            content.querySelector(".chat-message-explained-icon"),
        ).not.toBeNull();

        // Tooltip host is the bubble body (which doesn't clip overflow).
        const body = bubble.querySelector<HTMLElement>(".chat-message-user")!;
        expect(body.classList.contains("chat-message-explained")).toBe(true);
        expect(body.getAttribute("data-expl")).toBeTruthy();
    });
});

describe("icons", () => {
    it("each affordance icon renders an <svg> inside an <i> wrapper", () => {
        for (const make of [iconStop, iconJumpQueue, iconX, iconRetry]) {
            const el = make();
            expect(el.tagName).toBe("I");
            expect(el.querySelector("svg")).not.toBeNull();
        }
    });
});

describe("cancelled banner + retry", () => {
    // Drive a request through the real send path so the panel records the
    // command for Retry, then simulate the host's cancel completion.
    function sendAndType(
        panel: ChatPanel,
        text: string,
    ): { requestId: string } {
        // ChatPanel.send() reads the contenteditable input; type into it.
        const input = document.querySelector<HTMLElement>(
            ".user-textarea, [contenteditable]",
        )!;
        input.textContent = text;
        input.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        const bubble = document.querySelector<HTMLElement>(
            ".chat-message-container-user",
        )!;
        return { requestId: bubble.dataset.requestId! };
    }

    it("stamps a persistent Cancelled banner on the user bubble", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("do it", "req-1");

        const stamped = panel.markUserBubbleCancelled("req-1");
        expect(stamped).toBe(true);

        const rail = cancelledRail(root, "req-1");
        expect(rail).not.toBeNull();
        expect(rail!.textContent).toContain("Cancelled");
    });

    it("returns false and stamps nothing when there is no user bubble", () => {
        const { root, panel } = makePanel();
        expect(panel.markUserBubbleCancelled("missing")).toBe(false);
        expect(root.querySelector(".chat-message-cancelled-rail")).toBeNull();
    });

    it("completeRequest(cancelled) shows the banner and no duplicate agent bubble", () => {
        const { root, panel } = makePanel({ onSend: jest.fn() });
        const { requestId } = sendAndType(panel, "queued command");

        panel.completeRequest(requestId, { cancelled: true });

        // User bubble carries the banner...
        expect(cancelledRail(root, requestId)).not.toBeNull();
        // ...and no standalone "⚠ Cancelled" agent bubble was created for a
        // request that never produced agent output.
        expect(root.querySelector(".chat-message-container-agent")).toBeNull();
    });

    it("Retry reuses the existing bubble, re-keyed to a fresh id", () => {
        const onSend = jest.fn();
        const { root, panel } = makePanel({ onSend });
        const { requestId } = sendAndType(panel, "redo this");
        expect(onSend).toHaveBeenCalledTimes(1);

        panel.completeRequest(requestId, { cancelled: true });
        const retry = cancelledRail(
            root,
            requestId,
        )!.querySelector<HTMLButtonElement>('[data-action="retry"]');
        expect(retry).not.toBeNull();

        retry!.click();

        // A second send fired with the same text but a new request id.
        expect(onSend).toHaveBeenCalledTimes(2);
        const [firstText, , firstId] = onSend.mock.calls[0];
        const [secondText, , secondId] = onSend.mock.calls[1];
        expect(secondText).toBe(firstText);
        expect(secondId).not.toBe(firstId);

        // The existing bubble is reused (no new bubble added) and re-keyed to
        // the retry's id, with the Cancelled banner cleared.
        const bubbles = root.querySelectorAll(".chat-message-container-user");
        expect(bubbles.length).toBe(1);
        expect((bubbles[0] as HTMLElement).dataset.requestId).toBe(secondId);
        expect(root.querySelector(".chat-message-cancelled-rail")).toBeNull();
        // Display updates now target the reused bubble under the new id.
        expect(panel.hasUserMessage(secondId as string)).toBe(true);
        expect(panel.hasUserMessage(firstId as string)).toBe(false);
    });

    it("a later queue-chip clear leaves the cancelled banner intact", () => {
        const { root, panel } = makePanel({ onSend: jest.fn() });
        const { requestId } = sendAndType(panel, "queued command");

        panel.completeRequest(requestId, { cancelled: true });
        expect(cancelledRail(root, requestId)).not.toBeNull();

        // Simulate a stale queue snapshot reconcile clearing the status rail.
        panel.setUserBubbleQueueStatus(requestId, null);
        expect(cancelledRail(root, requestId)).not.toBeNull();
    });

    it("no Retry button when the sent command is unknown (peer bubble)", () => {
        const { root, panel } = makePanel({ onSend: jest.fn() });
        panel.addRemoteUserMessage("peer request", "peer-1");

        expect(panel.markUserBubbleCancelled("peer-1")).toBe(true);
        const rail = cancelledRail(root, "peer-1");
        expect(rail).not.toBeNull();
        expect(rail!.querySelector('[data-action="retry"]')).toBeNull();
    });
});

describe("notifications (persistent, dismissable)", () => {
    function agentBubbles(root: HTMLElement): HTMLElement[] {
        return Array.from(
            root.querySelectorAll<HTMLElement>(".chat-message-agent"),
        );
    }

    it("addNotification renders a persistent agent bubble", () => {
        const { root, panel } = makePanel();
        panel.addNotification("Build finished", "osNotifications", "os:1");
        const bubbles = agentBubbles(root);
        expect(bubbles.length).toBe(1);
        expect(bubbles[0].textContent).toContain("Build finished");
    });

    it("reusing an id updates the same bubble in place (no duplicate)", () => {
        const { root, panel } = makePanel();
        panel.addNotification("first", "osNotifications", "os:1");
        panel.addNotification("second", "osNotifications", "os:1");
        const bubbles = agentBubbles(root);
        expect(bubbles.length).toBe(1);
        expect(bubbles[0].textContent).toContain("second");
        expect(bubbles[0].textContent).not.toContain("first");
    });

    it("removeNotification drops the matching bubble and returns true", () => {
        const { root, panel } = makePanel();
        panel.addNotification("Build finished", "osNotifications", "os:1");
        expect(panel.removeNotification("os:1")).toBe(true);
        expect(agentBubbles(root).length).toBe(0);
    });

    it("removeNotification is a no-op for unknown ids", () => {
        const { panel } = makePanel();
        expect(panel.removeNotification("os:unknown")).toBe(false);
    });

    it("distinct ids produce distinct bubbles removable independently", () => {
        const { root, panel } = makePanel();
        panel.addNotification("one", "osNotifications", "os:1");
        panel.addNotification("two", "osNotifications", "os:2");
        expect(agentBubbles(root).length).toBe(2);
        panel.removeNotification("os:1");
        const remaining = agentBubbles(root);
        expect(remaining.length).toBe(1);
        expect(remaining[0].textContent).toContain("two");
    });
});
