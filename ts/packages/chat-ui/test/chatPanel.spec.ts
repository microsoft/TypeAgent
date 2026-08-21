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
import type { QuestionForm } from "@typeagent/agent-sdk";

// chat-ui is DOM-rendering; these tests run under jsdom (see jest.config.cjs)
// and assert the DOM produced by the status-rail / roadrunner affordances.

function makePanel(opts?: {
    onCancel?: (requestId: string) => void;
    onSend?: (
        text: string,
        attachments: string[] | undefined,
        requestId: string,
    ) => void;
    openMessageInWindow?: (html: string, title?: string) => boolean;
}) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const panel = new ChatPanel(root, {
        platformAdapter: {
            handleLinkClick() {},
            ...(opts?.openMessageInWindow
                ? { openMessageInWindow: opts.openMessageInWindow }
                : {}),
        },
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

    it("renders per-block thinking tokens as a Thinking Tokens line", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            "reasoning",
            "dispatcher",
            undefined,
            "step",
            "req-1",
        );

        panel.completeRequest("req-1", {
            totalDuration: 1500,
            actionTokenUsage: {
                prompt_tokens: 1000,
                completion_tokens: 200,
                total_tokens: 1200,
                thinking_tokens: [50, 30, 25],
            },
        });

        // Distinct "Thinking Tokens" line: the per-block total (105) with a
        // per-block breakdown, alongside the aggregate Action Tokens line.
        expect(root.textContent).toContain("Action Tokens:");
        expect(root.textContent).toContain("Thinking Tokens:");
        expect(root.textContent).toContain("105");
        expect(root.textContent).toContain("(50+30+25)");
    });

    it("omits the per-block breakdown for a single thinking block", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            "reasoning",
            "dispatcher",
            undefined,
            "step",
            "req-1",
        );

        panel.completeRequest("req-1", {
            totalDuration: 1500,
            actionTokenUsage: {
                prompt_tokens: 1000,
                completion_tokens: 200,
                total_tokens: 1200,
                thinking_tokens: [42],
            },
        });

        expect(root.textContent).toContain("Thinking Tokens:");
        expect(root.textContent).toContain("42");
        // A single block has nothing to break down.
        expect(root.textContent).not.toContain("(42)");
    });

    it("marks estimated thinking tokens with a ~ prefix", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            "reasoning",
            "dispatcher",
            undefined,
            "step",
            "req-1",
        );

        panel.completeRequest("req-1", {
            totalDuration: 1500,
            actionTokenUsage: {
                prompt_tokens: 1000,
                completion_tokens: 200,
                total_tokens: 1200,
                thinking_tokens: [60, 40],
                thinking_tokens_estimated: true,
            },
        });

        // Approximate figure (e.g. Claude's streamed estimate) gets a ~ marker.
        expect(root.textContent).toContain("Thinking Tokens:");
        expect(root.textContent).toContain("~100");
        expect(root.textContent).toContain("(60+40)");
    });

    it("renders the Trace ID line immediately below Action Tokens when provided", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            "response",
            "dispatcher",
            undefined,
            "step",
            "req-1",
        );

        panel.completeRequest("req-1", {
            totalDuration: 1500,
            actionTokenUsage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
            },
            traceId: "abcd1234abcd1234abcd1234abcd1234",
        });

        // The canonical OTel trace id lives in the agent-bubble metrics hover,
        // rendered right after Action Tokens so users can copy it out.
        expect(root.textContent).toContain("Trace ID:");
        expect(root.textContent).toContain("abcd1234abcd1234abcd1234abcd1234");

        // Assert ordering: Trace ID appears after Action Tokens and before
        // Thinking Tokens / phase marks would (if any).
        const agentMetrics = root.querySelector(
            ".chat-message-agent .metrics-details",
        );
        expect(agentMetrics).not.toBeNull();
        const html = (agentMetrics as HTMLElement).innerHTML;
        const actionIdx = html.indexOf("Action Tokens:");
        const traceIdx = html.indexOf("Trace ID:");
        expect(actionIdx).toBeGreaterThanOrEqual(0);
        expect(traceIdx).toBeGreaterThan(actionIdx);
    });

    it("omits the Trace ID line when no traceId is provided", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            "response",
            "dispatcher",
            undefined,
            "step",
            "req-1",
        );

        panel.completeRequest("req-1", {
            totalDuration: 1500,
            actionTokenUsage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
            },
        });

        expect(root.textContent).toContain("Action Tokens:");
        expect(root.textContent).not.toContain("Trace ID:");
    });
});

describe("reasoning UI", () => {
    const REASONING = "dispatcher.reasoningAction.copilot";
    const thinking = (text = "reasoning") => ({
        type: "html" as const,
        content:
            `<details class="reasoning-thinking" open><summary>Thinking</summary>` +
            `<pre>${text}</pre></details>`,
    });

    function reasoningBubbles(root: HTMLElement): HTMLElement[] {
        return Array.from(
            root.querySelectorAll<HTMLElement>(
                '.chat-message-container-agent[data-request-id="req-1"]',
            ),
        );
    }

    function thinkingByText(
        root: HTMLElement,
    ): Map<string, HTMLDetailsElement> {
        const map = new Map<string, HTMLDetailsElement>();
        root.querySelectorAll<HTMLDetailsElement>(
            "details.reasoning-thinking",
        ).forEach((d) => map.set(d.querySelector("pre")?.textContent ?? "", d));
        return map;
    }

    it("marks the reasoning working rail as reasoning (purple), not a plain one", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            thinking(),
            REASONING,
            undefined,
            "step",
            "req-1",
        );
        expect(
            root.querySelector(
                '.chat-message-status-rail[data-status="running"][data-variant="reasoning"]',
            ),
        ).not.toBeNull();

        const plain = makePanel({ onCancel: jest.fn() });
        plain.panel.addUserMessage("hi", "req-1");
        plain.panel.setProcessing("req-1");
        plain.panel.addAgentMessage("hi", "agent", undefined, "step", "req-1");
        expect(
            plain.root.querySelector(".chat-message-status-rail[data-variant]"),
        ).toBeNull();
    });

    it("collapses a superseded Thinking block but keeps the active one open", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            thinking("first"),
            REASONING,
            undefined,
            "step",
            "req-1",
        );
        panel.addAgentMessage(
            thinking("second"),
            REASONING,
            undefined,
            "step",
            "req-1",
        );

        const details = thinkingByText(root);
        expect(details.get("first")?.hasAttribute("open")).toBe(false);
        expect(details.get("second")?.hasAttribute("open")).toBe(true);
    });

    it("collapses all Thinking blocks and gaps the answer on completion", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            thinking(),
            REASONING,
            undefined,
            "step",
            "req-1",
        );
        panel.addAgentMessage(
            "the answer",
            REASONING,
            undefined,
            "step",
            "req-1",
        );
        panel.completeRequest("req-1");

        for (const d of root.querySelectorAll<HTMLDetailsElement>(
            "details.reasoning-thinking",
        )) {
            expect(d.hasAttribute("open")).toBe(false);
        }
        // The answer bubble (prose) gets the separating gap; the "Thinking"
        // trail bubble does not.
        const bubbles = reasoningBubbles(root);
        const answer = bubbles.find((b) =>
            b.textContent?.includes("the answer"),
        );
        const trail = bubbles.find((b) =>
            b.querySelector("details.reasoning-thinking"),
        );
        expect(answer?.classList.contains("chat-reasoning-answer")).toBe(true);
        expect(trail?.classList.contains("chat-reasoning-answer")).toBe(false);
    });

    it("collapses a still-active Thinking block on completion", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        // A single step is never superseded, so completion is the only thing
        // that can collapse it.
        panel.addAgentMessage(
            thinking(),
            REASONING,
            undefined,
            "step",
            "req-1",
        );
        const details = root.querySelector<HTMLDetailsElement>(
            "details.reasoning-thinking",
        );
        expect(details?.hasAttribute("open")).toBe(true);

        panel.completeRequest("req-1");
        expect(details?.hasAttribute("open")).toBe(false);
    });

    it("keeps Thinking expanded when a request is marked/cleared unknown", () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            thinking(),
            REASONING,
            undefined,
            "step",
            "req-1",
        );
        expect(
            root
                .querySelector<HTMLDetailsElement>("details.reasoning-thinking")
                ?.hasAttribute("open"),
        ).toBe(true);
        panel.setRequestUnknown("req-1");
        panel.clearRequestUnknown("req-1");
        expect(
            root
                .querySelector<HTMLDetailsElement>("details.reasoning-thinking")
                ?.hasAttribute("open"),
        ).toBe(true);
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

describe("roadrunner (explained) popover", () => {
    it("opens a popover with the rule and mapping on click, toggles closed", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("play something by adele", "req-1");

        panel.notifyExplained("req-1", {
            fromCache: "construction",
            fromUser: false,
            time: "12:00:00 PM",
            detail: {
                source: "construction",
                phrase: "play something by adele",
                action: "player.playArtist",
                rule: "play something by <artist>",
                mapping: [{ name: "artist", value: "adele" }],
            },
        });

        const bubble = userBubble(root, "req-1");
        const icon = bubble.querySelector<HTMLElement>(
            ".chat-message-explained-icon",
        )!;
        expect(icon.getAttribute("role")).toBe("button");

        // No popover until clicked.
        expect(bubble.querySelector(".chat-explained-popover")).toBeNull();

        icon.click();
        const popover = bubble.querySelector<HTMLElement>(
            ".chat-explained-popover",
        );
        expect(popover).not.toBeNull();
        expect(popover!.textContent).toContain("play something by <artist>");
        expect(popover!.textContent).toContain("player.playArtist");
        expect(popover!.textContent).toContain("artist");
        expect(popover!.textContent).toContain("adele");
        // The container is lifted above sibling bubbles while open so the
        // popover isn't painted under a neighbor.
        expect(bubble.classList.contains("chat-explained-elevated")).toBe(true);

        // Clicking the icon again closes it.
        icon.click();
        expect(bubble.querySelector(".chat-explained-popover")).toBeNull();
        expect(bubble.classList.contains("chat-explained-elevated")).toBe(
            false,
        );
    });

    it("shows the generalized form for a model translation", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("set a 5 minute timer", "req-2");

        panel.notifyExplained("req-2", {
            fromCache: false,
            fromUser: false,
            time: "12:01:00 PM",
            detail: {
                source: "model",
                phrase: "set a 5 minute timer",
                action: "timer.createTimer",
                rule: "set a <duration> timer",
                mapping: [{ name: "duration", value: "5 minutes" }],
            },
        });

        const icon = userBubble(root, "req-2").querySelector<HTMLElement>(
            ".chat-message-explained-icon",
        )!;
        icon.click();
        const popover = userBubble(root, "req-2").querySelector<HTMLElement>(
            ".chat-explained-popover",
        )!;
        expect(popover.textContent).toContain("Generalized by the model");
        expect(popover.textContent).toContain("set a <duration> timer");

        // The <duration> marker is colored distinctly from the literal words.
        const markers = popover.querySelectorAll(".chat-explained-marker");
        expect(markers.length).toBe(1);
        expect(markers[0].textContent).toBe("<duration>");
        expect(
            popover.querySelectorAll(".chat-explained-literal").length,
        ).toBeGreaterThan(0);
    });

    it("colors phrase words to match their generalized-form markers", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("please list all of the conversations", "req-c");

        panel.notifyExplained("req-c", {
            fromCache: false,
            fromUser: false,
            time: "12:04:00 PM",
            detail: {
                source: "model",
                phrase: "please list all of the conversations",
                action: "system.conversation.listConversation",
                rule: "<politeness>?<M:action><politeness>?",
                segments: [
                    { text: "please", category: "politeness" },
                    {
                        text: "list all of the conversations",
                        category: "action",
                    },
                ],
            },
        });

        const bubble = userBubble(root, "req-c");
        bubble
            .querySelector<HTMLElement>(".chat-message-explained-icon")!
            .click();
        const popover = bubble.querySelector<HTMLElement>(
            ".chat-explained-popover",
        )!;

        // Phrase words are split into per-category colored spans.
        const phraseSpans = popover
            .querySelector<HTMLElement>(".chat-explained-phrase")!
            .querySelectorAll<HTMLElement>("span");
        expect(phraseSpans.length).toBe(2);
        const politenessColor = phraseSpans[0].style.color;
        const actionColor = phraseSpans[1].style.color;
        expect(politenessColor).toBeTruthy();
        expect(actionColor).toBeTruthy();
        expect(politenessColor).not.toBe(actionColor);

        // Each marker matches the color of the phrase words it generalizes.
        const markers = popover.querySelectorAll<HTMLElement>(
            ".chat-explained-marker",
        );
        expect(markers.length).toBe(3);
        expect(markers[0].style.color).toBe(politenessColor); // <politeness>?
        expect(markers[1].style.color).toBe(actionColor); // <M:action>
        expect(markers[2].style.color).toBe(politenessColor); // <politeness>?
    });

    it("picks a lighter category palette on a dark surface", () => {
        const markerColorForSurface = (surfaceTextColor: string) => {
            const { root, panel } = makePanel();
            panel.addUserMessage("list all", "r");
            // The popover picks its palette from the bubble's resolved text
            // color (light text => dark theme).
            userBubble(root, "r").querySelector<HTMLElement>(
                ".chat-message-user",
            )!.style.color = surfaceTextColor;
            panel.notifyExplained("r", {
                fromCache: false,
                fromUser: false,
                time: "t",
                detail: {
                    source: "model",
                    phrase: "list all",
                    action: "a.b",
                    rule: "<M:action>",
                    segments: [{ text: "list all", category: "action" }],
                },
            });
            userBubble(root, "r")
                .querySelector<HTMLElement>(".chat-message-explained-icon")!
                .click();
            return userBubble(root, "r").querySelector<HTMLElement>(
                ".chat-explained-marker",
            )!.style.color;
        };

        const onLight = markerColorForSurface("rgb(32, 32, 32)");
        const onDark = markerColorForSurface("rgb(240, 240, 240)");
        expect(onLight).toBeTruthy();
        expect(onDark).toBeTruthy();
        expect(onLight).not.toBe(onDark);
    });

    it("shows 3 generalizations then reveals the rest via load more", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("list all of the conversations", "req-g");

        const action = {
            text: "list all of the conversations",
            category: "action",
        };
        panel.notifyExplained("req-g", {
            fromCache: false,
            fromUser: false,
            time: "12:03:00 PM",
            detail: {
                source: "model",
                phrase: "list all of the conversations",
                action: "system.conversation.listConversation",
                rule: "<politeness>?<M:action><politeness>?",
                segments: [action],
                generalizations: [
                    [
                        {
                            text: "show all of the conversations",
                            category: "action",
                        },
                    ],
                    [
                        {
                            text: "display all of the conversations",
                            category: "action",
                        },
                    ],
                    [
                        {
                            text: "get all of the conversations",
                            category: "action",
                        },
                    ],
                    [{ text: "please", category: "politeness" }, action],
                    [action, { text: "please", category: "politeness" }],
                ],
            },
        });

        const bubble = userBubble(root, "req-g");
        bubble
            .querySelector<HTMLElement>(".chat-message-explained-icon")!
            .click();
        const popover = bubble.querySelector<HTMLElement>(
            ".chat-explained-popover",
        )!;

        // Only the first 3 are shown; the link offers the remaining 2.
        const gens = () =>
            popover.querySelectorAll<HTMLElement>(".chat-explained-gen");
        expect(gens().length).toBe(3);
        const more = popover.querySelector<HTMLElement>(
            ".chat-explained-more",
        )!;
        expect(more.textContent).toBe("load 2 more");

        more.click();
        expect(gens().length).toBe(5);
        expect(popover.querySelector(".chat-explained-more")).toBeNull();

        // Samples are colored: the "please" politeness word and the action
        // words carry distinct colors, matching the phrase legend.
        const politenessSample = gens()[3];
        const spans = politenessSample.querySelectorAll<HTMLElement>("span");
        expect(spans.length).toBe(2);
        expect(spans[0].style.color).toBeTruthy();
        expect(spans[1].style.color).toBeTruthy();
        expect(spans[0].style.color).not.toBe(spans[1].style.color);
    });

    it("still opens a popover with the provenance line when no detail is sent", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("what's on my calendar?", "req-3");

        panel.notifyExplained("req-3", {
            fromCache: "grammar",
            fromUser: false,
            time: "12:02:00 PM",
        });

        const icon = userBubble(root, "req-3").querySelector<HTMLElement>(
            ".chat-message-explained-icon",
        )!;
        icon.click();
        const popover = userBubble(root, "req-3").querySelector<HTMLElement>(
            ".chat-explained-popover",
        )!;
        expect(popover).not.toBeNull();
        expect(popover.textContent).toContain("Translated by grammar");
    });

    it("re-attaches the roadrunner on history replay", () => {
        const { root, panel } = makePanel();
        panel.replayHistory([
            { kind: "user", text: "play adele", requestId: "req-h" },
            {
                kind: "explained",
                requestId: "req-h",
                data: {
                    fromCache: "construction",
                    fromUser: false,
                    time: "12:00:00 PM",
                    detail: {
                        source: "construction",
                        phrase: "play adele",
                        action: "player.playArtist",
                        rule: "play <artist>",
                        mapping: [{ name: "artist", value: "adele" }],
                    },
                },
            },
        ]);

        const bubble = userBubble(root, "req-h");
        const icon = bubble.querySelector<HTMLElement>(
            ".chat-message-explained-icon",
        );
        expect(icon).not.toBeNull();

        // The click-to-open popover still works after replay clears the
        // userMessageById map.
        icon!.click();
        const popover = bubble.querySelector<HTMLElement>(
            ".chat-explained-popover",
        );
        expect(popover).not.toBeNull();
        expect(popover!.textContent).toContain("play <artist>");
        expect(bubble.classList.contains("chat-explained-elevated")).toBe(true);
    });
});

describe("attachment send state", () => {
    it("keeps an image-only message sendable after leaving command history", async () => {
        const root = document.createElement("div");
        document.body.appendChild(root);
        const panel = new ChatPanel(root, {
            platformAdapter: { handleLinkClick() {} },
            imageCaptureProvider: {
                pickFile: async () => ["data:image/png;base64,AA=="],
            },
            onSend() {},
        });
        const input = root.querySelector<HTMLElement>("#phraseDiv")!;
        const sendButton =
            root.querySelector<HTMLButtonElement>("#sendbutton")!;
        const pressHistoryKey = (key: "ArrowUp" | "ArrowDown") => {
            input.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key,
                    bubbles: true,
                    cancelable: true,
                }),
            );
        };

        panel.injectCommand("@help");
        pressHistoryKey("ArrowUp");
        pressHistoryKey("ArrowDown");
        expect(input.textContent).toBe("");
        expect(sendButton.disabled).toBe(true);

        root.querySelector<HTMLButtonElement>(".chat-attach-button")!.click();
        await Promise.resolve();
        expect(root.querySelector(".chat-attachment-thumb")).not.toBeNull();
        expect(sendButton.disabled).toBe(false);

        pressHistoryKey("ArrowUp");
        pressHistoryKey("ArrowDown");

        expect(input.textContent).toBe("");
        expect(root.querySelector(".chat-attachment-thumb")).not.toBeNull();
        expect(sendButton.disabled).toBe(false);
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

describe("reasoning tool calls (single + folded)", () => {
    // Mirrors what the reasoning engine emits for a logged tool call: a native
    // <details class="reasoning-tool-call"> with a <summary> (tool name as inline
    // code) and a <pre> holding only that call's own JSON, collapsed until opened.
    // Sent as a markdown display message (MarkdownIt passes the block-level HTML
    // through verbatim). Folded runs carry a JSON array; single calls a lone object.
    const foldedHtml =
        '<details class="reasoning-tool-call">' +
        '<summary class="reasoning-tool-call-summary"><strong>Tool:</strong> ' +
        "<code>read_conversation</code> x2</summary>" +
        '<pre class="chat-json reasoning-tool-call-json">[\n' +
        '  {\n    "tool": "read_conversation",\n    "arguments": {\n      "offset": 0\n    }\n  },\n' +
        '  {\n    "tool": "read_conversation",\n    "arguments": {\n      "offset": 6\n    }\n  }\n' +
        "]</pre></details>";

    const singleHtml =
        '<details class="reasoning-tool-call">' +
        '<summary class="reasoning-tool-call-summary"><strong>Tool:</strong> ' +
        "<code>get_conversation_info</code></summary>" +
        '<pre class="chat-json reasoning-tool-call-json">{\n' +
        '  "tool": "get_conversation_info",\n  "arguments": {\n    "limit": 1\n  }\n' +
        "}</pre></details>";

    function addRun(panel: ChatPanel, html: string) {
        panel.addUserMessage("run a tool", "req-1");
        panel.addAgentMessage(
            { type: "markdown", content: html, kind: "info" },
            "dispatcher.reasoningAction.copilot",
            undefined,
            "step",
            "req-1",
        );
    }

    it("renders a folded run's summary and collapsed JSON array", () => {
        const { root, panel } = makePanel();
        addRun(panel, foldedHtml);

        const details = root.querySelector<HTMLDetailsElement>(
            "details.reasoning-tool-call",
        );
        expect(details).not.toBeNull();
        // Native <details> is collapsed until the user opens it.
        expect(details!.open).toBe(false);
        const summary = root.querySelector<HTMLElement>(
            ".reasoning-tool-call-summary",
        );
        expect(summary).not.toBeNull();
        // Tool name is inline code, not split apart by the action-JSON splitter.
        expect(summary!.querySelector("code")!.textContent).toBe(
            "read_conversation",
        );
        expect(summary!.textContent).toContain("x2");
        const pre = root.querySelector<HTMLElement>(
            "pre.reasoning-tool-call-json",
        );
        expect(pre).not.toBeNull();
        const parsed = JSON.parse(pre!.textContent ?? "");
        expect(parsed).toHaveLength(2);
        expect(parsed[1].arguments.offset).toBe(6);
    });

    it("renders a single tool call as its own collapsed block with object JSON", () => {
        const { root, panel } = makePanel();
        addRun(panel, singleHtml);

        const details = root.querySelector<HTMLDetailsElement>(
            "details.reasoning-tool-call",
        )!;
        expect(details.open).toBe(false);
        const summary = root.querySelector<HTMLElement>(
            ".reasoning-tool-call-summary",
        )!;
        expect(summary.querySelector("code")!.textContent).toBe(
            "get_conversation_info",
        );
        expect(summary.textContent).not.toContain("x");
        const pre = root.querySelector<HTMLElement>(
            "pre.reasoning-tool-call-json",
        )!;
        // Only the relevant JSON for this one call — a lone object.
        expect(JSON.parse(pre.textContent ?? "")).toEqual({
            tool: "get_conversation_info",
            arguments: { limit: 1 },
        });
    });

    it("keeps each call's JSON inline, not in the action-data details panel", () => {
        const { root, panel } = makePanel();
        addRun(panel, singleHtml);

        const pre = root.querySelector<HTMLElement>(
            "pre.reasoning-tool-call-json",
        )!;
        // The JSON lives in the message content, decoupled from the clickable
        // action JSON view (.chat-message-details) of the reasoningAction bubble.
        expect(pre.closest(".chat-message-content")).not.toBeNull();
        expect(pre.closest(".chat-message-details")).toBeNull();
    });

    it("syntax-highlights the JSON once, the first time the block opens", () => {
        const { root, panel } = makePanel();
        addRun(panel, foldedHtml);

        const details = root.querySelector<HTMLDetailsElement>(
            "details.reasoning-tool-call",
        )!;
        const pre = root.querySelector<HTMLElement>(
            "pre.reasoning-tool-call-json",
        )!;
        expect(pre.querySelector(".json-key")).toBeNull();

        // Native <details> handles show/hide + keyboard on its own; our capture-
        // phase `toggle` listener highlights the JSON once when the block first
        // opens. Drive the toggle event directly since jsdom doesn't run the
        // native summary-click -> open behavior.
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
        expect(pre.dataset.highlighted).toBe("true");
        expect(pre.querySelector(".json-key")).not.toBeNull();
        expect(pre.querySelector(".json-string")).not.toBeNull();

        // Closing and re-opening does not re-highlight or duplicate the body.
        const highlightedHtml = pre.innerHTML;
        details.open = false;
        details.dispatchEvent(new Event("toggle"));
        expect(pre.innerHTML).toBe(highlightedHtml);
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
        expect(pre.innerHTML).toBe(highlightedHtml);
    });
});

describe("reasoning tool results", () => {
    // Mirrors what the reasoning engine emits for a tool result: a native
    // <details class="reasoning-tool-result"> with a one-line preview summary
    // and a <pre> holding the full result text, collapsed until opened.
    const resultHtml =
        '<details class="reasoning-tool-result">' +
        '<summary class="reasoning-tool-result-summary"><strong>\u21B3</strong> ' +
        "<code>Found 3 matches: alpha beta</code></summary>" +
        '<pre class="reasoning-tool-result-body">Found 3 matches:\nalpha\nbeta</pre>' +
        "</details>";

    const fullText = "Found 3 matches:\nalpha\nbeta";

    function addResult(panel: ChatPanel, html: string = resultHtml) {
        panel.addUserMessage("run a tool", "req-1");
        panel.addAgentMessage(
            { type: "markdown", content: html, kind: "info" },
            "dispatcher.reasoningAction.copilot",
            undefined,
            "step",
            "req-1",
        );
    }

    function openResult(root: HTMLElement): HTMLDetailsElement {
        const details = root.querySelector<HTMLDetailsElement>(
            "details.reasoning-tool-result",
        )!;
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
        return details;
    }

    it("renders the result collapsed with a preview and the full body inline", () => {
        const { root, panel } = makePanel();
        addResult(panel);
        const details = root.querySelector<HTMLDetailsElement>(
            "details.reasoning-tool-result",
        );
        expect(details).not.toBeNull();
        expect(details!.open).toBe(false);
        expect(
            root.querySelector(".reasoning-tool-result-summary code")!
                .textContent,
        ).toBe("Found 3 matches: alpha beta");
        const pre = root.querySelector<HTMLElement>(
            "pre.reasoning-tool-result-body",
        )!;
        expect(pre.textContent).toBe(fullText);
    });

    it("adds an 'open in viewer' button the first time the result opens (only once)", () => {
        const { root, panel } = makePanel();
        addResult(panel);
        expect(root.querySelector(".reasoning-tool-result-open")).toBeNull();
        openResult(root);
        expect(
            root.querySelectorAll(".reasoning-tool-result-open"),
        ).toHaveLength(1);
        // Closing and re-opening does not add a second button.
        const details = root.querySelector<HTMLDetailsElement>(
            "details.reasoning-tool-result",
        )!;
        details.open = false;
        details.dispatchEvent(new Event("toggle"));
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
        expect(
            root.querySelectorAll(".reasoning-tool-result-open"),
        ).toHaveLength(1);
    });

    it("opens the in-page text viewer with the full result when no host window is available", () => {
        const { root, panel } = makePanel();
        addResult(panel);
        openResult(root);
        root.querySelector<HTMLButtonElement>(
            ".reasoning-tool-result-open",
        )!.click();
        const overlay = root.querySelector<HTMLElement>(
            ".chat-text-viewer-overlay",
        );
        expect(overlay).not.toBeNull();
        expect(
            overlay!.querySelector<HTMLElement>(".chat-text-viewer-body")!
                .textContent,
        ).toBe(fullText);
        // Esc dismisses the overlay.
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(root.querySelector(".chat-text-viewer-overlay")).toBeNull();
    });

    it("hands the full result to the host window when openMessageInWindow is provided", () => {
        const openMessageInWindow = jest.fn(
            (_html: string, _title?: string) => true,
        );
        const { root, panel } = makePanel({ openMessageInWindow });
        addResult(panel);
        openResult(root);
        root.querySelector<HTMLButtonElement>(
            ".reasoning-tool-result-open",
        )!.click();
        expect(openMessageInWindow).toHaveBeenCalledTimes(1);
        const [html, title] = openMessageInWindow.mock.calls[0];
        expect(html).toContain("Found 3 matches:");
        expect(title).toBe("Tool result");
        // The host handled it, so no in-page overlay is created.
        expect(root.querySelector(".chat-text-viewer-overlay")).toBeNull();
    });

    it("keeps the viewer-button click from toggling the details", () => {
        const { root, panel } = makePanel();
        addResult(panel);
        const details = openResult(root);
        const button = root.querySelector<HTMLButtonElement>(
            ".reasoning-tool-result-open",
        )!;
        const ev = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
        });
        button.dispatchEvent(ev);
        // A real summary click toggles the <details>; the button suppresses it.
        expect(ev.defaultPrevented).toBe(true);
        expect(details.open).toBe(true);
    });
});

describe("question form wizard (paged)", () => {
    const form: QuestionForm = {
        message: "Q",
        paged: true,
        fields: [
            { id: "a", kind: "pick", prompt: "Pick A", choices: ["X", "Y"] },
            { id: "b", kind: "yesNo", prompt: "OK?" },
        ],
    };

    function panelEl(root: HTMLElement): HTMLElement {
        const el = root.querySelector<HTMLElement>(".question-form-panel");
        if (!el) throw new Error("no question-form-panel");
        return el;
    }
    function progress(root: HTMLElement): string {
        return (
            panelEl(root).querySelector<HTMLElement>(".question-form-progress")
                ?.textContent ?? ""
        );
    }
    function navButtons(root: HTMLElement): HTMLButtonElement[] {
        return Array.from(
            panelEl(root).querySelectorAll<HTMLButtonElement>(
                ".question-form-nav-buttons .choice-button",
            ),
        );
    }
    function radios(root: HTMLElement): HTMLInputElement[] {
        return Array.from(
            panelEl(root).querySelectorAll<HTMLInputElement>(
                'input[type="radio"]',
            ),
        );
    }

    it("shows one question at a time; Back disabled on the first step", () => {
        const { root, panel } = makePanel();
        void panel.addQuestionForm(form, { showMessage: false });
        expect(progress(root)).toBe("Question 1 of 2");
        expect(panelEl(root).textContent).toContain("Pick A");
        expect(panelEl(root).textContent).not.toContain("OK?");
        const [back, next] = navButtons(root);
        expect(back.disabled).toBe(true);
        expect(next.textContent).toBe("Next");
    });

    it("navigates Next/Back, restores answers, and resolves on Finish", async () => {
        const { root, panel } = makePanel();
        const done = panel.addQuestionForm(form, { showMessage: false });

        // Step 1: choose "Y" (index 1), then Next.
        radios(root)[1].click();
        navButtons(root)[1].click();

        // Step 2: yes/no. Back enabled, Next relabelled "Finish".
        expect(progress(root)).toBe("Question 2 of 2");
        const [back2, next2] = navButtons(root);
        expect(back2.disabled).toBe(false);
        expect(next2.textContent).toBe("Finish");

        // Back to step 1: the "Y" selection is restored.
        back2.click();
        expect(progress(root)).toBe("Question 1 of 2");
        expect(radios(root)[1].checked).toBe(true);

        // Forward and Finish.
        navButtons(root)[1].click(); // -> step 2
        navButtons(root)[1].click(); // Finish
        const response = await done;
        expect(response.cancelled).toBeFalsy();
        expect(response.answers.a).toEqual({ kind: "pick", selected: 1 });
        expect(response.answers.b.kind).toBe("yesNo");
    });

    it("Cancel resolves with { cancelled: true }", async () => {
        const { root, panel } = makePanel();
        const done = panel.addQuestionForm(form, { showMessage: false });
        navButtons(root)[2].click(); // Cancel
        const response = await done;
        expect(response.cancelled).toBe(true);
    });

    it("removes the whole card (heading included) when aborted externally", async () => {
        const { root, panel } = makePanel();
        const ac = new AbortController();
        const done = panel.addQuestionForm(
            {
                message: "Here's a true/false question:",
                fields: [{ id: "ok", kind: "yesNo", prompt: "OK?" }],
            },
            { signal: ac.signal },
        );
        // The heading rendered as a fresh system card.
        expect(root.textContent).toContain("Here's a true/false question:");

        // The server cancelled / superseded the interaction.
        ac.abort();
        await expect(done).rejects.toBeDefined();

        // The whole card is gone - no stale heading left behind.
        expect(root.textContent).not.toContain("Here's a true/false question:");
    });
});

// Regression: a blocking prompt (ClientIO.question via requestInteraction, e.g.
// reasoning's ask_user) is rendered mid-turn while the agent holds the request.
// It must appear chronologically between the prior reasoning step and the
// follow-up step. Previously the prompt card was created at the default
// insertion anchor and the follow-up "step" bubble chained onto the earlier
// step, so the card sank BELOW its own answer.
describe("blocking prompt ordering (reasoning ask_user)", () => {
    const source = "dispatcher.reasoningAction.copilot";

    function stepOf(root: HTMLElement, text: string): HTMLElement {
        const el = Array.from(
            root.querySelectorAll<HTMLElement>(".chat-message-agent"),
        ).find((e) => e.textContent?.includes(text));
        if (!el) throw new Error(`no step bubble containing "${text}"`);
        return el;
    }

    it("renders the prompt card between the prior step and the follow-up step", async () => {
        const { root, panel } = makePanel({ onCancel: jest.fn() });
        panel.addUserMessage("ask me a yes/no question", "req-1");
        panel.setProcessing("req-1");

        panel.addAgentMessage("Thinking", source, undefined, "step", "req-1");
        panel.addAgentMessage(
            "Tool: ask_user",
            source,
            undefined,
            "step",
            "req-1",
        );

        // Blocking prompt: no requestId, mirroring handleRequestInteraction.
        const answered = panel.addChoicePrompt<number>(
            "Do you enjoy using TypeAgent?",
            [
                { label: "Yes", value: 0 },
                { label: "No", value: 1 },
            ],
        );

        // The follow-up reasoning step arrives only after the user answers.
        panel.addAgentMessage(
            "You answered Yes",
            source,
            undefined,
            "step",
            "req-1",
        );

        const tool = stepOf(root, "Tool: ask_user");
        const answer = stepOf(root, "You answered Yes");
        const card = root
            .querySelector<HTMLElement>(".choice-panel")!
            .closest<HTMLElement>(".chat-message-agent")!;
        expect(card).not.toBeNull();

        // Chat is column-reverse: document order is bottom-to-top, so correct
        // visual order (tool above card above answer) means, in the DOM, the
        // answer precedes the card which precedes the tool.
        expect(
            card.compareDocumentPosition(answer) &
                Node.DOCUMENT_POSITION_PRECEDING,
        ).toBeTruthy();
        expect(
            card.compareDocumentPosition(tool) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        // Resolve the prompt so no timer/promise dangles.
        root.querySelector<HTMLButtonElement>(".choice-button")!.click();
        await expect(answered).resolves.toBe(0);
    });
});

// The reasoning engine renders each "Thinking" block as a <details> that
// carries a per-block token estimate in a `data-thinking-tokens` attribute.
// The panel moves that into the step bubble's metrics row (where the other
// token metrics live), not the block header. Verify the attribute survives the
// markdown -> markdown-it -> DOMPurify pipeline and lands in the metrics row in
// both the streaming ("temporary") and finalized ("step") render modes.
describe("reasoning thinking-block token metric", () => {
    const source = "dispatcher.reasoningAction.copilot";
    const thinkingHtml = (tokens: number) =>
        `<details class="reasoning-thinking" data-thinking-tokens="${tokens}" open>` +
        "<summary>Thinking</summary>" +
        "<pre>I'm going to recreate the table.</pre></details>";

    function metricsText(root: HTMLElement): string {
        return (
            root.querySelector(".chat-message-metrics-agent")?.textContent ?? ""
        );
    }

    it("renders the estimate in a finalized step bubble's metrics row", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            { type: "markdown", content: thinkingHtml(14) },
            source,
            undefined,
            "step",
            "req-1",
        );
        expect(metricsText(root)).toContain("Thinking Tokens:");
        expect(metricsText(root)).toContain("~14");
        // The block header stays a plain "Thinking" - count is NOT inline.
        expect(root.querySelector("summary")?.textContent?.trim()).toBe(
            "Thinking",
        );
    });

    it("renders the estimate in a temporary streaming bubble's metrics row", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            { type: "markdown", content: thinkingHtml(14) },
            source,
            undefined,
            "temporary",
            "req-1",
        );
        expect(metricsText(root)).toContain("Thinking Tokens:");
        expect(metricsText(root)).toContain("~14");
    });

    it("adds no thinking metric when the block has no estimate", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("hi", "req-1");
        panel.setProcessing("req-1");
        panel.addAgentMessage(
            {
                type: "markdown",
                content:
                    '<details class="reasoning-thinking" open>' +
                    "<summary>Thinking</summary><pre>x</pre></details>",
            },
            source,
            undefined,
            "step",
            "req-1",
        );
        expect(metricsText(root)).not.toContain("Thinking Tokens:");
    });
});

describe("ChatPanel action result inspector", () => {
    it("renders the serialized ActionResult in a separate result panel", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("do it", "req-1");
        panel.addAgentMessage("done", "agent", undefined, undefined, "req-1");

        panel.appendDiagnosticData("req-1", {
            type: "actionResult",
            source: "agent",
            actionIndex: 0,
            result: { entities: [{ name: "foo", type: ["bar"] }] },
        });

        const pre = root.querySelector(".chat-message-result pre.chat-json");
        expect(pre).not.toBeNull();
        expect(pre!.textContent).toContain("entities");
        expect(pre!.textContent).toContain("foo");
    });

    it("ignores diagnostic data that isn't an actionResult payload", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("do it", "req-1");
        panel.addAgentMessage("done", "agent", undefined, undefined, "req-1");

        panel.appendDiagnosticData("req-1", { type: "trace", foo: 1 });

        const resultPanel = root.querySelector(".chat-message-result");
        // The panel element exists (created with the bubble) but stays empty
        // for unrecognized diagnostic shapes.
        expect(resultPanel?.innerHTML ?? "").toBe("");
    });

    it("stashes the result when it arrives before the agent bubble exists", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("do it", "req-1");
        // Diagnostic arrives before any agent bubble for the thread.
        panel.appendDiagnosticData("req-1", {
            type: "actionResult",
            result: { historyText: "later" },
        });
        expect(
            root.querySelector(".chat-message-result")?.innerHTML ?? "",
        ).toBe("");

        // Creating the bubble applies the stashed result.
        panel.addAgentMessage("done", "agent", undefined, undefined, "req-1");
        const pre = root.querySelector(".chat-message-result pre.chat-json");
        expect(pre?.textContent).toContain("later");
    });

    it("prepends a display-only success status for a non-error result", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("do it", "req-1");
        panel.addAgentMessage("done", "agent", undefined, undefined, "req-1");

        panel.appendDiagnosticData("req-1", {
            type: "actionResult",
            source: "agent",
            actionIndex: 0,
            result: { entities: [] },
        });

        const pre = root.querySelector(".chat-message-result pre.chat-json");
        expect(pre).not.toBeNull();
        expect(pre!.textContent).toContain("status");
        expect(pre!.textContent).toContain("success");
        expect(pre!.textContent).not.toContain("error");
    });

    it("labels a result carrying an error with status error", () => {
        const { root, panel } = makePanel();
        panel.addUserMessage("do it", "req-1");
        panel.addAgentMessage("done", "agent", undefined, undefined, "req-1");

        panel.appendDiagnosticData("req-1", {
            type: "actionResult",
            source: "agent",
            actionIndex: 0,
            result: { error: "boom" },
        });

        const pre = root.querySelector(".chat-message-result pre.chat-json");
        expect(pre).not.toBeNull();
        expect(pre!.textContent).toContain("status");
        expect(pre!.textContent).toContain("error");
        expect(pre!.textContent).toContain("boom");
    });
});
