// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    UI_DECISION_LIMITS as limits,
    assertUiAction,
    assertUiObservation,
    type UiAction,
    type UiActionResult,
    type UiCandidate,
    type UiObservation,
} from "@typeagent/browser-control-rpc/uiDecisionTypes";

const controls =
    "a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[role=radio],[role=combobox]";
const excluded =
    "script,style,noscript,template,input,textarea,select,[hidden],[aria-hidden=true],[inert]";
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

function visible(node: Element): boolean {
    if (!node.isConnected || !node.getClientRects().length) return false;
    for (
        let current: Element | null = node;
        current;
        current = current.parentElement
    ) {
        const style = getComputedStyle(current);
        if (
            current.matches("[hidden],[aria-hidden=true],[inert]") ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.opacity === "0"
        )
            return false;
    }
    return true;
}

function visibleText(
    root: Element,
    isVisible: (node: Element) => boolean,
    cache: Map<Element, string>,
): string {
    const cached = cache.get(root);
    if (cached !== undefined) return cached;
    if (root.matches(excluded) || !isVisible(root)) {
        cache.set(root, "");
        return "";
    }
    const text = normalize(
        Array.from(root.childNodes)
            .map((child) =>
                child.nodeType === Node.TEXT_NODE
                    ? (child.textContent ?? "")
                    : child instanceof Element
                      ? visibleText(child, isVisible, cache)
                      : "",
            )
            .join(" "),
    );
    cache.set(root, text);
    return text;
}

function disabled(node: Element): boolean {
    return (
        node.matches(":disabled,[readonly]") ||
        !!node.closest('[aria-disabled="true"]')
    );
}

function controlName(
    node: Element,
    readText: (node: Element) => string,
): string {
    const labelIds = node.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
    const labels = labelIds
        .map((label) => {
            const element = node.ownerDocument.getElementById(label);
            return element ? readText(element) : "";
        })
        .join(" ");
    const nativeLabels =
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement
            ? Array.from(node.labels ?? [], (label) => readText(label)).join(
                  " ",
              )
            : "";
    return normalize(
        labels ||
            node.getAttribute("aria-label") ||
            nativeLabels ||
            readText(node) ||
            node.getAttribute("title") ||
            node.getAttribute("placeholder") ||
            (node instanceof HTMLInputElement &&
            ["submit", "button", "reset"].includes(node.type)
                ? node.value
                : ""),
    );
}

function candidate(
    node: Element,
    id: string,
    readText: (node: Element) => string,
): UiCandidate | undefined {
    const sensitive =
        /password|email|tel|credit|cc-|address|name|username|one-time|transaction/i;
    if (
        sensitive.test(node.getAttribute("autocomplete") ?? "") ||
        (node instanceof HTMLInputElement &&
            ![
                "text",
                "search",
                "button",
                "submit",
                "reset",
                "checkbox",
                "radio",
            ].includes(node.type))
    )
        return undefined;
    if (node instanceof HTMLAnchorElement) {
        const destination = new URL(node.href, location.href);
        if (
            !["http:", "https:"].includes(destination.protocol) ||
            destination.username ||
            destination.password
        )
            return undefined;
    }
    const fill =
        node instanceof HTMLTextAreaElement ||
        (node instanceof HTMLInputElement &&
            ["text", "search"].includes(node.type));
    const select = node instanceof HTMLSelectElement;
    const region =
        node.closest(
            "article,li,tr,[role=listitem],[role=row],[role=dialog],form",
        ) ??
        node.parentElement ??
        node;
    return {
        id,
        name: controlName(node, readText),
        role:
            node.getAttribute("role") ??
            (fill
                ? "textbox"
                : select
                  ? "combobox"
                  : node instanceof HTMLAnchorElement
                    ? "link"
                    : "button"),
        context: readText(region),
        capabilities: fill ? ["fill"] : select ? ["select"] : ["activate"],
        disabled: disabled(node),
        ...(node instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(node.type)
            ? { checked: node.checked }
            : ["true", "false"].includes(
                    node.getAttribute("aria-checked") ?? "",
                )
              ? { checked: node.getAttribute("aria-checked") === "true" }
              : {}),
        ...(node.hasAttribute("aria-expanded")
            ? { expanded: node.getAttribute("aria-expanded") === "true" }
            : {}),
        ...(select
            ? {
                  selectedOptionId: `o${node.selectedIndex}`,
                  options: Array.from(node.options, (option, index) => ({
                      id: `o${index}`,
                      text: normalize(option.textContent ?? ""),
                      disabled:
                          option.disabled ||
                          !!option.closest("optgroup[disabled]"),
                  })),
              }
            : {}),
    };
}

type Captured = {
    observation: UiObservation;
    nodes: Element[];
    fingerprint: string;
};

function bindingState(node: Element): unknown {
    const form =
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement ||
        node instanceof HTMLButtonElement
            ? node.form
            : null;
    return {
        attributes: [
            "href",
            "target",
            "type",
            "form",
            "formaction",
            "formmethod",
            "formtarget",
            "aria-checked",
            "aria-selected",
            "aria-expanded",
        ].map((name) => node.getAttribute(name)),
        checked: node instanceof HTMLInputElement ? node.checked : undefined,
        selected:
            node instanceof HTMLSelectElement ? node.selectedIndex : undefined,
        form: form ? [form.action, form.method, form.target] : undefined,
    };
}

function capture(): Captured {
    const root = document.body;
    if (!root || document.readyState === "loading")
        throw new Error("unsupported: UI document is not ready");
    const all = [root, ...Array.from(root.querySelectorAll("*"))];
    if (all.length > limits.nodes)
        throw new Error("unsupported: UI DOM exceeds node bound");
    const visibility = new Map<Element, boolean>();
    const isVisible = (node: Element) => {
        let result = visibility.get(node);
        if (result === undefined) {
            result = visible(node);
            visibility.set(node, result);
        }
        return result;
    };
    const textCache = new Map<Element, string>();
    const readText = (node: Element) => visibleText(node, isVisible, textCache);
    if (all.some((node) => node.shadowRoot && isVisible(node)))
        throw new Error(
            "unsupported: shadow DOM UI collection is not supported",
        );
    const nodes: Element[] = [];
    const candidates: UiCandidate[] = [];
    for (const node of root.querySelectorAll(controls)) {
        if (!isVisible(node)) continue;
        const evidence = candidate(node, `c${candidates.length}`, readText);
        if (!evidence) continue;
        nodes.push(node);
        candidates.push(evidence);
        if (candidates.length > limits.candidates)
            throw new Error("unsupported: UI controls exceed candidate bound");
    }
    const observation: UiObservation = {
        snapshotId: crypto.randomUUID(),
        url: location.href,
        createdAt: Date.now(),
        complete: true,
        candidates,
        content: readText(root),
    };
    assertUiObservation(observation);
    return {
        observation,
        nodes,
        fingerprint: JSON.stringify([
            observation.url,
            candidates,
            observation.content,
            nodes.map(bindingState),
        ]),
    };
}

export class UiDecisionHost {
    private readonly snapshots = new Map<string, Captured>();

    capture(): UiObservation {
        for (const [id, state] of this.snapshots)
            if (Date.now() - state.observation.createdAt >= limits.lifetimeMs)
                this.snapshots.delete(id);
        if (this.snapshots.size >= limits.snapshots)
            this.snapshots.delete(this.snapshots.keys().next().value!);
        const state = capture();
        this.snapshots.set(state.observation.snapshotId, state);
        return state.observation;
    }

    private current(snapshotId: string): Captured {
        const state = this.snapshots.get(snapshotId);
        if (
            !state ||
            Date.now() - state.observation.createdAt >= limits.lifetimeMs
        )
            throw new Error("stale: grounded UI observation expired");
        const fresh = capture();
        if (
            fresh.fingerprint !== state.fingerprint ||
            fresh.nodes.length !== state.nodes.length ||
            fresh.nodes.some((node, index) => node !== state.nodes[index])
        ) {
            this.snapshots.delete(snapshotId);
            throw new Error("stale: grounded UI document changed");
        }
        return state;
    }

    validate(snapshotId: string): void {
        this.current(snapshotId);
    }

    execute(
        snapshotId: string,
        candidateId: string,
        action: UiAction,
    ): UiActionResult {
        assertUiAction(action);
        const state = this.current(snapshotId);
        const index = state.observation.candidates.findIndex(
            (entry) => entry.id === candidateId,
        );
        const evidence = state.observation.candidates[index];
        const node = state.nodes[index];
        if (
            !evidence ||
            !node ||
            evidence.disabled ||
            !evidence.capabilities.includes(action.type)
        )
            throw new Error(
                "unsupported: grounded UI action does not match the target",
            );
        this.snapshots.delete(snapshotId);
        if (action.type === "activate") {
            if (!(node instanceof HTMLElement))
                throw new Error("unsupported: target cannot be activated");
            node.click();
            return { dispatched: true };
        }
        if (action.type === "select") {
            if (!(node instanceof HTMLSelectElement))
                throw new Error("unsupported: target is not a native select");
            const optionIndex =
                evidence.options?.findIndex(
                    (option) => option.id === action.optionId,
                ) ?? -1;
            if (optionIndex < 0 || evidence.options?.[optionIndex].disabled)
                throw new Error("unsupported: unissued or disabled UI option");
            node.selectedIndex = optionIndex;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
            if (!node.isConnected || node.selectedIndex !== optionIndex)
                throw new Error(
                    "verification_failed: selected option did not persist; no retry",
                );
            return { dispatched: true, valueVerified: true };
        }
        return fill(node, action);
    }
}

function fill(
    node: Element,
    action: Extract<UiAction, { type: "fill" }>,
): UiActionResult {
    if (
        !(
            node instanceof HTMLInputElement ||
            node instanceof HTMLTextAreaElement
        )
    )
        throw new Error("unsupported: target is not a native text control");
    const form = node.form;
    const identity = JSON.stringify(bindingState(node));
    if (action.submit && (!form || !form.requestSubmit))
        throw new Error(
            "unsupported: grounded input has no native submit form",
        );
    const prototype =
        node instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter)
        throw new Error("unsupported: native input setter unavailable");
    setter.call(node, action.text);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    if (
        !node.isConnected ||
        !visible(node) ||
        disabled(node) ||
        node.value !== action.text ||
        JSON.stringify(bindingState(node)) !== identity
    )
        throw new Error(
            "verification_failed: entered text did not persist; no retry",
        );
    if (action.submit) {
        if (node.form !== form || !form?.isConnected)
            throw new Error("stale: input form changed; no submit attempted");
        form.requestSubmit();
    }
    return { dispatched: true, valueVerified: true };
}

export function initializeUiDecisionHost(): void {
    const host = new UiDecisionHost();
    chrome.runtime.onMessage.addListener(
        (message: unknown, sender, sendResponse) => {
            if (
                !message ||
                typeof message !== "object" ||
                !("type" in message) ||
                message.type !== "groundedUi"
            )
                return false;
            if (sender.id !== chrome.runtime.id) return false;
            try {
                if (
                    !("expiresAt" in message) ||
                    typeof message.expiresAt !== "number" ||
                    !Number.isSafeInteger(message.expiresAt) ||
                    message.expiresAt <= Date.now() ||
                    message.expiresAt > Date.now() + limits.timeoutMs
                )
                    throw new Error(
                        "stale: grounded UI request deadline expired",
                    );
                if (
                    !("request" in message) ||
                    !message.request ||
                    typeof message.request !== "object"
                )
                    throw new Error("unsupported: invalid grounded UI request");
                const request = message.request;
                if (!("method" in request))
                    throw new Error("unsupported: missing grounded UI method");
                if (request.method === "capture") {
                    sendResponse({ data: host.capture() });
                    return false;
                }
                if (
                    !("snapshotId" in request) ||
                    typeof request.snapshotId !== "string"
                )
                    throw new Error(
                        "unsupported: missing grounded UI snapshot",
                    );
                if (request.method === "validate") {
                    host.validate(request.snapshotId);
                    sendResponse({ data: {} });
                } else if (
                    request.method === "execute" &&
                    "candidateId" in request &&
                    typeof request.candidateId === "string" &&
                    "action" in request
                ) {
                    assertUiAction(request.action);
                    sendResponse({
                        data: host.execute(
                            request.snapshotId,
                            request.candidateId,
                            request.action,
                        ),
                    });
                } else
                    throw new Error("unsupported: unknown grounded UI method");
            } catch (error) {
                sendResponse({
                    error:
                        error instanceof Error
                            ? error.message
                            : "provider_error: grounded UI host failed",
                });
            }
            return false;
        },
    );
}
