// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { ProcedureDocument } from "@typeagent/memory-service";
import { setIconButton } from "./memoryHubUi";

export function rbNode<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    return value;
}
export function rbButton(text: string, handler: () => void, name?: string) {
    const value = rbNode("button", text);
    value.type = "button";
    if (name) value.name = name;
    value.addEventListener("click", handler);
    return value;
}
export function rbIconButton(
    glyph: string,
    label: string,
    handler: () => void,
    name?: string,
) {
    return setIconButton(rbButton("", handler, name), glyph, label);
}
export function rbField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { multiline?: boolean; readonly?: boolean; name?: string } = {},
) {
    const wrapper = rbNode("label", label);
    const control = options.multiline ? rbNode("textarea") : rbNode("input");
    control.value = value;
    control.readOnly = options.readonly ?? false;
    if (options.name) control.name = options.name;
    control.addEventListener("input", () => onChange(control.value));
    wrapper.append(control);
    return wrapper;
}
export function rbCheck(
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void,
    name?: string,
) {
    const wrapper = rbNode("label", undefined, "runbook-check");
    const control = rbNode("input");
    control.type = "checkbox";
    control.checked = checked;
    if (name) control.name = name;
    control.addEventListener("change", () => onChange(control.checked));
    wrapper.append(control, rbNode("span", label));
    return wrapper;
}
export function rbSelect<T extends string>(
    label: string,
    selected: T,
    values: readonly T[],
    onChange: (value: T) => void,
    name?: string,
) {
    const wrapper = rbNode("label", label);
    const select = rbNode("select");
    if (name) select.name = name;
    for (const value of values) {
        const option = rbNode("option", value);
        option.value = value;
        select.append(option);
    }
    select.value = selected;
    select.addEventListener("change", () => {
        const value = values.find((value) => value === select.value);
        if (value !== undefined) onChange(value);
    });
    wrapper.append(select);
    return wrapper;
}
export function rbMarkdown(value: string) {
    const container = rbNode("div", undefined, "runbook-preview");
    const markdown = new MarkdownIt({ html: false, breaks: true });
    container.innerHTML = DOMPurify.sanitize(markdown.render(value), {
        ALLOWED_TAGS: [
            "p",
            "br",
            "strong",
            "em",
            "code",
            "pre",
            "h1",
            "h2",
            "h3",
            "h4",
            "ul",
            "ol",
            "li",
            "blockquote",
            "a",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
        ],
        ALLOWED_ATTR: ["href", "title"],
        ALLOW_DATA_ATTR: false,
    });
    for (const link of container.querySelectorAll("a")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    for (const heading of container.querySelectorAll("h2")) {
        if (!["Sources", "Agent Edition"].includes(heading.textContent ?? ""))
            continue;
        let sibling = heading.nextElementSibling;
        while (sibling && sibling.tagName !== "H2") {
            const next: Element | null = sibling.nextElementSibling;
            sibling.remove();
            sibling = next;
        }
        heading.remove();
    }
    return container;
}
export function rbReadOnlyEdition(document: ProcedureDocument) {
    const root = rbNode("section");
    const edition = document.agentEdition;
    if (!edition) {
        root.append(
            rbNode("h3", "Human steps (read-only)"),
            ...document.steps.map((step, index) =>
                rbNode("p", `${index + 1}. ${step}`),
            ),
        );
        return root;
    }
    root.append(
        rbNode("h3", "Agent edition - executable adaptation (read-only)"),
        rbNode("p", `Goal: ${edition.goal}`),
        rbNode("p", `Review: ${edition.review.state}`),
        rbNode("p", `Applicability: ${edition.applicability.join("; ")}`),
        rbNode("p", `Preconditions: ${edition.preconditions.join("; ")}`),
    );
    for (const input of edition.inputs)
        root.append(
            rbNode(
                "p",
                `Input ${input.id}: ${input.description} · ${input.type} · ${input.required ? "required" : "optional"}${input.secret ? " · secret values are never retained/displayed" : ""}`,
            ),
        );
    for (const step of edition.steps) {
        const card = rbNode(
            "article",
            undefined,
            step.needsAttention ? "runbook-affected" : undefined,
        );
        card.append(
            rbNode("h4", `${step.id} · ${step.title}`),
            rbNode("p", `Human original: ${step.humanText}`),
            rbNode("p", `Derived instruction: ${step.agentInstruction}`),
            rbNode(
                "p",
                `Safety: ${step.safety}; binding ${step.binding?.kind ?? "unbound"}; ${step.citations.length} citations; ${step.assets?.length ?? 0} retained asset references`,
            ),
            rbNode("p", `Condition: ${step.condition ?? "none"}`),
            rbNode(
                "p",
                `Verification: ${step.verification ?? "not specified"}`,
            ),
            rbNode("p", `Rollback: ${step.rollback ?? "not specified"}`),
            rbNode(
                "p",
                step.attentionReasons?.join("; ") ?? "",
                "runbook-warning",
            ),
        );
        root.append(card);
    }
    root.append(
        rbNode("p", `Overall verification: ${edition.verification.join("; ")}`),
        rbNode("p", `Overall rollback: ${edition.rollback.join("; ")}`),
    );
    return root;
}
export function rbLines(value: string): string[] {
    return value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}
export function rbError(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}
