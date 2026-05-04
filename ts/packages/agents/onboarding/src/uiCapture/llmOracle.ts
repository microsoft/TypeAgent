// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { getExploreModel } from "../lib/llm.js";
import type {
    DecisionInput,
    DecisionOracle,
    ExploreDecision,
    FrontierItem,
} from "./exploreTypes.js";
import type { ExploreDecision as LlmExploreDecision } from "./exploreLlmSchema.js";

const SYSTEM_PROMPT = `You are exploring a Windows desktop application's UI to discover the user-facing actions it offers. Your goal is to drive the app via the controls on its current frontier and observe how the app's state changes.

Ground rules:
- Pick the action most likely to reveal a NEW state (one we haven't visited).
- Avoid destructive actions (delete/remove/reset/clear) unless the goal requires it.
- Avoid window-management actions (close, minimize, maximize, app-switch).
- Prefer Buttons/MenuItems/ListItems over scrollbars or text fields unless the goal targets them.
- If the same frontier has been picked over and explored without yielding new states, choose "stop" or "restore".
- expectedDelta should be a short prediction in plain English; we'll compare it against what actually happens.

Modal/popup handling:
- If the current state appears to be a modal dialog or popup (controls in a Popup/Dialog/Flyout container, an overlay, or a fixed-position card), recognize it.
- When a popup is in the way of your goal, dismiss it: look for Cancel / Close / "X" / Back buttons in the popup's controls, and click them.
- When a popup IS the goal (e.g., a "Save alarm" dialog where you've set fields), commit it via Save / OK / Confirm rather than Cancel.
- Don't get stuck repeating the same setValue on a control that didn't change state — try a sibling control, or dismiss and re-approach.`;

export type LlmOracleOptions = {
    goal: string;
    model?: ChatModel;
    /**
     * Maximum number of consecutive translation failures before giving up
     * with a "stop" decision.
     */
    maxRetries?: number;
};

export class LlmOracle implements DecisionOracle {
    private readonly translator: TypeChatJsonTranslator<LlmExploreDecision>;
    private readonly goal: string;
    private readonly maxRetries: number;
    private consecutiveFailures = 0;

    constructor(opts: LlmOracleOptions) {
        this.goal = opts.goal;
        this.maxRetries = opts.maxRetries ?? 2;
        const model = opts.model ?? getExploreModel();
        const schema = loadSchema(["exploreLlmSchema.ts"], import.meta.url);
        const validator = createTypeScriptJsonValidator<LlmExploreDecision>(
            schema,
            "ExploreDecision",
        );
        this.translator = createJsonTranslator<LlmExploreDecision>(
            model,
            validator,
        );
    }

    async decide(input: DecisionInput): Promise<ExploreDecision> {
        const prompt = this.buildPrompt(input);
        const result = await this.translator.translate(prompt);
        if (!result.success) {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= this.maxRetries) {
                return {
                    kind: "stop",
                    reason: `LLM oracle: ${this.consecutiveFailures} consecutive translation failures (last: ${result.message})`,
                };
            }
            // Soft fallback: pick the first non-destructive frontier item.
            const fallback = input.frontier.find(
                (f) => !f.destructiveHint && f.verbs.length > 0,
            );
            if (!fallback) {
                return {
                    kind: "stop",
                    reason: `LLM translation failed and no fallback available: ${result.message}`,
                };
            }
            const verb = fallback.verbs[0]!.verb;
            return {
                kind: "act",
                frontierId: fallback.id,
                verb,
                expectedDelta: "(fallback after LLM failure)",
                rationale: `fallback: ${result.message}`,
            };
        }
        this.consecutiveFailures = 0;
        return result.data as ExploreDecision;
    }

    private buildPrompt(input: DecisionInput): string {
        const lines: string[] = [];
        lines.push(SYSTEM_PROMPT);
        lines.push("");
        lines.push(`Goal: ${this.goal}`);
        lines.push("");
        lines.push(
            `Iteration: ${input.iteration} (remaining: ${input.budget.remainingIterations}; budget ${input.budget.remainingMs}ms)`,
        );
        lines.push(
            `Active state: ${input.state.id} '${input.state.windowTitle}'`,
        );
        lines.push(
            `Visited states: ${input.visitedStates.length} (ids: ${input.visitedStates
                .slice(-8)
                .map((s) => s.id)
                .join(", ")})`,
        );
        lines.push("");
        lines.push("Frontier:");
        if (input.frontier.length === 0) {
            lines.push("  (empty — no actionable controls in this state)");
        } else {
            for (const f of input.frontier.slice(0, 60)) {
                lines.push("  " + renderFrontierItem(f));
            }
            if (input.frontier.length > 60) {
                lines.push(`  ... and ${input.frontier.length - 60} more`);
            }
        }
        lines.push("");
        if (input.recentTransitions.length > 0) {
            lines.push("Recent actions:");
            for (const t of input.recentTransitions) {
                const arrow = t.success ? "→" : "✗";
                const noChange = t.fromStateId === t.toStateId ? " (no change)" : "";
                lines.push(
                    `  iter ${t.iteration}: ${t.fromStateId} ${arrow} ${t.trigger.verb} ${t.trigger.selector.split("/").pop()} → ${t.toStateId}${noChange}`,
                );
            }
            lines.push("");
        }
        lines.push(
            "Decide your next action. Output strictly matches the ExploreDecision schema.",
        );
        return lines.join("\n");
    }
}

function renderFrontierItem(f: FrontierItem): string {
    const id = `[${f.id}]`;
    const ct = f.controlType;
    const label = f.name ?? f.automationId ?? f.className ?? "";
    const aid = f.automationId ? ` aid=${f.automationId}` : "";
    const verbs = f.verbs.map((v) => v.verb).join(",");
    const dest = f.destructiveHint ? " (destructive!)" : "";
    return `${id} ${ct} '${truncate(label, 40)}'${aid} verbs:${verbs}${dest}`;
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
