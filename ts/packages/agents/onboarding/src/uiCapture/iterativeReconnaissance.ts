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
import type {
    IterativeReconStep,
    ReconAction,
} from "./iterativeReconLlmSchema.js";
import type { TreeNode } from "./types.js";

export type IterativeReconResult = {
    appHint: string;
    expectedActions: ReconAction[];
    iterationsUsed: number;
    /** History of currentScreenLabel values per turn, in order. */
    screenLog: string[];
    /** Reasons the LLM gave for each decision (debugging). */
    decisions: string[];
};

export type IterativeReconOptions = {
    client: HelperClient;
    rootSelector: string;
    appHint: string;
    model?: ChatModel;
    maxIterations?: number;
    /** Wait between actions; UWP NavView in particular is slow. */
    settleMs?: number;
};

/**
 * Multi-turn vision-driven catalog: the LLM looks at each screen, lists
 * actions visible from it, then picks the NEXT control to drill into (or
 * a Cancel button to back out, or "done" to stop). The reconner just
 * executes the LLM's decision and feeds the next screenshot back.
 *
 * Output is a deduped ReconAction[] suitable for feeding the explore
 * loop's goal as a TODO list.
 */
export async function iterativeReconnoiter(
    opts: IterativeReconOptions,
): Promise<IterativeReconResult> {
    const model = opts.model ?? getReconModel();
    const settleMs = opts.settleMs ?? 1000;
    const maxIterations = opts.maxIterations ?? 25;

    const discovered: ReconAction[] = [];
    const screenLog: string[] = [];
    const decisions: string[] = [];

    let iter = 0;
    for (; iter < maxIterations; iter++) {
        try {
            await opts.client.eventsIdle({
                debounceMs: 500,
                maxWaitMs: 3000,
            });
        } catch {
            /* idle is best-effort */
        }
        const tree = await opts.client.treeDump({
            root: opts.rootSelector,
            maxDepth: 8,
        });
        const screenshot = await opts.client.screenshot({
            root: opts.rootSelector,
        });

        const step = await askVisionStep(model, {
            screenshot: screenshot.pngBase64,
            tree,
            discovered,
            screenLog,
            appHint: opts.appHint,
            iteration: iter + 1,
            budget: maxIterations,
        });

        if (!step) {
            // Translation failed — record and try one more iteration with a recovery hint.
            decisions.push(
                "(LLM translation failed, attempting one more turn)",
            );
            continue;
        }

        screenLog.push(step.currentScreenLabel);
        decisions.push(`${step.decision.kind}: ${step.decision.rationale}`);

        // Merge discoveries (dedupe by intentName).
        for (const a of step.newDiscoveries) {
            if (!discovered.some((x) => x.intentName === a.intentName)) {
                discovered.push(a);
            }
        }

        process.stderr.write(
            `[recon] iter ${iter + 1}: '${step.currentScreenLabel}' — ` +
                `+${step.newDiscoveries.length} discoveries (total ${discovered.length}), ` +
                `next: ${step.decision.kind}\n`,
        );

        if (step.decision.kind === "done") {
            iter++; // count the final iteration
            break;
        }

        try {
            if (step.decision.kind === "click") {
                if (step.decision.verb === "select") {
                    await opts.client.doSelect({
                        selector: step.decision.selector,
                    });
                } else {
                    await opts.client.doInvoke({
                        selector: step.decision.selector,
                    });
                }
            } else if (step.decision.kind === "back") {
                await opts.client.doInvoke({
                    selector: step.decision.cancelSelector,
                });
            }
        } catch (e) {
            process.stderr.write(
                `[recon] iter ${iter + 1} action failed: ${e instanceof Error ? e.message : e}\n`,
            );
            // Continue — the next turn will see whatever state the app is in.
        }
        if (settleMs > 0) {
            await sleep(settleMs);
        }
    }

    return {
        appHint: opts.appHint,
        expectedActions: discovered,
        iterationsUsed: iter,
        screenLog,
        decisions,
    };
}

async function askVisionStep(
    model: ChatModel,
    args: {
        screenshot: string;
        tree: TreeNode;
        discovered: ReconAction[];
        screenLog: string[];
        appHint: string;
        iteration: number;
        budget: number;
    },
): Promise<IterativeReconStep | null> {
    const translator = makeIterativeReconTranslator(model);
    const text = buildIterativePrompt(args);
    const dataUrl = `data:image/png;base64,${args.screenshot}`;
    // Put the screenshot in promptHistory as a prior user message so the
    // model can see it. Pass the text prompt as `request` so TypeChat
    // appends its standard schema-aware instruction wrapper.
    const imageOnlyContent: MultimodalPromptContent[] = [
        {
            type: "text",
            text: "Screenshot of the app's current screen for the next request:",
        },
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
            `[recon] iter ${args.iteration} translation failed: ${result.message}\n`,
        );
        return null;
    }
    return result.data;
}

function buildIterativePrompt(args: {
    tree: TreeNode;
    discovered: ReconAction[];
    screenLog: string[];
    appHint: string;
    iteration: number;
    budget: number;
}): string {
    const lines: string[] = [];
    lines.push(
        "You are cataloging a Windows desktop application's user-facing actions by clicking through it screen by screen. At each step you decide what to drill into next.",
    );
    lines.push("");
    lines.push(`App: ${args.appHint}`);
    lines.push(`Iteration: ${args.iteration} of ${args.budget}. Be efficient.`);
    lines.push("");
    lines.push("Strategy:");
    lines.push(
        "- For each screen you visit, list the user actions IT supports (createAlarm, startStopwatch, etc.).",
    );
    lines.push(
        "- Drill into representative buttons to see what dialogs they open. Cataloging the FIELDS of a dialog (hour, minute, name, snooze...) means you don't actually have to commit it — back out via Cancel.",
    );
    lines.push(
        "- After a tab is cataloged, navigate to the next tab. Don't waste turns repeating yourself on a screen you've already covered.",
    );
    lines.push(
        "- Stop ('done') when you've cataloged the primary actions of every section the app offers — usually after visiting all top-level tabs and drilling into one creation flow per tab.",
    );
    lines.push(
        "- For 'back' decisions, you must specify a cancelSelector. Look for a Cancel / Close / X / Back button on the current screen.",
    );
    lines.push("");
    if (args.screenLog.length > 0) {
        lines.push(
            `Screens visited so far: ${args.screenLog.slice(-10).join(" → ")}`,
        );
        lines.push("");
    }
    if (args.discovered.length > 0) {
        lines.push(`Already discovered (${args.discovered.length} action(s)):`);
        for (const a of args.discovered) {
            const params = a.parameters.map((p) => p.name).join(", ");
            lines.push(
                `  - ${a.intentName}(${params}) [${a.tabOrSection}, ${a.priority}]`,
            );
        }
        lines.push("");
    }
    lines.push(
        "Actionable controls on the CURRENT screen (selector, type, name, patterns):",
    );
    lines.push(summarizeActionableControls(args.tree));
    lines.push("");
    lines.push("Return an IterativeReconStep.");
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
                `${"  ".repeat(depth)}${n.controlType} '${truncate(label, 50)}' [${n.patterns.join(",")}] sel=${n.selector}`,
            );
        }
        for (const c of n.children) walk(c, depth + 1);
    }
    walk(root, 0);
    // Limit but don't truncate selectors — the LLM needs them whole.
    return lines.slice(0, 80).join("\n");
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function makeIterativeReconTranslator(
    model: ChatModel,
): TypeChatJsonTranslator<IterativeReconStep> {
    const schema = loadSchema(["iterativeReconLlmSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<IterativeReconStep>(
        schema,
        "IterativeReconStep",
    );
    return createJsonTranslator<IterativeReconStep>(model, validator);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}

/**
 * Render iterative recon output as a goal string for the explore loop.
 */
export function renderIterativeReconAsGoal(
    recon: IterativeReconResult,
): string {
    const lines: string[] = [];
    lines.push(
        `Drive ${recon.appHint} through these specific user actions discovered during reconnaissance. Work through them in order; multi-step tasks (open dialog, fill fields, save) are normal. Skip and move on if a task gets stuck. Avoid actions marked DESTRUCTIVE.`,
    );
    lines.push("");
    let i = 1;
    for (const a of recon.expectedActions) {
        const params = a.parameters
            .map((p) => `${p.name}=${JSON.stringify(p.example)}`)
            .join(", ");
        const dest = a.destructive ? " [DESTRUCTIVE — skip]" : "";
        lines.push(
            `${i}. ${a.intentName}(${params}) on ${a.tabOrSection} — ${a.description}${dest}`,
        );
        i++;
    }
    lines.push("");
    lines.push(
        "After each action, observe the result and move to the next. If you've completed all of these, choose 'stop'.",
    );
    return lines.join("\n");
}
