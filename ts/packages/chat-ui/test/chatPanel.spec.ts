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
import { iconStop, iconJumpQueue, iconX } from "../src/icons.js";
import type { QuestionForm } from "@typeagent/agent-sdk";

// chat-ui is DOM-rendering; these tests run under jsdom (see jest.config.cjs)
// and assert the DOM produced by the status-rail / roadrunner affordances.

function makePanel(opts?: { onCancel?: (requestId: string) => void }) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const panel = new ChatPanel(root, {
        platformAdapter: { handleLinkClick() {} },
        onCancel: opts?.onCancel,
    });
    return { root, panel };
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

describe("icons", () => {
    it("each affordance icon renders an <svg> inside an <i> wrapper", () => {
        for (const make of [iconStop, iconJumpQueue, iconX]) {
            const el = make();
            expect(el.tagName).toBe("I");
            expect(el.querySelector("svg")).not.toBeNull();
        }
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
