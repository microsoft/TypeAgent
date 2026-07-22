// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { FeedbackWidget } from "../src/feedbackWidget.js";
import type { FeedbackController } from "../src/feedbackWidget.js";

// FeedbackWidget renders the per-message action row (copy / open-in-window /
// rate). These tests run under jsdom (see jest.config.cjs).

function makeWidget(
    messageHtml = "<p>hello</p>",
    openInWindow?: () => boolean,
) {
    const container = document.createElement("div");
    const messageDiv = document.createElement("div");
    messageDiv.innerHTML = messageHtml;
    document.body.appendChild(container);
    const controller: FeedbackController = {
        getCurrentFeedback: jest.fn(() => null),
        submit: jest.fn(async () => undefined),
    };
    const widget = new FeedbackWidget(
        {
            container,
            bodyDiv: document.createElement("div"),
            headerDiv: document.createElement("div"),
            messageDiv,
            openInWindow,
        },
        controller,
        "footer-always",
    );
    return { container, messageDiv, widget };
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("FeedbackWidget open-in-window", () => {
    it("omits the open-in-window button when the host has no native window", () => {
        const { container } = makeWidget();
        const actions = Array.from(
            container.querySelectorAll<HTMLElement>(".chat-action-button"),
        ).map((b) => b.dataset.action);
        expect(actions).toEqual(["copy", "thumbs-up", "thumbs-down", "more"]);
    });

    it("places the open-in-window button after copy when the host supports it", () => {
        const { container } = makeWidget("<p>x</p>", () => true);
        const actions = Array.from(
            container.querySelectorAll<HTMLElement>(".chat-action-button"),
        ).map((b) => b.dataset.action);
        expect(actions).toEqual([
            "copy",
            "open-window",
            "thumbs-up",
            "thumbs-down",
            "more",
        ]);
    });

    it("invokes the host callback when the button is clicked", () => {
        const openInWindow = jest.fn(() => true);
        const { container } = makeWidget("<p>x</p>", openInWindow);
        container
            .querySelector<HTMLButtonElement>('[data-action="open-window"]')!
            .click();
        expect(openInWindow).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the host declines the message (no fallback)", () => {
        const openInWindow = jest.fn(() => false);
        const { container } = makeWidget("<p>x</p>", openInWindow);
        container
            .querySelector<HTMLButtonElement>('[data-action="open-window"]')!
            .click();
        expect(openInWindow).toHaveBeenCalledTimes(1);
        // The click is a no-op: no modal/dialog fallback surface appears.
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
