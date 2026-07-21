// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { FeedbackWidget } from "../src/feedbackWidget.js";
import type { FeedbackController } from "../src/feedbackWidget.js";

// FeedbackWidget renders the per-message action row (copy / expand / rate).
// These tests run under jsdom (see jest.config.cjs).

function makeWidget(messageHtml = "<p>hello</p>") {
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
        },
        controller,
        "footer-always",
    );
    return { container, messageDiv, widget };
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("FeedbackWidget expand", () => {
    it("places the expand button after copy and before thumbs-up", () => {
        const { container } = makeWidget();
        const actions = Array.from(
            container.querySelectorAll<HTMLElement>(".chat-action-button"),
        ).map((b) => b.dataset.action);
        expect(actions).toEqual([
            "copy",
            "expand",
            "thumbs-up",
            "thumbs-down",
            "more",
        ]);
    });

    it("moves the message content into the overlay and back when closed", () => {
        const { container, messageDiv } = makeWidget("<p>expanded content</p>");
        container
            .querySelector<HTMLButtonElement>('[data-action="expand"]')!
            .click();

        const overlay = document.querySelector(".chat-expand-overlay");
        expect(overlay?.textContent).toContain("expanded content");
        // Content is moved out of the bubble while expanded...
        expect(messageDiv.textContent).toBe("");

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(document.querySelector(".chat-expand-overlay")).toBeNull();
        // ...and returned to it on close.
        expect(messageDiv.textContent).toContain("expanded content");
    });

    it("closes on a backdrop click but stays open on a panel click", () => {
        const { container } = makeWidget();
        container
            .querySelector<HTMLButtonElement>('[data-action="expand"]')!
            .click();
        const overlay = document.querySelector<HTMLElement>(
            ".chat-expand-overlay",
        )!;
        // Click inside the panel: stays open.
        overlay
            .querySelector(".chat-expand-panel")!
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(document.querySelector(".chat-expand-overlay")).not.toBeNull();
        // Click the backdrop (the overlay itself): closes.
        overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(document.querySelector(".chat-expand-overlay")).toBeNull();
    });

    it("closes on the close button", () => {
        const { container } = makeWidget();
        container
            .querySelector<HTMLButtonElement>('[data-action="expand"]')!
            .click();
        document
            .querySelector<HTMLButtonElement>(
                '.chat-expand-overlay [data-action="close"]',
            )!
            .click();
        expect(document.querySelector(".chat-expand-overlay")).toBeNull();
    });

    it("replaces rather than stacks a second overlay", () => {
        const { container } = makeWidget();
        const btn = container.querySelector<HTMLButtonElement>(
            '[data-action="expand"]',
        )!;
        btn.click();
        btn.click();
        expect(document.querySelectorAll(".chat-expand-overlay").length).toBe(
            1,
        );
    });

    it("preserves interactivity by moving (not cloning) the content", () => {
        const clicked = jest.fn();
        const { container, messageDiv } = makeWidget("");
        const action = document.createElement("button");
        action.textContent = "action";
        action.addEventListener("click", () => clicked());
        messageDiv.appendChild(action);

        container
            .querySelector<HTMLButtonElement>('[data-action="expand"]')!
            .click();
        const overlay = document.querySelector<HTMLElement>(
            ".chat-expand-overlay",
        )!;
        const moved = Array.from(overlay.querySelectorAll("button")).find(
            (b) => b.textContent === "action",
        )!;
        // Same node moved in (not a clone), so its listener still fires.
        expect(moved).toBe(action);
        moved.click();
        expect(clicked).toHaveBeenCalledTimes(1);

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
});
