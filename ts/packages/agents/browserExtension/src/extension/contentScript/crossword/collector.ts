// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CROSSWORD_DECISION_LIMITS as limits,
    parseCrosswordClueIdentity,
    type CrosswordDirection,
    type CrosswordSnapshot,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";

const excluded =
    "script,style,noscript,template,input,textarea,select,svg,[hidden],[aria-hidden=true],[role=status],[role=progressbar],.xlv-frame .xlv-status";
const headings =
    "h1,h2,h3,h4,h5,h6,[role=heading],caption,legend,.xlv-clues-heading,.xlv-clues-label";
const scopes =
    '.xlv-frame,[aria-roledescription="crossword"],article,section,[role=region],[role=group]';
const regions =
    "ul,ol,table,[role=list],[role=table],section,article,main,nav,aside,header,footer,div";
export const textOf = (
    node: Element,
    visible: (node: Element) => boolean = isVisible,
): string => {
    const walk = (element: Element): string => {
        if (element.matches(excluded) || !visible(element)) return "";
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

function contextOf(
    node: Element,
    root: Element,
    readText: (node: Element) => string = textOf,
    headingCache = new Map<Element, Element[]>(),
): string {
    const parts: string[] = [node.getAttribute("aria-label") ?? ""];
    let branch = node;
    for (
        let parent = node.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
    ) {
        const label = parent.getAttribute("aria-label");
        if (label) parts.push(label);
        let siblings = headingCache.get(parent);
        if (!siblings) {
            siblings = Array.from(parent.children).filter((child) => {
                if (child.matches(headings)) return true;
                const label = /^(?:across|down)(?:\s+clues)?$/i;
                return (
                    label.test(child.textContent?.trim() ?? "") &&
                    label.test(readText(child))
                );
            });
            headingCache.set(parent, siblings);
        }
        const heading = [...siblings]
            .reverse()
            .find(
                (child) =>
                    !!(
                        child.compareDocumentPosition(branch) &
                        Node.DOCUMENT_POSITION_FOLLOWING
                    ),
            );
        if (heading) {
            const value = readText(heading);
            // A nearer group heading wins over a page-wide sibling heading.
            if (!directionOf(parts.join(" | ")) || !directionOf(value))
                parts.push(value);
        }
        if (parent === root) break;
        branch = parent;
    }
    return [...new Set(parts.filter(Boolean))].join(" | ");
}

function directionOf(context: string): CrosswordDirection | undefined {
    for (const part of context.split(" | ")) {
        const across = /\bacross\b/i.test(part);
        const down = /\bdown\b/i.test(part);
        if (across !== down) return across ? "across" : "down";
    }
    return undefined;
}

function regionOf(node: Element, root: Element): Element {
    return node.parentElement?.closest(regions) ?? root;
}

function scopeOf(node: Element, root: Element): Element {
    return node.closest(scopes) ?? root;
}

export type CandidateNode = {
    node: Element;
    selector: string;
    text: string;
    context: string;
    role: string | null;
    region: Element;
    scope: Element;
    textMode: "subtree" | "direct";
};
function directText(node: Element): string {
    return Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}
export function candidateText(binding: CandidateNode): string {
    return binding.textMode === "subtree"
        ? textOf(binding.node)
        : directText(binding.node);
}
export type Collected = {
    snapshot: CrosswordSnapshot;
    root: Element;
    registry: Map<string, CandidateNode>;
    url: string;
};

function candidateNodes(
    root: Element,
    visible: (node: Element) => boolean,
    readText: (node: Element) => string,
): Map<Element, CandidateNode["textMode"]> {
    const nodes = new Map<Element, CandidateNode["textMode"]>();
    for (const leaf of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (
            leaf.closest(excluded) ||
            !visible(leaf) ||
            !Array.from(leaf.childNodes).some(
                (child) =>
                    child.nodeType === Node.TEXT_NODE &&
                    child.textContent?.trim(),
            )
        )
            continue;
        const heading = leaf.closest(headings);
        if (heading && root.contains(heading)) {
            nodes.set(heading, "subtree");
            continue;
        }
        const row = leaf.closest("tr,li,[role=row],[role=listitem]");
        if (row && root.contains(row)) nodes.set(row, "subtree");
        else if (
            leaf.parentElement !== root &&
            leaf.parentElement?.matches("div,p") &&
            leaf.parentElement.children.length >= 2 &&
            (Array.from(leaf.parentElement.children).every((child) =>
                child.matches("span,a,b,strong,em,small,i"),
            ) ||
                (leaf.parentElement.children.length <= 4 &&
                    /^\d{1,4}[.)]?$/.test(
                        readText(leaf.parentElement.children[0]),
                    )))
        )
            nodes.set(leaf.parentElement, "subtree");
        else
            nodes.set(
                leaf,
                Array.from(leaf.children).some((child) => readText(child))
                    ? "direct"
                    : "subtree",
            );
    }
    // Group headings provide context; numbered headings may themselves be clues.
    const rows = Array.from(nodes.keys()).filter((node) => {
        if (
            node.matches(headings) &&
            !/^\(?\d{1,4}[ad]?\)?(?=$|[\s.:()-])/i.test(readText(node))
        )
            return false;
        for (
            let parent = node.parentElement;
            parent;
            parent = parent.parentElement
        )
            if (nodes.get(parent) === "subtree") return false;
        return true;
    });
    return new Map(rows.map((node) => [node, nodes.get(node)!]));
}

export function collect(
    documentToken: string,
    revision: number,
    modeGeneration: number,
): Collected {
    const root = document.body;
    if (!root) throw new Error("unsupported: document body unavailable");
    const visibility = new Map<Element, boolean>();
    const visible = (node: Element) => {
        let result = visibility.get(node);
        if (result === undefined) {
            result = isVisible(node);
            visibility.set(node, result);
        }
        return result;
    };
    const texts = new Map<Element, string>();
    const readText = (node: Element) => {
        let result = texts.get(node);
        if (result === undefined) {
            result = textOf(node, visible);
            texts.set(node, result);
        }
        return result;
    };
    const headingCache = new Map<Element, Element[]>();
    const nodes = candidateNodes(root, visible, readText);
    const rows = [...nodes.keys()];
    if (rows.length > limits.candidates)
        throw new Error("unsupported: incomplete candidate set (count bound)");
    const registry = new Map<string, CandidateNode>();
    const regionIds = new Map<Element, string>();
    const scopeIds = new Map<Element, string>();
    const idOf = (
        map: Map<Element, string>,
        element: Element,
        prefix: string,
    ) => {
        let id = map.get(element);
        if (!id) {
            id = `${prefix}${map.size}`;
            map.set(element, id);
        }
        return id;
    };
    let candidates = rows.map((node, index) => {
        const id = `c${index}`;
        const textMode = nodes.get(node)!;
        const text = textMode === "subtree" ? readText(node) : directText(node);
        const context = contextOf(node, root, readText, headingCache);
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
        const region = regionOf(node, root);
        const scope = scopeOf(node, root);
        registry.set(id, {
            node,
            selector: "",
            text,
            context,
            role,
            region,
            scope,
            textMode,
        });
        return {
            id,
            text,
            context,
            regionId: idOf(regionIds, region, "r"),
            scopeId: idOf(scopeIds, scope, "p"),
            ...(role ? { role } : {}),
        };
    });
    const canonical = new Map<string, string>();
    const keys = new Map<string, string>();
    for (const candidate of candidates) {
        const binding = registry.get(candidate.id)!;
        const identity = identityOf(binding);
        if (!identity.number || !identity.direction) continue;
        const key = JSON.stringify([
            candidate.scopeId,
            identity.number,
            identity.direction,
            logicalClueText(binding),
        ]);
        keys.set(candidate.id, key);
        const prior = canonical.get(key);
        if (
            !prior ||
            (!registry
                .get(prior)!
                .node.matches("tr,li,[role=row],[role=listitem]") &&
                binding.node.matches("tr,li,[role=row],[role=listitem]"))
        )
            canonical.set(key, candidate.id);
    }
    candidates = candidates.filter(
        (candidate) =>
            /[\p{L}\p{N}]/u.test(candidate.text) &&
            (!keys.has(candidate.id) ||
                canonical.get(keys.get(candidate.id)!) === candidate.id),
    );
    const bindings = candidates.map((candidate) => registry.get(candidate.id)!);
    registry.clear();
    regionIds.clear();
    scopeIds.clear();
    candidates = candidates.map((candidate, index) => {
        const id = `c${index}`;
        const binding = bindings[index];
        registry.set(id, binding);
        return {
            ...candidate,
            id,
            regionId: idOf(regionIds, binding.region, "r"),
            scopeId: idOf(scopeIds, binding.scope, "p"),
        };
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
    for (const binding of registry.values())
        binding.selector = uniqueSelector(binding.node);
    return { snapshot, root, registry, url: location.href };
}

export function validateNode(state: Collected, binding: CandidateNode): void {
    if (
        state.url !== location.href ||
        binding.node.ownerDocument !== document ||
        !binding.node.isConnected ||
        !isVisible(binding.node) ||
        candidateText(binding) !== binding.text
    )
        throw new Error("stale: crossword target changed");
}

function identityOf(binding: CandidateNode) {
    return parseCrosswordClueIdentity(binding.text, binding.context);
}

function logicalClueText(binding: CandidateNode): string {
    return parseCrosswordClueIdentity(candidateText(binding), binding.context)
        .text;
}
