// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CROSSWORD_DECISION_LIMITS as limits,
    type CrosswordSnapshot,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";

const containers =
    '.xlv-frame, [role="group"][aria-roledescription="crossword"], [role="region"][aria-roledescription="crossword"]';
const excluded =
    "script,style,input,textarea,select,button,svg,[hidden],[aria-hidden=true]";
export const textOf = (node: Element): string => {
    const walk = (element: Element): string => {
        if (element.matches(excluded) || !isVisible(element)) return "";
        return Array.from(element.childNodes)
            .map((child) =>
                child.nodeType === Node.TEXT_NODE
                    ? (child.textContent ?? "")
                    : child instanceof Element
                      ? walk(child)
                      : "",
            )
            .join(" ");
    };
    return walk(node).replace(/\s+/g, " ").trim();
};

export function isVisible(node: Element): boolean {
    for (
        let current: Element | null = node;
        current;
        current = current.parentElement
    ) {
        const style = getComputedStyle(current);
        if (
            current.matches("[hidden],[aria-hidden=true]") ||
            style.display === "none" ||
            style.visibility === "hidden"
        )
            return false;
    }
    return node.isConnected && node.getClientRects().length > 0;
}

function escape(value: string): string {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
    return Array.from(value)
        .map((char, index) =>
            /^[a-zA-Z_-]$/.test(char) || (index > 0 && /^[0-9]$/.test(char))
                ? char
                : `\\${char.codePointAt(0)!.toString(16)} `,
        )
        .join("");
}

export function uniqueSelector(node: Element): string {
    const parts: string[] = [];
    for (
        let current: Element | null = node;
        current;
        current = current.parentElement
    ) {
        if (current.id) {
            const id = `#${escape(current.id)}`;
            if (document.querySelectorAll(id).length === 1) {
                parts.unshift(id);
                break;
            }
        }
        const index = current.parentElement
            ? Array.from(current.parentElement.children).indexOf(current) + 1
            : 1;
        parts.unshift(`${escape(current.localName)}:nth-child(${index})`);
    }
    const selector = parts.join(" > ");
    if (
        document.querySelectorAll(selector).length !== 1 ||
        document.querySelector(selector) !== node
    )
        throw new Error("unsupported: non-unique selector");
    return selector;
}

function contextOf(node: Element, root: Element): string {
    const parts: string[] = [];
    for (
        let parent = node.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
    ) {
        const label = parent.getAttribute("aria-label");
        if (label) parts.push(label);
        const heading = Array.from(parent.children).find((child) =>
            child.matches(
                "h1,h2,h3,h4,h5,h6,[role=heading],caption,legend,.xlv-clues-heading,.xlv-clues-label",
            ),
        );
        if (heading) parts.push(textOf(heading));
        if (parent === root) break;
    }
    return [...new Set(parts.filter(Boolean))].join(" | ");
}

export type CandidateNode = {
    node: Element;
    selector: string;
    text: string;
    context: string;
    role: string | null;
};
export type Collected = {
    snapshot: CrosswordSnapshot;
    root: Element;
    registry: Map<string, CandidateNode>;
    url: string;
};

export function collect(
    documentToken: string,
    revision: number,
    modeGeneration: number,
): Collected {
    const roots = Array.from(document.querySelectorAll(containers)).filter(
        isVisible,
    );
    if (roots.length !== 1)
        throw new Error("unsupported: missing or ambiguous puzzle container");
    const root = roots[0];
    const evidenceRoot = root.matches(".xlv-frame")
        ? (root.querySelector(".xlv-clues") ?? root)
        : root;
    const nodes = new Set<Element>();
    for (const leaf of Array.from(evidenceRoot.querySelectorAll("*"))) {
        if (
            leaf.closest(excluded) ||
            !isVisible(leaf) ||
            !Array.from(leaf.childNodes).some(
                (child) =>
                    child.nodeType === Node.TEXT_NODE &&
                    child.textContent?.trim(),
            )
        )
            continue;
        const row = leaf.closest("tr,li,[role=row],[role=listitem]");
        if (row && root.contains(row)) nodes.add(row);
        else if (
            leaf.parentElement !== evidenceRoot &&
            leaf.parentElement?.matches("div,p") &&
            leaf.parentElement.children.length >= 2 &&
            Array.from(leaf.parentElement.children).every(
                (child) =>
                    child.matches("span,a,b,strong,em,small,i") &&
                    !!textOf(child),
            )
        )
            nodes.add(leaf.parentElement);
        else if (!Array.from(leaf.children).some((child) => textOf(child)))
            nodes.add(leaf);
    }
    // Headers remain evidence through context, not additional semantic clue labels.
    const rows = Array.from(nodes).filter(
        (node) =>
            !node.matches(
                "h1,h2,h3,h4,h5,h6,[role=heading],caption,legend,.xlv-clues-heading,.xlv-clues-label",
            ) &&
            !Array.from(nodes).some(
                (other) => other !== node && other.contains(node),
            ),
    );
    if (!rows.length || rows.length > limits.candidates)
        throw new Error("unsupported: incomplete candidate set (count bound)");
    const registry = new Map<string, CandidateNode>();
    const candidates = rows.map((node, index) => {
        const id = `c${index}`;
        const text = textOf(node);
        const context = contextOf(node, root);
        if (
            !text ||
            text.length > limits.textLength ||
            context.length > limits.contextLength
        )
            throw new Error(
                "unsupported: incomplete candidate set (text bound)",
            );
        const role = node.getAttribute("role");
        if (role !== null && (!role.trim() || role.length > 64))
            throw new Error(
                "unsupported: incomplete candidate set (role bound)",
            );
        registry.set(id, {
            node,
            selector: uniqueSelector(node),
            text,
            context,
            role,
        });
        return { id, text, context, ...(role ? { role } : {}) };
    });
    const snapshot: CrosswordSnapshot = {
        snapshotId: crypto.randomUUID(),
        documentToken,
        puzzleId: crypto.randomUUID(),
        revision,
        modeGeneration,
        createdAt: Date.now(),
        collectorVersion: limits.collectorVersion,
        complete: true,
        candidates,
    };
    if (
        new TextEncoder().encode(JSON.stringify(snapshot)).length >
        limits.snapshotBytes
    )
        throw new Error("unsupported: incomplete candidate set (byte bound)");
    return { snapshot, root, registry, url: location.href };
}

export function validateNode(state: Collected, binding: CandidateNode): void {
    if (
        state.url !== location.href ||
        !state.root.isConnected ||
        !state.root.contains(binding.node) ||
        !isVisible(binding.node) ||
        document.querySelectorAll(binding.selector).length !== 1 ||
        document.querySelector(binding.selector) !== binding.node ||
        textOf(binding.node) !== binding.text ||
        contextOf(binding.node, state.root) !== binding.context ||
        binding.node.getAttribute("role") !== binding.role
    )
        throw new Error("stale: crossword target changed");
}
