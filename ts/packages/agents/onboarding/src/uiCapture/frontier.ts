// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { FrontierItem, FrontierVerb } from "./exploreTypes.js";
import type { Pattern, TreeNode } from "./types.js";

const DESTRUCTIVE_RE =
    /\b(delete|remove|reset|clear|erase|destroy|trash|discard)\b/i;

/**
 * Walk a tree dump and emit one FrontierItem per actionable element.
 * "Actionable" = supports a pattern that maps to one of our verbs AND
 * is enabled and on-screen.
 */
export function computeFrontier(root: TreeNode): FrontierItem[] {
    const items: FrontierItem[] = [];
    let counter = 1;
    walk(root, items, () => `F-${(counter++).toString().padStart(3, "0")}`);
    sortByPriority(items);
    return items;
}

function walk(node: TreeNode, out: FrontierItem[], nextId: () => string): void {
    if (node.isEnabled && !node.isOffscreen) {
        const verbs = verbsFor(node);
        if (verbs.length > 0) {
            const item: FrontierItem = {
                id: nextId(),
                selector: node.selector,
                controlType: node.controlType,
                verbs,
                destructiveHint: isDestructive(node),
                boundingRect: node.boundingRect,
            };
            if (node.name !== undefined) item.name = node.name;
            if (node.automationId !== undefined)
                item.automationId = node.automationId;
            if (node.className !== undefined) item.className = node.className;
            out.push(item);
        }
    }
    for (const c of node.children) {
        walk(c, out, nextId);
    }
}

function verbsFor(node: TreeNode): FrontierVerb[] {
    const verbs: FrontierVerb[] = [];
    const has = (p: Pattern) => node.patterns.includes(p);

    if (has("Invoke")) {
        verbs.push({ verb: "invoke", valueShape: "none" });
    }
    if (has("Toggle")) {
        verbs.push({ verb: "toggle", valueShape: "boolean" });
    }
    // SelectionItem first (the item itself can be selected) — overrides Selection container if both present.
    if (has("SelectionItem")) {
        verbs.push({ verb: "select", valueShape: "none" });
    } else if (has("Selection")) {
        verbs.push({ verb: "select", valueShape: "selection" });
    }
    if (has("ExpandCollapse")) {
        verbs.push({ verb: "expand", valueShape: "boolean" });
    }
    if (has("Value")) {
        verbs.push({ verb: "setValue", valueShape: "free-text" });
    }
    if (has("RangeValue") && !has("Value")) {
        verbs.push({ verb: "setValue", valueShape: "range" });
    }
    if (has("Scroll")) {
        verbs.push({ verb: "scroll", valueShape: "none" });
    }
    return verbs;
}

function isDestructive(node: TreeNode): boolean {
    const text = `${node.name ?? ""} ${node.automationId ?? ""}`;
    return DESTRUCTIVE_RE.test(text);
}

function sortByPriority(items: FrontierItem[]): void {
    items.sort((a, b) => priority(a) - priority(b));
}

function priority(item: FrontierItem): number {
    // Lower is better.
    let p = 0;
    if (item.destructiveHint) {
        p += 1000; // push destructive items to the back
    }
    // High-signal control types come first.
    const ct = item.controlType;
    if (ct === "Button" || ct === "MenuItem" || ct === "ListItem") {
        p += 0;
    } else if (ct === "Edit" || ct === "ComboBox" || ct === "CheckBox") {
        p += 10;
    } else {
        p += 50;
    }
    // Stable identifiers preferred.
    if (!item.automationId) {
        p += 5;
    }
    return p;
}
