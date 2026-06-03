// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Modal popup surfaces for ChatPanel: the data-driven settings popup and
 * the help popup. Both render an overlay inside the panel's root element,
 * trap focus while open, and close on Escape / backdrop click. chat-ui owns
 * the modal chrome; hosts supply only data (SettingsPanelSchema /
 * HelpPanelContent).
 */

import DOMPurify from "dompurify";
import type {
    HelpPanelContent,
    SettingsField,
    SettingsPanelSchema,
} from "./providers.js";

function createOverlay(rootElement: HTMLElement): {
    overlay: HTMLDivElement;
    card: HTMLDivElement;
    close: () => void;
} {
    const overlay = document.createElement("div");
    overlay.className = "chat-modal-overlay";

    const card = document.createElement("div");
    card.className = "chat-modal-card";
    overlay.appendChild(card);

    const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    };

    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    };

    overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey, true);

    rootElement.appendChild(overlay);
    return { overlay, card, close };
}

function addCloseButton(card: HTMLElement, title: string, close: () => void) {
    const header = document.createElement("div");
    header.className = "chat-modal-header";

    const heading = document.createElement("h2");
    heading.className = "chat-modal-title";
    heading.textContent = title;
    header.appendChild(heading);

    const closeBtn = document.createElement("button");
    closeBtn.className = "chat-modal-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    header.appendChild(closeBtn);

    card.appendChild(header);
}

function renderField(field: SettingsField): HTMLElement {
    const row = document.createElement("div");
    row.className = "chat-settings-row";

    const label = document.createElement("label");
    label.className = "chat-settings-label";
    label.textContent = field.label;
    label.htmlFor = `chat-setting-${field.id}`;
    row.appendChild(label);

    if (field.type === "toggle") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = `chat-setting-${field.id}`;
        input.checked = field.value === true;
        input.addEventListener("change", () => field.onChange(input.checked));
        row.appendChild(input);
    } else if (field.type === "select") {
        const select = document.createElement("select");
        select.id = `chat-setting-${field.id}`;
        select.className = "chat-settings-select";
        // Placeholder until async options resolve.
        const loading = document.createElement("option");
        loading.textContent = "Loading…";
        select.appendChild(loading);
        select.disabled = true;
        select.addEventListener("change", () => field.onChange(select.value));
        row.appendChild(select);

        if (field.getOptions) {
            void field.getOptions().then((options) => {
                select.replaceChildren();
                for (const opt of options) {
                    const optionEl = document.createElement("option");
                    optionEl.value = opt.value;
                    optionEl.textContent = opt.label;
                    if (opt.value === field.value) optionEl.selected = true;
                    select.appendChild(optionEl);
                }
                select.disabled = false;
            });
        } else {
            select.disabled = false;
        }
    } else {
        const input = document.createElement("input");
        input.type = "text";
        input.id = `chat-setting-${field.id}`;
        input.className = "chat-settings-text";
        input.value = typeof field.value === "string" ? field.value : "";
        input.addEventListener("change", () => field.onChange(input.value));
        row.appendChild(input);
    }

    return row;
}

/** Render the settings modal from a data-driven schema. */
export function openSettingsPopup(
    rootElement: HTMLElement,
    schema: SettingsPanelSchema,
): void {
    const { card, close } = createOverlay(rootElement);
    addCloseButton(card, "Settings", close);

    const body = document.createElement("div");
    body.className = "chat-modal-body";

    for (const section of schema.sections) {
        const sectionEl = document.createElement("section");
        sectionEl.className = "chat-settings-section";

        const title = document.createElement("h3");
        title.className = "chat-settings-section-title";
        title.textContent = section.title;
        sectionEl.appendChild(title);

        for (const field of section.fields ?? []) {
            sectionEl.appendChild(renderField(field));
        }
        if (section.customContent) {
            sectionEl.appendChild(section.customContent);
        }
        body.appendChild(sectionEl);
    }

    card.appendChild(body);
}

/** Render the help modal from raw HTML or structured sections. */
export function openHelpPopup(
    rootElement: HTMLElement,
    content: HelpPanelContent,
): void {
    const { card, close } = createOverlay(rootElement);
    addCloseButton(card, "Help", close);

    const body = document.createElement("div");
    body.className = "chat-modal-body chat-help-body";

    if ("html" in content) {
        body.innerHTML = DOMPurify.sanitize(content.html);
    } else {
        for (const section of content.sections) {
            const title = document.createElement("h3");
            title.textContent = section.title;
            body.appendChild(title);
            const div = document.createElement("div");
            div.innerHTML = DOMPurify.sanitize(section.html);
            body.appendChild(div);
        }
    }

    card.appendChild(body);
}
