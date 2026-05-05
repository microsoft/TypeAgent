// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HelperClient } from "./helperClient.js";
import type {
    ControlMatcher,
    DynamicControlRule,
    DynamicControlsFile,
    DynamicProperty,
    TreeNode,
} from "./types.js";

/**
 * Run a calibration pass: take N tree dumps with delays between them,
 * compare for value/name drift, and emit per-element rules with
 * `reason: "calibration-drift"`.
 *
 * The app should be in a stable, observable state — no agent or user input
 * during calibration. Anything that changes value/name is presumed dynamic.
 */
export async function calibrateDynamicControls(opts: {
    client: HelperClient;
    rootSelector: string;
    integrationName: string;
    dumpCount?: number;
    delayMs?: number;
    maxDepth?: number;
}): Promise<DynamicControlsFile> {
    const dumpCount = opts.dumpCount ?? 3;
    const delayMs = opts.delayMs ?? 3000;
    const maxDepth = opts.maxDepth ?? 8;
    const startedAt = Date.now();

    const dumps: TreeNode[] = [];
    for (let i = 0; i < dumpCount; i++) {
        if (i > 0) {
            await sleep(delayMs);
        }
        dumps.push(
            await opts.client.treeDump({
                root: opts.rootSelector,
                maxDepth,
            }),
        );
    }

    const rules = diffDumpsToRules(dumps);
    const now = new Date().toISOString();
    for (const r of rules) {
        r.firstSeen = now;
        r.lastConfirmed = now;
    }

    return {
        version: 1,
        integrationName: opts.integrationName,
        calibration: {
            lastRun: now,
            durationMs: Date.now() - startedAt,
            dumpsCompared: dumps.length,
        },
        rules,
    };
}

/**
 * Index a tree by selector for cross-dump comparison.
 */
function indexBySelector(node: TreeNode, out: Map<string, TreeNode>): void {
    out.set(node.selector, node);
    for (const c of node.children) {
        indexBySelector(c, out);
    }
}

function diffDumpsToRules(dumps: TreeNode[]): DynamicControlRule[] {
    if (dumps.length < 2) {
        return [];
    }

    const indexed: Map<string, TreeNode>[] = dumps.map((d) => {
        const m = new Map<string, TreeNode>();
        indexBySelector(d, m);
        return m;
    });

    // Find selectors present in ALL dumps.
    const common: string[] = [];
    for (const sel of indexed[0]!.keys()) {
        if (indexed.every((m) => m.has(sel))) {
            common.push(sel);
        }
    }

    const rules: DynamicControlRule[] = [];
    let id = 1;
    for (const sel of common) {
        const nodes = indexed.map((m) => m.get(sel)!);
        const dynProps = detectDynamicProperties(nodes);
        if (dynProps.length === 0) {
            continue;
        }
        const exemplar = nodes[0]!;
        const matcher = chooseMatcher(exemplar);
        const transitions = countTransitions(nodes, dynProps);
        rules.push({
            id: `cal-${id++}`,
            match: matcher,
            dynamicProperties: dynProps,
            ...(deriveSemantic(exemplar) !== undefined
                ? { semantic: deriveSemantic(exemplar) as string }
                : {}),
            reason: "calibration-drift",
            confidence: Math.min(1, transitions / (dumps.length - 1)),
            observations: transitions,
            firstSeen: "",
            lastConfirmed: "",
        });
    }
    return rules;
}

function detectDynamicProperties(nodes: TreeNode[]): DynamicProperty[] {
    const props: DynamicProperty[] = [];
    if (
        nodes.some(
            (n, i) => i > 0 && (nodes[i - 1]!.value ?? "") !== (n.value ?? ""),
        )
    ) {
        props.push("value");
    }
    if (
        nodes.some(
            (n, i) => i > 0 && (nodes[i - 1]!.name ?? "") !== (n.name ?? ""),
        )
    ) {
        props.push("name");
    }
    if (
        nodes.some(
            (n, i) =>
                i > 0 &&
                (nodes[i - 1]!.toggleState ?? "") !== (n.toggleState ?? ""),
        )
    ) {
        props.push("toggleState");
    }
    return props;
}

function countTransitions(nodes: TreeNode[], props: DynamicProperty[]): number {
    let transitions = 0;
    for (let i = 1; i < nodes.length; i++) {
        for (const p of props) {
            if (
                (getProp(nodes[i - 1]!, p) ?? "") !==
                (getProp(nodes[i]!, p) ?? "")
            ) {
                transitions++;
                break;
            }
        }
    }
    return transitions;
}

function getProp(n: TreeNode, p: DynamicProperty): string | undefined {
    return p === "value" ? n.value : p === "name" ? n.name : n.toggleState;
}

function chooseMatcher(n: TreeNode): ControlMatcher {
    if (n.automationId) {
        return { kind: "automationId", value: n.automationId };
    }
    return { kind: "selector", value: n.selector };
}

function deriveSemantic(n: TreeNode): string | undefined {
    if (n.automationId) {
        return n.automationId;
    }
    if (n.name) {
        return n.name.length > 40 ? n.name.slice(0, 40) : n.name;
    }
    return undefined;
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

/* persistence */

export function loadDynamicControls(
    workspaceDir: string,
): DynamicControlsFile | null {
    const file = path.join(workspaceDir, "dynamicControls.json");
    if (!existsSync(file)) {
        return null;
    }
    return JSON.parse(readFileSync(file, "utf8")) as DynamicControlsFile;
}

export function saveDynamicControls(
    workspaceDir: string,
    file: DynamicControlsFile,
): void {
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
        path.join(workspaceDir, "dynamicControls.json"),
        JSON.stringify(file, null, 2),
    );
}

/**
 * Merge new rules into an existing file, deduping by matcher equivalence.
 * Bumps observations/lastConfirmed on hits.
 */
export function mergeDynamicControls(
    base: DynamicControlsFile,
    incoming: DynamicControlRule[],
): DynamicControlsFile {
    const now = new Date().toISOString();
    const mergedRules: DynamicControlRule[] = [...base.rules];
    for (const inc of incoming) {
        const existing = mergedRules.find((r) =>
            sameMatcher(r.match, inc.match),
        );
        if (existing) {
            existing.observations += inc.observations;
            existing.lastConfirmed = now;
            for (const p of inc.dynamicProperties) {
                if (!existing.dynamicProperties.includes(p)) {
                    existing.dynamicProperties.push(p);
                }
            }
        } else {
            mergedRules.push({ ...inc, lastConfirmed: now });
        }
    }
    return { ...base, rules: mergedRules };
}

function sameMatcher(a: ControlMatcher, b: ControlMatcher): boolean {
    if (a.kind !== b.kind) {
        return false;
    }
    switch (a.kind) {
        case "automationId":
            return a.value === (b as typeof a).value;
        case "selector":
            return a.value === (b as typeof a).value;
        case "selectorPattern":
            return a.pattern === (b as typeof a).pattern;
        case "container": {
            const cb = b as typeof a;
            return (
                a.container === cb.container &&
                a.controlType === cb.controlType &&
                (a.nameRegex ?? "") === (cb.nameRegex ?? "") &&
                (a.classNameRegex ?? "") === (cb.classNameRegex ?? "")
            );
        }
    }
}
