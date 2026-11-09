// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    UI_DECISION_LIMITS as limits,
    assertUiAction,
    assertUiObservation,
    assertUiFrameScope,
    type UiAction,
    type UiActionResult,
    type UiFrameRequest,
    type UiObservation,
    type UiFrameScope,
} from "@typeagent/browser-control-rpc/uiDecisionTypes";

type Frame = { frameId: number; documentId: string; url: string };
type Inventory = { frame: Frame; observation: UiObservation };
type Captured = {
    tabId: number;
    frames: Inventory[];
    observation: UiObservation;
    owners: Map<string, { inventory: Inventory; candidateId: string }>;
};

function navigating(tab: chrome.tabs.Tab, frameScope: UiFrameScope): boolean {
    return (
        !!tab.pendingUrl ||
        (frameScope === "all-frames" && tab.status === "loading")
    );
}

async function frameRequest(
    tabId: number,
    frame: Frame,
    request: UiFrameRequest,
): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const response: unknown = await Promise.race([
            chrome.tabs.sendMessage(
                tabId,
                {
                    type: "groundedUi",
                    request,
                    expiresAt: Date.now() + limits.timeoutMs,
                },
                { documentId: frame.documentId, frameId: frame.frameId },
            ),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                "unavailable: grounded UI frame timed out; no retry",
                            ),
                        ),
                    limits.timeoutMs,
                );
            }),
        ]);
        if (!response || typeof response !== "object")
            throw new Error("unsupported: missing grounded UI frame response");
        if ("error" in response) {
            if (typeof response.error !== "string")
                throw new Error("unsupported: invalid grounded UI frame error");
            throw new Error(response.error);
        }
        if (!("data" in response))
            throw new Error("unsupported: missing grounded UI frame data");
        return response.data;
    } finally {
        clearTimeout(timer);
    }
}

async function permittedFrames(
    tabId: number,
    frameScope: UiFrameScope,
): Promise<Frame[]> {
    const inventory = await chrome.webNavigation.getAllFrames({ tabId });
    const frames =
        frameScope === "main-document"
            ? inventory?.filter((frame) => frame.frameId === 0)
            : inventory;
    if (
        !frames?.some((frame) => frame.frameId === 0) ||
        frames.length > limits.frames
    )
        throw new Error("unsupported: incomplete grounded UI frame inventory");
    const result: Frame[] = [];
    for (const frame of frames) {
        const documentId: unknown =
            "documentId" in frame ? frame.documentId : undefined;
        const url = new URL(frame.url);
        if (
            typeof documentId !== "string" ||
            !documentId ||
            !["http:", "https:"].includes(url.protocol) ||
            !(await chrome.permissions.contains({
                origins: [`${url.origin}/*`],
            }))
        )
            throw new Error("unsupported: inaccessible grounded UI frame");
        result.push({ frameId: frame.frameId, documentId, url: frame.url });
    }
    return result.sort((a, b) => a.frameId - b.frameId);
}

export function createUiDecisionBrowser(
    getActiveTab: () => Promise<chrome.tabs.Tab>,
) {
    const snapshots = new Map<string, Captured>();
    function invalidate(tabId: number) {
        for (const [id, state] of snapshots)
            if (state.tabId === tabId) snapshots.delete(id);
    }
    chrome.tabs.onRemoved.addListener(invalidate);
    chrome.tabs.onUpdated.addListener((tabId, change) => {
        if (change.status === "loading" || change.url !== undefined)
            invalidate(tabId);
    });

    async function current(snapshotId: string): Promise<Captured> {
        const state = snapshots.get(snapshotId);
        if (
            !state ||
            Date.now() - state.observation.createdAt >= limits.lifetimeMs
        )
            throw new Error("stale: grounded UI browser observation expired");
        const tab = await getActiveTab();
        if (
            tab.id !== state.tabId ||
            tab.incognito ||
            navigating(tab, state.observation.frameScope ?? "all-frames") ||
            tab.url !== state.observation.url
        )
            throw new Error("stale: active grounded UI document changed");
        const frames = await permittedFrames(
            state.tabId,
            state.observation.frameScope ?? "all-frames",
        );
        if (
            JSON.stringify(frames) !==
            JSON.stringify(state.frames.map((item) => item.frame))
        )
            throw new Error("stale: grounded UI frame inventory changed");
        await Promise.all(
            state.frames.map((item) =>
                frameRequest(state.tabId, item.frame, {
                    method: "validate",
                    snapshotId: item.observation.snapshotId,
                }),
            ),
        );
        if (snapshots.get(snapshotId) !== state)
            throw new Error("stale: grounded UI observation invalidated");
        const active = await getActiveTab();
        if (
            active.id !== state.tabId ||
            active.url !== state.observation.url ||
            navigating(active, state.observation.frameScope ?? "all-frames")
        )
            throw new Error(
                "stale: active grounded UI document changed during validation",
            );
        return state;
    }

    return {
        async captureUiObservation(
            frameScope?: UiFrameScope,
        ): Promise<UiObservation> {
            // Optional RPC arguments arrive as null after JSON serialization.
            const scope = frameScope ?? "all-frames";
            assertUiFrameScope(scope);
            const tab = await getActiveTab();
            if (
                tab.id === undefined ||
                tab.incognito ||
                navigating(tab, scope) ||
                !tab.url
            )
                throw new Error("unsupported: grounded UI tab is unavailable");
            const tabId = tab.id;
            const frames = await permittedFrames(tabId, scope);
            const inventories: Inventory[] = await Promise.all(
                frames.map(async (frame) => {
                    const observation = await frameRequest(tabId, frame, {
                        method: "capture",
                    });
                    assertUiObservation(observation);
                    if (observation.url !== frame.url)
                        throw new Error("stale: grounded UI frame navigated");
                    return { frame, observation };
                }),
            );
            const owners: Captured["owners"] = new Map();
            const candidates = inventories.flatMap((inventory, index) =>
                inventory.observation.candidates.map((candidate) => {
                    const id = `f${index}_${candidate.id}`;
                    owners.set(id, { inventory, candidateId: candidate.id });
                    return { ...candidate, id };
                }),
            );
            const observation: UiObservation = {
                snapshotId: crypto.randomUUID(),
                url: tab.url,
                createdAt: Math.min(
                    ...inventories.map((item) => item.observation.createdAt),
                ),
                complete: true,
                frameScope: scope,
                candidates,
                content: inventories
                    .map(
                        (item, index) =>
                            `Frame ${index}:\n${item.observation.content}`,
                    )
                    .join("\n"),
            };
            assertUiObservation(observation);
            for (const [id, state] of snapshots)
                if (
                    Date.now() - state.observation.createdAt >=
                    limits.lifetimeMs
                )
                    snapshots.delete(id);
            if (snapshots.size >= limits.snapshots)
                snapshots.delete(snapshots.keys().next().value!);
            snapshots.set(observation.snapshotId, {
                tabId,
                frames: inventories,
                observation,
                owners,
            });
            return observation;
        },
        async validateUiObservation(snapshotId: string): Promise<void> {
            await current(snapshotId);
        },
        async executeUiAction(
            snapshotId: string,
            candidateId: string,
            action: UiAction,
        ): Promise<UiActionResult> {
            assertUiAction(action);
            const state = await current(snapshotId);
            const owner = state.owners.get(candidateId);
            if (!owner)
                throw new Error("unsupported: unissued grounded UI candidate");
            if (snapshots.get(snapshotId) !== state)
                throw new Error(
                    "stale: grounded UI action was already consumed",
                );
            // Consume before dispatch: a timeout must not authorize a second mutation.
            snapshots.delete(snapshotId);
            const result = await frameRequest(
                state.tabId,
                owner.inventory.frame,
                {
                    method: "execute",
                    snapshotId: owner.inventory.observation.snapshotId,
                    candidateId: owner.candidateId,
                    action,
                },
            );
            if (
                !result ||
                typeof result !== "object" ||
                !("dispatched" in result) ||
                result.dispatched !== true
            )
                throw new Error(
                    "verification_failed: invalid grounded UI dispatch response; no retry",
                );
            if (
                action.type !== "activate" &&
                (!("valueVerified" in result) || result.valueVerified !== true)
            )
                throw new Error(
                    "verification_failed: grounded UI value was not verified; no retry",
                );
            return action.type === "activate"
                ? { dispatched: true }
                : { dispatched: true, valueVerified: true };
        },
    };
}
