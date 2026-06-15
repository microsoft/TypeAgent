// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "@typeagent/aiclient";
import { loadSchema } from "typeagent";
import {
    createJsonTranslator,
    MultimodalPromptContent,
    TypeChatJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { getReconModel } from "../lib/llm.js";
import type { HelperClient } from "./helperClient.js";
import type { ExpectedAction, TabRecon } from "./reconLlmSchema.js";
import type { TreeNode } from "./types.js";

export type TabRef = {
    selector: string;
    name: string;
    automationId?: string;
};

export type AppReconnaissance = {
    appHint: string;
    tabs: TabRef[];
    surveys: Array<{ tab: TabRef; recon: TabRecon }>;
    /** Flattened expected-actions list across all tabs, ready to feed into a crawl goal. */
    expectedActions: Array<ExpectedAction & { tabHint: string }>;
};

export type ReconnoiterOptions = {
    client: HelperClient;
    rootSelector: string;
    appHint: string;
    model?: ChatModel;
    /** Optional: max tabs to survey. */
    maxTabs?: number;
    /** Wait after navigating to a tab before capturing. Defaults to 1500ms (UWP NavView is slow). */
    perTabSettleMs?: number;
};

/**
 * Walk the app's main window, find tab-like navigation (ListItems with
 * SelectionItem pattern under a NavView/Group container), navigate to
 * each, screenshot + dump the tree, and ask a vision-capable LLM to
 * describe each tab's purpose and plausible user actions.
 *
 * The output (`expectedActions`) is meant to be fed into the explore
 * loop's goal as a TODO list — concrete tasks the explorer should drive
 * the app through, instead of generic "explore breadth" guidance.
 */
export async function reconnoiterApp(
    opts: ReconnoiterOptions,
): Promise<AppReconnaissance> {
    const model = opts.model ?? getReconModel();
    const settleMs = opts.perTabSettleMs ?? 1500;

    // 1. Discover tabs.
    const initialTree = await opts.client.treeDump({
        root: opts.rootSelector,
        maxDepth: 10,
    });
    let tabs = discoverTabs(initialTree);
    if (opts.maxTabs && tabs.length > opts.maxTabs) {
        tabs = tabs.slice(0, opts.maxTabs);
    }

    // 2. Survey each.
    const surveys: Array<{ tab: TabRef; recon: TabRecon }> = [];
    for (const tab of tabs) {
        try {
            await opts.client.doSelect({ selector: tab.selector });
        } catch {
            // Some tabs may be unselectable (already-selected, gated, etc.) — skip.
            continue;
        }
        await sleep(settleMs);
        try {
            await opts.client.eventsIdle({
                debounceMs: 600,
                maxWaitMs: 4000,
            });
        } catch {
            /* idle failures are non-fatal */
        }
        const tree = await opts.client.treeDump({
            root: opts.rootSelector,
            maxDepth: 8,
        });
        const shot = await opts.client.screenshot({
            root: opts.rootSelector,
        });
        const recon = await classifyTab(
            model,
            tab,
            tree,
            shot.pngBase64,
            opts.appHint,
        );
        if (recon) {
            surveys.push({ tab, recon });
        }
    }

    // 3. Flatten the expected actions list.
    const expectedActions: AppReconnaissance["expectedActions"] = [];
    for (const s of surveys) {
        for (const ea of s.recon.expectedActions) {
            expectedActions.push({ ...ea, tabHint: s.tab.name });
        }
    }
    return { appHint: opts.appHint, tabs, surveys, expectedActions };
}

/**
 * Heuristic tab discovery: find the largest cluster of sibling ListItems
 * that all expose SelectionItem pattern. That's the navigation strip.
 */
function discoverTabs(root: TreeNode): TabRef[] {
    let bestParent: TreeNode | null = null;
    let bestItems: TreeNode[] = [];

    function walk(n: TreeNode): void {
        const items = n.children.filter(
            (c) =>
                c.controlType === "ListItem" &&
                c.patterns.includes("SelectionItem") &&
                c.isEnabled,
        );
        if (items.length >= 2 && items.length > bestItems.length) {
            bestParent = n;
            bestItems = items;
        }
        for (const c of n.children) walk(c);
    }
    walk(root);
    void bestParent; // for debug if needed

    return bestItems
        .filter((i) => i.name && i.name.length > 0)
        .map((i) => {
            const ref: TabRef = {
                selector: i.selector,
                name: i.name!,
            };
            if (i.automationId !== undefined) ref.automationId = i.automationId;
            return ref;
        });
}

async function classifyTab(
    model: ChatModel,
    tab: TabRef,
    tree: TreeNode,
    screenshotPngBase64: string,
    appHint: string,
): Promise<TabRecon | null> {
    const translator = makeReconTranslator(model);
    const text = buildReconPrompt(tab, tree, appHint);
    const dataUrl = `data:image/png;base64,${screenshotPngBase64}`;
    const imageOnlyContent: MultimodalPromptContent[] = [
        { type: "text", text: `Screenshot of the '${tab.name}' tab:` },
        {
            type: "image_url",
            image_url: { url: dataUrl },
        } as MultimodalPromptContent,
    ];
    const result = await translator.translate(text, [
        { role: "user", content: imageOnlyContent },
    ]);
    if (!result.success) {
        process.stderr.write(
            `[recon] tab '${tab.name}' translation failed: ${result.message}\n`,
        );
        return null;
    }
    return result.data;
}

function buildReconPrompt(
    tab: TabRef,
    tree: TreeNode,
    appHint: string,
): string {
    const lines: string[] = [];
    lines.push(
        `You are reviewing a screenshot and accessibility tree for ONE tab of a Windows desktop application to enumerate the user-facing actions it supports.`,
    );
    lines.push("");
    lines.push(`App: ${appHint}`);
    lines.push(
        `Tab: '${tab.name}'${tab.automationId ? ` (AutomationId=${tab.automationId})` : ""}`,
    );
    lines.push("");
    lines.push(
        "Identify what this tab is FOR (its purpose) and list the user-meaningful actions it supports. For each action:",
    );
    lines.push(
        "- Use a camelCase verb-noun name (createAlarm, startStopwatch, addCity, recordLap, navigateToTab, etc.).",
    );
    lines.push("- Describe what the user accomplishes.");
    lines.push(
        "- List parameters with types and a plausible EXAMPLE value (your best guess from the visible UI).",
    );
    lines.push(
        "- Mark priority='primary' for the tab's main intent(s); priority='secondary' for adjacent features (settings, sign-in, music, etc.).",
    );
    lines.push(
        "- destructive=true for delete/remove/reset/clear actions, else false.",
    );
    lines.push("");
    lines.push(
        "Be aspirational: include actions that the screenshot/tree implies are possible even if you can't see them executed (e.g. if there's an 'Add' button visible, the action 'createX' is implied).",
    );
    lines.push("");
    lines.push("Filtered actionable controls (from UIA tree):");
    lines.push(summarizeActionableControls(tree));
    lines.push("");
    lines.push("Return a TabRecon.");
    return lines.join("\n");
}

function summarizeActionableControls(root: TreeNode): string {
    const lines: string[] = [];
    function walk(n: TreeNode, depth: number): void {
        if (
            n.patterns.length > 0 &&
            n.isEnabled &&
            !n.isOffscreen &&
            (n.name || n.automationId)
        ) {
            const label = n.name ?? n.automationId ?? "";
            lines.push(
                `${"  ".repeat(depth)}${n.controlType} '${truncate(label, 50)}' [${n.patterns.join(",")}]`,
            );
        }
        for (const c of n.children) walk(c, depth + 1);
    }
    walk(root, 0);
    return lines.slice(0, 60).join("\n");
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function makeReconTranslator(
    model: ChatModel,
): TypeChatJsonTranslator<TabRecon> {
    const schema = loadSchema(["reconLlmSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<TabRecon>(
        schema,
        "TabRecon",
    );
    return createJsonTranslator<TabRecon>(model, validator);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

/**
 * Render an AppReconnaissance into a numbered TODO list suitable for use
 * as the explore loop's goal. Includes example invocations so the LLM
 * oracle has concrete targets.
 */
export function renderReconAsGoal(recon: AppReconnaissance): string {
    const lines: string[] = [];
    lines.push(
        `Drive ${recon.appHint} through these specific user actions, working through them in order. Each takes multiple UI steps (open dialog, fill fields, click commit). Skip and move on if a task gets stuck. Avoid destructive actions unless explicitly listed.`,
    );
    lines.push("");
    let i = 1;
    for (const a of recon.expectedActions) {
        const params = a.parameters
            .map((p) => `${p.name}=${JSON.stringify(p.example)}`)
            .join(", ");
        const dest = a.destructive ? " [DESTRUCTIVE — skip]" : "";
        lines.push(
            `${i}. ${a.intentName}(${params}) on the ${a.tabHint} tab — ${a.description}${dest}`,
        );
        i++;
    }
    lines.push("");
    lines.push(
        "After each action, observe the result and move to the next item. If you've completed all of these, choose 'stop'.",
    );
    return lines.join("\n");
}
