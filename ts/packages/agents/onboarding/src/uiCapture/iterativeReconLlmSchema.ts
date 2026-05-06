// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeChat schema for the ITERATIVE recon loop. The vision LLM gets a
// screenshot + the actionable controls + the discoveries-so-far list at
// every step, and decides where to drill next or when to stop.
//
// Loaded as text by TypeChat — keep self-contained, no runtime imports.

/** Vision LLM's per-step output during iterative reconnaissance. */
export type IterativeReconStep = {
    /** Short label for the screen currently visible (e.g. "Alarm tab — list view",
     *  "Add alarm dialog", "Stopwatch tab — running"). Used in the recon log. */
    currentScreenLabel: string;
    /**
     * Actions OBSERVED on the current screen that are not already in the
     * `alreadyDiscovered` list. List EVERYTHING that's plausibly a user
     * action here — including secondary features, settings panels, etc.
     */
    newDiscoveries: ReconAction[];
    /** What to do next. */
    decision: ReconDecision;
};

/**
 * One of three next-step decisions: drill into a control, back out, or stop.
 */
export type ReconDecision =
    | {
          /** Always "click". Drill into / activate a control to see its effect. */
          kind: "click";
          /** Selector of the control to click. Must come from the actionable controls list shown in the input. */
          selector: string;
          /** "invoke" for buttons / menu items / etc; "select" for ListItems with SelectionItem pattern (tabs, list rows). */
          verb: "invoke" | "select";
          /** One sentence: what you expect to learn or see by clicking this. */
          rationale: string;
      }
    | {
          /**
           * Always "back". Use to dismiss a modal/dialog/popup and return to
           * the previous screen. PROVIDE a selector for a Cancel / Close /
           * Back / X button visible on the current screen.
           */
          kind: "back";
          /** Selector of a Cancel/Close/Back/X button visible on the current screen. Must be invokable. */
          cancelSelector: string;
          /** One sentence: why we're backing out (typically: "I've cataloged this dialog's fields"). */
          rationale: string;
      }
    | {
          /** Always "done". Use when you've cataloged enough — primary actions of all major sections. */
          kind: "done";
          /** One sentence: why exploration is complete. */
          rationale: string;
      };

/** A user action observed during reconnaissance (cataloged, not necessarily executed). */
export type ReconAction = {
    /** camelCase verb-noun: createAlarm, startStopwatch, addCity, dismissNotification, signIn, etc. */
    intentName: string;
    /** One-sentence user-facing description of the outcome. */
    description: string;
    /** Parameters the user supplies. */
    parameters: ReconParam[];
    /** Plain-English example invocation. */
    exampleInvocation: string;
    /** Which tab / section of the app this action lives in. */
    tabOrSection: string;
    /** Whether this is the main intent of its tab ("primary") or an adjacent feature ("secondary"). */
    priority: "primary" | "secondary";
    /** True for delete/remove/reset/clear actions. */
    destructive: boolean;
};

export type ReconParam = {
    name: string;
    type: "string" | "number" | "boolean" | "enum";
    enumValues?: string[];
    /** Plausible example value drawn from the visible UI (e.g., 7 for hour, "Wake up" for name). */
    example: string | number | boolean;
    description: string;
};
