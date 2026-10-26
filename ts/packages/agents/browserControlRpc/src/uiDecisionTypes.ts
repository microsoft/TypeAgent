// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ShoppingMode = "generative" | "decision";

export function isShoppingMode(value: unknown): value is ShoppingMode {
    return value === "generative" || value === "decision";
}

export const UI_DECISION_LIMITS = {
    candidates: 253,
    frames: 16,
    nodes: 10000,
    text: 512,
    content: 30000,
    bytes: 256 * 1024,
    tokens: 24 * 1024,
    lifetimeMs: 30000,
    timeoutMs: 20000,
    snapshots: 16,
    batchCandidates: 32,
    batches: 8,
    requestBytes: 24 * 1024,
} as const;

export type UiCapability = "activate" | "fill" | "select";
export type UiFrameScope = "all-frames" | "main-document";
export type UiCandidate = {
    id: string;
    name: string;
    role: string;
    context: string;
    capabilities: UiCapability[];
    disabled: boolean;
    checked?: boolean;
    expanded?: boolean;
    selectedOptionId?: string;
    options?: { id: string; text: string; disabled: boolean }[];
};

export type UiObservation = {
    snapshotId: string;
    url: string;
    createdAt: number;
    complete: true;
    frameScope?: UiFrameScope;
    candidates: UiCandidate[];
    content: string;
};

export type UiSelectionRequest = {
    condition: string;
    capability: UiCapability;
    frameScope?: UiFrameScope;
};

export function assertUiFrameScope(
    value: unknown,
): asserts value is UiFrameScope {
    if (value !== "all-frames" && value !== "main-document")
        throw new Error("invalid_request: unsupported grounded UI frame scope");
}

export type UiTarget = {
    targetId: string;
    name: string;
    role: string;
    options?: { id: string; text: string; disabled: boolean }[];
};

export type UiAction =
    | { type: "activate" }
    | { type: "fill"; text: string; submit?: boolean }
    | { type: "select"; optionId: string };

export type UiActionResult = {
    dispatched: true;
    valueVerified?: true;
};

export type UiConditionResult = {
    status: "matched" | "not_matched" | "insufficient_evidence";
    explanation: string;
};

export type UiFrameRequest =
    | { method: "capture" }
    | { method: "validate"; snapshotId: string }
    | {
          method: "execute";
          snapshotId: string;
          candidateId: string;
          action: UiAction;
      };

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): value is string {
    return typeof value === "string" && value.length <= max;
}

function assertUiOptions(value: unknown): void {
    if (!Array.isArray(value) || value.length > UI_DECISION_LIMITS.candidates)
        throw new Error("unsupported: invalid UI options");
    const ids = new Set<string>();
    for (const option of value) {
        if (
            !record(option) ||
            !boundedText(option.id, 64) ||
            !option.id ||
            ids.has(option.id) ||
            !boundedText(option.text, UI_DECISION_LIMITS.text) ||
            typeof option.disabled !== "boolean"
        )
            throw new Error("unsupported: invalid UI option");
        ids.add(option.id);
    }
}

function assertUiCandidate(
    candidate: unknown,
    ids: Set<string>,
): asserts candidate is UiCandidate {
    if (
        !record(candidate) ||
        !boundedText(candidate.id, 64) ||
        !candidate.id ||
        ids.has(candidate.id) ||
        ["no_fit", "ambiguous"].includes(candidate.id) ||
        !boundedText(candidate.name, UI_DECISION_LIMITS.text) ||
        !boundedText(candidate.context, UI_DECISION_LIMITS.text) ||
        !boundedText(candidate.role, 64) ||
        typeof candidate.disabled !== "boolean" ||
        (candidate.checked !== undefined &&
            typeof candidate.checked !== "boolean") ||
        (candidate.expanded !== undefined &&
            typeof candidate.expanded !== "boolean") ||
        (candidate.selectedOptionId !== undefined &&
            !boundedText(candidate.selectedOptionId, 64)) ||
        !Array.isArray(candidate.capabilities) ||
        !candidate.capabilities.length ||
        candidate.capabilities.some(
            (capability) =>
                !["activate", "fill", "select"].includes(capability),
        ) ||
        new Set(candidate.capabilities).size !== candidate.capabilities.length
    )
        throw new Error("unsupported: invalid UI candidate");
    ids.add(candidate.id);
    if (candidate.options !== undefined) assertUiOptions(candidate.options);
}

export function assertUiObservation(
    value: unknown,
): asserts value is UiObservation {
    if (
        !record(value) ||
        !boundedText(value.snapshotId, 256) ||
        !value.snapshotId ||
        !boundedText(value.url, 8192) ||
        !/^https?:\/\//.test(value.url) ||
        !Number.isSafeInteger(value.createdAt) ||
        value.complete !== true ||
        !boundedText(value.content, UI_DECISION_LIMITS.content) ||
        !Array.isArray(value.candidates) ||
        value.candidates.length > UI_DECISION_LIMITS.candidates
    )
        throw new Error("unsupported: invalid UI observation");
    if (value.frameScope !== undefined) assertUiFrameScope(value.frameScope);
    const ids = new Set<string>();
    for (const candidate of value.candidates) {
        assertUiCandidate(candidate, ids);
    }
    if (
        new TextEncoder().encode(JSON.stringify(value)).length >
        UI_DECISION_LIMITS.bytes
    )
        throw new Error("unsupported: UI observation exceeds byte bound");
}

export function assertUiAction(value: unknown): asserts value is UiAction {
    if (!record(value))
        throw new Error("unsupported: invalid grounded UI action");
    const keys =
        value.type === "activate"
            ? ["type"]
            : value.type === "fill"
              ? ["type", "text", "submit"]
              : value.type === "select"
                ? ["type", "optionId"]
                : [];
    if (
        !keys.length ||
        Object.keys(value).some((key) => !keys.includes(key)) ||
        (value.type === "fill" &&
            (!boundedText(value.text, 1024) ||
                (value.submit !== undefined &&
                    typeof value.submit !== "boolean"))) ||
        (value.type === "select" &&
            (!boundedText(value.optionId, 64) || !value.optionId))
    )
        throw new Error("unsupported: invalid grounded UI action");
}
