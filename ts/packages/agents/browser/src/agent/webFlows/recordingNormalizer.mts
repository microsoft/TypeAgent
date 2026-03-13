// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    BrowserReasoningTrace,
    BrowserTraceStep,
} from "./reasoning/browserReasoningTypes.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:normalizer");

/**
 * Raw recorded action from the browser extension content script.
 * Matches the RecordedAction interface in extension/contentScript/types.ts.
 */
export interface RecordedAction {
    id: number;
    type: string;
    tag?: string;
    text?: string;
    value?: string;
    cssSelector?: string;
    boundingBox?: { top: number; left: number; bottom: number };
    timestamp: number;
    htmlIndex: number;
    scrollX?: number;
    scrollY?: number;
    url?: string;
}

export interface RecordingData {
    actions: RecordedAction[];
    pageHtml?: string[];
    screenshots?: string[];
    startUrl: string;
    description?: string;
}

/**
 * Converts raw RecordedAction[] from the browser extension into a
 * BrowserReasoningTrace, so a single Script Generator handles both
 * goal-driven and recording modes.
 *
 * The normalizer:
 * 1. Filters noise (redundant scrolls, duplicate clicks)
 * 2. Maps extension action types to WebFlowBrowserAPI tool names
 * 3. Merges consecutive text inputs into single enterText steps
 * 4. Adds element context (tag, text, selector) to each step
 */
export function normalizeRecording(
    data: RecordingData,
): BrowserReasoningTrace {
    const steps: BrowserTraceStep[] = [];
    const filtered = filterActions(data.actions);

    let stepNumber = 0;
    for (const action of filtered) {
        stepNumber++;
        const step = convertAction(action, stepNumber, data);
        if (step) {
            steps.push(step);
        }
    }

    debug(`Normalized ${data.actions.length} raw actions → ${steps.length} steps`);

    return {
        goal: data.description ?? "Recorded user interaction",
        startUrl: data.startUrl,
        steps,
        result: {
            success: steps.length > 0,
            summary: `Recorded ${steps.length} steps`,
        },
        duration: steps.length > 0
            ? steps[steps.length - 1].timestamp - steps[0].timestamp
            : 0,
    };
}

function filterActions(actions: RecordedAction[]): RecordedAction[] {
    const result: RecordedAction[] = [];

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];

        // Skip redundant scroll events (keep only the last in a sequence)
        if (action.type === "scroll") {
            const next = actions[i + 1];
            if (next?.type === "scroll") continue;
        }

        // Skip empty text inputs
        if (
            (action.type === "textInput" || action.type === "input") &&
            !action.value?.trim()
        ) {
            continue;
        }

        // Merge consecutive textInput on same selector into one
        if (action.type === "textInput" && result.length > 0) {
            const prev = result[result.length - 1];
            if (
                prev.type === "textInput" &&
                prev.cssSelector === action.cssSelector
            ) {
                if (action.value !== undefined) {
                    prev.value = action.value;
                }
                prev.timestamp = action.timestamp;
                continue;
            }
        }

        result.push(action);
    }

    return result;
}

function convertAction(
    action: RecordedAction,
    stepNumber: number,
    data: RecordingData,
): BrowserTraceStep | null {
    switch (action.type) {
        case "click":
            return {
                stepNumber,
                thinking: `Click on ${action.tag ?? "element"}: "${action.text ?? action.cssSelector ?? "unknown"}"`,
                action: {
                    tool: "click",
                    args: {
                        selector: action.cssSelector ?? "",
                        ...(action.text && { elementText: action.text }),
                        ...(action.tag && { tagName: action.tag }),
                    },
                },
                result: { success: true },
                timestamp: action.timestamp,
            };

        case "input":
        case "textInput":
            return {
                stepNumber,
                thinking: `Enter text "${action.value}" into ${action.tag ?? "input"}`,
                action: {
                    tool: "enterText",
                    args: {
                        selector: action.cssSelector ?? "",
                        text: action.value ?? "",
                        ...(action.tag && { tagName: action.tag }),
                    },
                },
                result: { success: true },
                timestamp: action.timestamp,
            };

        case "pageLevelTextInput":
            return {
                stepNumber,
                thinking: `Enter text at page level: "${action.value}"`,
                action: {
                    tool: "enterText",
                    args: {
                        selector: "body",
                        text: action.value ?? "",
                    },
                },
                result: { success: true },
                timestamp: action.timestamp,
            };

        case "navigation":
            return {
                stepNumber,
                thinking: `Navigate to ${action.url}`,
                action: {
                    tool: "navigateTo",
                    args: { url: action.url ?? "" },
                },
                result: {
                    success: true,
                    ...(action.url && { pageUrl: action.url }),
                },
                timestamp: action.timestamp,
            };

        case "scroll":
            // Scrolls are context but not directly mapped to a browser tool
            // Include for trace completeness but mark as informational
            return {
                stepNumber,
                thinking: `Scroll to position (${action.scrollX}, ${action.scrollY})`,
                action: {
                    tool: "scroll",
                    args: {
                        scrollX: action.scrollX ?? 0,
                        scrollY: action.scrollY ?? 0,
                    },
                },
                result: { success: true },
                timestamp: action.timestamp,
            };

        default:
            debug(`Unknown action type: ${action.type}`);
            return null;
    }
}
