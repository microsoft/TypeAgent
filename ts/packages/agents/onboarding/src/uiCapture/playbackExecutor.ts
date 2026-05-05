// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { HelperClient } from "./helperClient.js";
import type { PlaybackStep, SynthesizedAction } from "./synthesisLlmSchema.js";

export type PlaybackParams = Record<string, string | number | boolean>;

export type PlaybackStepResult = {
    stepIndex: number;
    selector: string;
    verb: string;
    value?: string | number | boolean;
    success: boolean;
    errorMessage?: string;
    durationMs: number;
};

export type PlaybackResult = {
    actionName: string;
    success: boolean;
    steps: PlaybackStepResult[];
    failedAtStep?: number;
};

export type PlaybackExecutorOptions = {
    client: HelperClient;
    /** Wait between steps that don't have waitForIdle set explicitly. */
    defaultIdleDebounceMs?: number;
    defaultIdleMaxWaitMs?: number;
    /** Stop on first failed step. Default true. */
    stopOnError?: boolean;
};

/**
 * Replay a synthesized action against the helper.
 *
 * Resolves `valueRef` references against the supplied `params` map. For each
 * step, dispatches the verb to the appropriate `do.*` RPC. Optionally waits
 * for UIA idle between steps.
 */
export async function executePlayback(
    action: SynthesizedAction,
    params: PlaybackParams,
    opts: PlaybackExecutorOptions,
): Promise<PlaybackResult> {
    const stopOnError = opts.stopOnError ?? true;
    const debounceMs = opts.defaultIdleDebounceMs ?? 600;
    const maxWaitMs = opts.defaultIdleMaxWaitMs ?? 4000;
    const stepResults: PlaybackStepResult[] = [];
    let success = true;
    let failedAtStep: number | undefined;

    for (let i = 0; i < action.playback.length; i++) {
        const step = action.playback[i]!;
        const value = resolveValue(step, params);
        const start = Date.now();
        let stepSuccess = true;
        let errorMessage: string | undefined;

        try {
            await executeStep(opts.client, step, value);
        } catch (e) {
            stepSuccess = false;
            errorMessage = e instanceof Error ? e.message : String(e);
        }

        const stepResult: PlaybackStepResult = {
            stepIndex: i,
            selector: step.selector,
            verb: step.verb,
            ...(value !== undefined ? { value } : {}),
            success: stepSuccess,
            ...(errorMessage !== undefined ? { errorMessage } : {}),
            durationMs: Date.now() - start,
        };
        stepResults.push(stepResult);

        if (!stepSuccess) {
            success = false;
            if (failedAtStep === undefined) failedAtStep = i;
            if (stopOnError) break;
        }

        // Wait for idle after this step unless explicitly disabled.
        const wait = step.waitForIdle ?? defaultWait(step.verb);
        if (wait) {
            try {
                await opts.client.eventsIdle({ debounceMs, maxWaitMs });
            } catch {
                /* idle is best-effort */
            }
        }
    }

    return {
        actionName: action.actionName,
        success,
        steps: stepResults,
        ...(failedAtStep !== undefined ? { failedAtStep } : {}),
    };
}

function defaultWait(verb: string): boolean {
    // Verbs that typically open/close dialogs or transition panels need an idle wait.
    return verb === "invoke" || verb === "select";
}

function resolveValue(
    step: PlaybackStep,
    params: PlaybackParams,
): string | number | boolean | undefined {
    if (step.valueRef !== undefined) {
        // Accept either "${name}" or bare "name".
        const m = step.valueRef.match(/^\$\{(.+)\}$/);
        const key = m ? m[1]! : step.valueRef;
        const v = params[key];
        if (v === undefined) {
            throw new Error(`Missing parameter '${key}' for valueRef`);
        }
        return v;
    }
    if (step.valueLiteral !== undefined) {
        return step.valueLiteral;
    }
    return undefined;
}

async function executeStep(
    client: HelperClient,
    step: PlaybackStep,
    value: string | number | boolean | undefined,
): Promise<void> {
    switch (step.verb) {
        case "invoke":
            await client.doInvoke({ selector: step.selector });
            break;
        case "click":
            await client.doClick({ selector: step.selector });
            break;
        case "focus":
            await client.doFocus({ selector: step.selector });
            break;
        case "toggle":
            await client.doToggle({
                selector: step.selector,
                ...(typeof value === "boolean" ? { value } : {}),
            });
            break;
        case "expand":
            await client.doExpand({
                selector: step.selector,
                expand: typeof value === "boolean" ? value : true,
            });
            break;
        case "select":
            await client.doSelect({
                selector: step.selector,
                ...(value !== undefined && typeof value !== "boolean"
                    ? { item: value as string | number }
                    : {}),
            });
            break;
        case "setValue":
            if (value === undefined) {
                throw new Error(`setValue step requires a value`);
            }
            await client.doSetValue({
                selector: step.selector,
                value,
            });
            break;
        case "scroll":
            await client.doScroll({
                selector: step.selector,
                direction: "down",
            });
            break;
        default:
            throw new Error(`Unsupported playback verb: ${step.verb}`);
    }
}
