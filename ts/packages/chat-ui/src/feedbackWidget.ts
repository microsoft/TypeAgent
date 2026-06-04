// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Feedback widget. Mirrors packages/shell/src/renderer/src/feedbackWidget.ts —
 * keep these in sync when changing trigger DOM, popover layout, or the
 * CSS class names so the styling can stay shared between the Electron
 * shell and the Chrome / vscode webview hosts.
 */

import type {
    UserFeedbackCategory,
    UserFeedbackEntry,
    UserFeedbackRating,
} from "@typeagent/dispatcher-types";
import {
    iconCheck,
    iconCopy,
    iconMore,
    iconThumbsDown,
    iconThumbsUp,
    iconTrash,
} from "./icons.js";

export type FeedbackUIVariant = "footer-always";

export const FEEDBACK_VARIANTS: FeedbackUIVariant[] = ["footer-always"];

export type FeedbackController = {
    getCurrentFeedback(): UserFeedbackEntry | null;
    submit(
        rating: UserFeedbackRating,
        category?: UserFeedbackCategory,
        comment?: string,
        includeContext?: boolean,
    ): Promise<void>;
    setHidden?(hidden: boolean, target?: "user" | "agent"): Promise<void>;
};

type FeedbackHost = {
    container: HTMLElement;
    bodyDiv: HTMLElement;
    headerDiv: HTMLElement;
    messageDiv: HTMLElement;
};

type ActionRow = {
    root: HTMLElement;
    thumbsUp: HTMLButtonElement;
    thumbsDown: HTMLButtonElement;
};

export class FeedbackWidget {
    private variant: FeedbackUIVariant;
    private controller: FeedbackController;
    private host: FeedbackHost;
    private actionRow?: ActionRow;
    private flagMenu?: HTMLElement;
    private popover?: FeedbackPopover;

    constructor(
        host: FeedbackHost,
        controller: FeedbackController,
        variant: FeedbackUIVariant,
    ) {
        this.host = host;
        this.controller = controller;
        this.variant = variant;
        host.container.classList.add(`feedback-variant-${variant}`);
        this.build();
        this.refreshFromEntry(controller.getCurrentFeedback());
    }

    public setVariant(variant: FeedbackUIVariant) {
        if (this.variant === variant) return;
        this.host.container.classList.remove(
            `feedback-variant-${this.variant}`,
        );
        this.host.container.classList.add(`feedback-variant-${variant}`);
        this.variant = variant;
        this.teardown();
        this.build();
        this.refreshFromEntry(this.controller.getCurrentFeedback());
    }

    public setFeedbackState(entry: UserFeedbackEntry | null) {
        this.refreshFromEntry(entry);
    }

    private teardown() {
        this.actionRow?.root.remove();
        this.actionRow = undefined;
        this.flagMenu?.remove();
        this.flagMenu = undefined;
        this.popover?.dispose();
        this.popover = undefined;
    }

    private build() {
        this.actionRow = this.buildActionRow(true);
        this.host.container.appendChild(this.actionRow.root);
    }

    private buildActionRow(withExtras: boolean): ActionRow {
        const root = document.createElement("div");
        root.className = "chat-message-actions";

        if (withExtras) {
            const copyBtn = makeIconButton(
                "copy",
                "Copy message",
                iconCopy(),
                () => this.copyMessage(copyBtn),
            );
            root.appendChild(copyBtn);
        }

        const thumbsUp = makeIconButton(
            "thumbs-up",
            "Looks good",
            iconThumbsUp(false),
            () => this.onThumb("up"),
        );
        const thumbsDown = makeIconButton(
            "thumbs-down",
            "I don't like this",
            iconThumbsDown(false),
            (ev) => this.onThumb("down", ev.currentTarget as HTMLElement),
        );
        root.appendChild(thumbsUp);
        root.appendChild(thumbsDown);

        if (withExtras) {
            const moreBtn = makeIconButton(
                "more",
                "More feedback options",
                iconMore(),
                (ev) => this.openFlagMenu(ev.currentTarget as HTMLElement),
            );
            root.appendChild(moreBtn);
        }

        // Soft-hide ("trash") affordance — only when the host supplied a
        // setHidden hook. Optimistically toggles the trashed state on the
        // bubble container, then notifies the host; reverts on failure.
        if (withExtras && this.controller.setHidden) {
            const trashBtn = makeIconButton(
                "trash",
                "Move to trash",
                iconTrash(),
                () => void this.onTrash(),
            );
            root.appendChild(trashBtn);
        }

        return { root, thumbsUp, thumbsDown };
    }

    private async onTrash(): Promise<void> {
        const setHidden = this.controller.setHidden;
        if (!setHidden) return;
        const container = this.host.container;
        container.classList.add("chat-message-trashed");
        try {
            await setHidden(true, "agent");
        } catch (e) {
            container.classList.remove("chat-message-trashed");
            console.error("setHidden callback failed", e);
        }
    }

    private async onThumb(
        rating: "up" | "down",
        anchor?: HTMLElement,
    ): Promise<void> {
        const current = this.controller.getCurrentFeedback();
        if (rating === "up") {
            if (current?.rating === "up") {
                await this.controller.submit(null);
            } else {
                await this.controller.submit("up");
            }
            return;
        }
        const targetAnchor =
            anchor ?? this.actionRow?.thumbsDown ?? this.host.container;
        this.openPopover(targetAnchor, current ?? undefined);
    }

    private openFlagMenu(anchor: HTMLElement) {
        this.flagMenu?.remove();
        const menu = document.createElement("div");
        menu.className = "chat-feedback-menu";
        const entries: { label: string; run: () => void }[] = [
            {
                label: "👍  Looks good",
                run: () => void this.controller.submit("up"),
            },
            {
                label: "Wrong agent/action selected",
                run: () => void this.controller.submit("down", "wrong-agent"),
            },
            {
                label: "Didn't understand my request",
                run: () =>
                    void this.controller.submit("down", "didnt-understand"),
            },
            {
                label: "Response was incorrect or unhelpful",
                run: () => void this.controller.submit("down", "bad-response"),
            },
            {
                label: "Other (add a comment)…",
                run: () => this.openPopover(anchor, undefined, "other"),
            },
        ];
        const current = this.controller.getCurrentFeedback();
        if (current && current.rating !== null) {
            entries.push({
                label: "Clear rating",
                run: () => void this.controller.submit(null),
            });
        }
        for (const e of entries) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "chat-feedback-menu-item";
            item.textContent = e.label;
            item.addEventListener("click", () => {
                menu.remove();
                e.run();
            });
            menu.appendChild(item);
        }
        positionPopover(menu, anchor);
        document.body.appendChild(menu);
        this.flagMenu = menu;
        const dismiss = (ev: MouseEvent) => {
            if (!menu.contains(ev.target as Node) && ev.target !== anchor) {
                menu.remove();
                this.flagMenu = undefined;
                document.removeEventListener("mousedown", dismiss, true);
            }
        };
        setTimeout(
            () => document.addEventListener("mousedown", dismiss, true),
            0,
        );
    }

    private openPopover(
        anchor: HTMLElement,
        prefill?: UserFeedbackEntry,
        defaultCategory?: UserFeedbackCategory,
    ) {
        this.popover?.dispose();
        this.popover = new FeedbackPopover(
            anchor,
            prefill,
            defaultCategory,
            async (action) => {
                this.popover?.dispose();
                this.popover = undefined;
                if (action.kind === "submit") {
                    await this.controller.submit(
                        "down",
                        action.category,
                        action.comment,
                        action.includeContext,
                    );
                } else if (action.kind === "clear") {
                    await this.controller.submit(null);
                }
            },
        );
    }

    private async copyMessage(button: HTMLButtonElement) {
        const originalTitle = button.title;
        try {
            const txt = this.host.messageDiv.innerText;
            await navigator.clipboard.writeText(txt);
        } catch (e) {
            console.warn("clipboard write failed", e);
            return;
        }
        button.replaceChildren(iconCheck());
        button.classList.add("feedback-copied");
        button.title = "Copied!";
        button.setAttribute("aria-label", "Copied to clipboard");
        setTimeout(() => {
            if (!button.isConnected) return;
            button.replaceChildren(iconCopy());
            button.classList.remove("feedback-copied");
            button.title = originalTitle;
            button.setAttribute("aria-label", originalTitle);
        }, 1400);
    }

    private refreshFromEntry(entry: UserFeedbackEntry | null) {
        const rating = entry?.rating ?? null;
        const isUp = rating === "up";
        const isDown = rating === "down";
        if (rating !== null) {
            this.host.container.classList.add("feedback-rated");
        } else {
            this.host.container.classList.remove("feedback-rated");
        }
        const apply = (row?: ActionRow) => {
            if (!row) return;
            row.thumbsUp.classList.toggle("feedback-selected", isUp);
            row.thumbsDown.classList.toggle("feedback-selected", isDown);
            row.thumbsUp.replaceChildren(iconThumbsUp(isUp));
            row.thumbsDown.replaceChildren(iconThumbsDown(isDown));
            if (isDown && entry?.category) {
                row.thumbsDown.title = `Rated: ${formatCategory(entry.category)}`;
            } else {
                row.thumbsDown.title = "I don't like this";
            }
        };
        apply(this.actionRow);
    }
}

function makeIconButton(
    action: string,
    label: string,
    glyph: HTMLElement,
    onClick: (ev: MouseEvent) => void,
): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-action-button";
    btn.dataset.action = action;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.appendChild(glyph);
    btn.addEventListener("click", onClick);
    return btn;
}

function formatCategory(c: UserFeedbackCategory): string {
    switch (c) {
        case "wrong-agent":
            return "wrong agent/action selected";
        case "didnt-understand":
            return "didn't understand";
        case "bad-response":
            return "incorrect response";
        case "other":
            return "other";
    }
}

function positionPopover(el: HTMLElement, anchor: HTMLElement) {
    el.style.position = "fixed";
    el.style.zIndex = "9999";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const rect = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (top + h > vh - 8) top = Math.max(8, rect.top - h - 4);
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    if (left < 8) left = 8;
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = "";
    if (el.parentElement !== document.body) {
        document.body.appendChild(el);
    }
}

type PopoverAction =
    | {
          kind: "submit";
          category: UserFeedbackCategory;
          comment?: string;
          includeContext: boolean;
      }
    | { kind: "cancel" }
    | { kind: "clear" };

class FeedbackPopover {
    private root: HTMLElement;
    private onAction: (a: PopoverAction) => void;
    private dismissHandler: (ev: MouseEvent) => void;
    private keyHandler: (ev: KeyboardEvent) => void;

    constructor(
        anchor: HTMLElement,
        prefill: UserFeedbackEntry | undefined,
        defaultCategory: UserFeedbackCategory | undefined,
        onAction: (a: PopoverAction) => void,
    ) {
        this.onAction = onAction;
        this.root = document.createElement("div");
        this.root.className = "chat-feedback-popover";

        const heading = document.createElement("div");
        heading.className = "chat-feedback-popover-heading";
        heading.textContent = "Help us improve TypeAgent";
        this.root.appendChild(heading);

        const subtitle = document.createElement("div");
        subtitle.className = "chat-feedback-popover-subtitle";
        subtitle.textContent =
            "Your feedback is stored locally and (if telemetry is on) sent to Microsoft.";
        this.root.appendChild(subtitle);

        const commentLabel = document.createElement("label");
        commentLabel.className = "chat-feedback-popover-label";
        commentLabel.textContent = "What went wrong? (optional)";
        this.root.appendChild(commentLabel);

        const ta = document.createElement("textarea");
        ta.className = "chat-feedback-popover-textarea";
        ta.maxLength = 1000;
        ta.rows = 3;
        ta.value = prefill?.comment ?? "";
        commentLabel.appendChild(ta);

        const catFieldset = document.createElement("fieldset");
        catFieldset.className = "chat-feedback-popover-fieldset";
        const catLegend = document.createElement("legend");
        catLegend.textContent = "Category";
        catFieldset.appendChild(catLegend);

        const choices: { value: UserFeedbackCategory; label: string }[] = [
            { value: "wrong-agent", label: "Wrong agent/action selected" },
            {
                value: "didnt-understand",
                label: "Didn't understand my request",
            },
            {
                value: "bad-response",
                label: "Response was incorrect or unhelpful",
            },
            { value: "other", label: "Other" },
        ];
        const selected = prefill?.category ?? defaultCategory ?? "bad-response";
        const radios: HTMLInputElement[] = [];
        for (const c of choices) {
            const row = document.createElement("label");
            row.className = "chat-feedback-popover-radio";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "chat-feedback-category";
            input.value = c.value;
            if (c.value === selected) input.checked = true;
            row.appendChild(input);
            row.appendChild(document.createTextNode(" " + c.label));
            catFieldset.appendChild(row);
            radios.push(input);
        }
        this.root.appendChild(catFieldset);

        const shareLabel = document.createElement("label");
        shareLabel.className = "chat-feedback-popover-share";
        const shareCheckbox = document.createElement("input");
        shareCheckbox.type = "checkbox";
        shareCheckbox.checked = true;
        shareLabel.appendChild(shareCheckbox);
        shareLabel.appendChild(
            document.createTextNode(
                " Share my prompt, the agent's response, and the chosen action JSON with this feedback",
            ),
        );
        this.root.appendChild(shareLabel);

        const buttonRow = document.createElement("div");
        buttonRow.className = "chat-feedback-popover-buttons";

        if (prefill && prefill.rating !== null) {
            const clearBtn = document.createElement("button");
            clearBtn.type = "button";
            clearBtn.className = "chat-feedback-popover-button clear";
            clearBtn.textContent = "Clear rating";
            clearBtn.addEventListener("click", () =>
                this.onAction({ kind: "clear" }),
            );
            buttonRow.appendChild(clearBtn);
        }

        const spacer = document.createElement("span");
        spacer.style.flex = "1";
        buttonRow.appendChild(spacer);

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "chat-feedback-popover-button";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () =>
            this.onAction({ kind: "cancel" }),
        );
        buttonRow.appendChild(cancelBtn);

        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = "chat-feedback-popover-button submit";
        submitBtn.textContent = "Submit";
        submitBtn.addEventListener("click", () => {
            const chosen = (radios.find((r) => r.checked)?.value ??
                "bad-response") as UserFeedbackCategory;
            this.onAction({
                kind: "submit",
                category: chosen,
                comment: ta.value.trim() || undefined,
                includeContext: shareCheckbox.checked,
            });
        });
        buttonRow.appendChild(submitBtn);

        this.root.appendChild(buttonRow);

        positionPopover(this.root, anchor);
        setTimeout(() => ta.focus(), 0);

        this.dismissHandler = (ev: MouseEvent) => {
            if (
                !this.root.contains(ev.target as Node) &&
                ev.target !== anchor &&
                !anchor.contains(ev.target as Node)
            ) {
                this.onAction({ kind: "cancel" });
            }
        };
        this.keyHandler = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                this.onAction({ kind: "cancel" });
            }
        };
        setTimeout(
            () =>
                document.addEventListener(
                    "mousedown",
                    this.dismissHandler,
                    true,
                ),
            0,
        );
        document.addEventListener("keydown", this.keyHandler, true);
    }

    public dispose() {
        document.removeEventListener("mousedown", this.dismissHandler, true);
        document.removeEventListener("keydown", this.keyHandler, true);
        this.root.remove();
    }
}
