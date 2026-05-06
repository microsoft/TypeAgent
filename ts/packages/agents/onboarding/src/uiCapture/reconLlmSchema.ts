// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeChat schema for vision-driven reconnaissance: the LLM looks at a
// screenshot of one tab/screen + its filtered control tree and produces
// a description of what the screen does, plus a list of plausible user
// actions it offers. Loaded as text by TypeChat — keep self-contained,
// no runtime imports.

/** Reconnaissance findings for one tab/screen of the app. */
export type TabRecon = {
    /** Short descriptive label for this tab/screen, e.g. "Alarm", "Stopwatch". */
    tabLabel: string;
    /** One-sentence summary of what this tab does. */
    purpose: string;
    /** User-facing actions the tab supports. List the PLAUSIBLE actions —
     *  things a user is likely to want to do here, regardless of whether
     *  the screenshot shows the action mid-execution. */
    expectedActions: ExpectedAction[];
    /** Optional: things that look interesting but you're unsure about
     *  (ambiguous controls, settings buttons whose effect isn't obvious). */
    uncertain?: string[];
};

export type ExpectedAction = {
    /** camelCase verb-noun, e.g. "createAlarm", "startStopwatch", "addCity". */
    intentName: string;
    /** One-sentence description of the user-facing outcome. */
    description: string;
    /** Parameters the user supplies. Empty array if the action takes none. */
    parameters: ExpectedParam[];
    /** Plain-English example invocation, e.g. "Create alarm 'Morning' at 7:00 AM". */
    exampleInvocation: string;
    /** "primary" = main reason for this tab; "secondary" = adjacent feature. */
    priority: "primary" | "secondary";
    /** Is this destructive (delete/clear/reset)? */
    destructive: boolean;
};

export type ExpectedParam = {
    /** camelCase, e.g. "name", "minutes", "city". */
    name: string;
    /** "string" | "number" | "boolean" | "enum". */
    type: "string" | "number" | "boolean" | "enum";
    /** When type is "enum", allowed values. */
    enumValues?: string[];
    /** Plausible example value (your best guess from the screenshot). */
    example: string | number | boolean;
    /** One short sentence describing what this parameter controls. */
    description: string;
};
