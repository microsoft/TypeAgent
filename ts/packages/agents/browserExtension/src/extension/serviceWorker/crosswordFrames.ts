// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CROSSWORD_DECISION_LIMITS as limits,
    type CrosswordCandidate,
    type CrosswordDirection,
    type CrosswordRpcOrigin,
    type CrosswordSnapshot,
    type ResolveCrosswordClueResponse,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import {
    cancelCrosswordDecisionRpc,
    forwardCrosswordDecisionRpc,
    getCrosswordRpcOrigin,
} from "./crosswordDecisionRpc";
import { getCrosswordMode, getCrosswordDecisionStrategy } from "./storage";

type Action = {
    method: "readClue" | "enterText";
    params: {
        clueNumber: number;
        clueDirection: CrosswordDirection;
        value?: string;
    };
};
type Frame = { frameId: number; documentId?: string; url: string };
type Inventory = { frame: Frame; snapshot: CrosswordSnapshot };
type Owner = { inventory: Inventory; candidateId: string };
type Binding = {
    signature: string;
    owner: Owner;
    snapshot: CrosswordSnapshot;
    candidateId: string;
    expires: number;
    tabId: number;
    body?: ResolveCrosswordClueResponse["body"];
};
type RegionInventory = ReturnType<typeof merge> & {
    signature: string;
    expires: number;
    tabId: number;
};
type Operation = {
    origin?: CrosswordRpcOrigin;
    snapshotId?: string;
    cancelled: boolean;
    cancel: (reason?: string) => void;
};
const bindings = new Map<string, Binding>();
const regionInventories = new Map<string, RegionInventory>();
const operations = new Set<Operation>();
let listening = false;

function fail(message: string): never {
    throw new Error(message);
}

function invalidate(tabId?: number): void {
    for (const [key, inventory] of regionInventories) {
        if (tabId === undefined || inventory.tabId === tabId)
            regionInventories.delete(key);
    }
    for (const [key, binding] of bindings) {
        if (tabId === undefined || binding.tabId === tabId)
            bindings.delete(key);
    }
    for (const operation of operations) {
        if (tabId === undefined || operation.origin?.tabId === tabId)
            operation.cancel();
    }
}

function cachedRegionInventory(
    key: string,
    signature: string,
): RegionInventory | undefined {
    const inventory = regionInventories.get(key);
    if (inventory?.signature !== signature || inventory.expires <= Date.now()) {
        regionInventories.delete(key);
        return undefined;
    }
    return inventory;
}

function listen(): void {
    if (listening) return;
    listening = true;
    chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
        if (frameId === 0) invalidate(tabId);
    });
    chrome.tabs.onRemoved.addListener((tabId) => invalidate(tabId));
    chrome.storage.onChanged.addListener(() => invalidate());
}

function validateAction(message: unknown): Action {
    if (!message || typeof message !== "object")
        fail("unsupported: invalid crossword frame action");
    const { method, params } = message as Action;
    if (
        (method !== "readClue" && method !== "enterText") ||
        !params ||
        typeof params !== "object" ||
        Object.keys(params).some(
            (key) =>
                key !== "clueNumber" &&
                key !== "clueDirection" &&
                !(key === "value" && method === "enterText"),
        ) ||
        !Number.isSafeInteger(params.clueNumber) ||
        params.clueNumber <= 0 ||
        params.clueNumber > 9999 ||
        (params.clueDirection !== "across" &&
            params.clueDirection !== "down") ||
        (method === "enterText" &&
            (typeof params.value !== "string" ||
                params.value.length > limits.textLength))
    )
        fail("unsupported: invalid crossword frame action parameters");
    return { method, params };
}

// Discovery neither expands permissions nor injects missing content scripts.
// Current manifest-provided contexts are limited to http://localhost:9000/*.
async function framesFor(origin: CrosswordRpcOrigin): Promise<Frame[]> {
    const frames = await chrome.webNavigation.getAllFrames({
        tabId: origin.tabId,
    });
    if (!frames || frames.length === 0 || frames.length > 16)
        fail("unsupported: incomplete frame inventory (frame bound)");
    const result = frames
        .map(({ frameId, documentId, url }) => ({ frameId, documentId, url }))
        .sort((a, b) => a.frameId - b.frameId);
    if (
        result.find((frame) => frame.frameId === 0)?.documentId !==
        origin.documentId
    )
        fail("stale: top document changed");
    for (const frame of result) {
        let url: URL;
        try {
            url = new URL(frame.url);
        } catch {
            fail("unsupported: incomplete frame inventory (invalid URL)");
        }
        if (
            (url.protocol !== "http:" && url.protocol !== "https:") ||
            !(await chrome.permissions.contains({
                origins: [`${url.origin}/*`],
            }))
        )
            fail(
                "unsupported: incomplete frame inventory (inaccessible frame)",
            );
    }
    return result;
}

async function frameMessage(
    tabId: number,
    frame: Frame,
    message: unknown,
): Promise<Record<string, unknown>> {
    try {
        const response: unknown = await chrome.tabs.sendMessage(
            tabId,
            message,
            {
                frameId: frame.frameId,
                ...(frame.documentId ? { documentId: frame.documentId } : {}),
            },
        );
        if (!response || typeof response !== "object")
            fail("unsupported: incomplete frame inventory (missing context)");
        const result = response as Record<string, unknown>;
        if (typeof result.error === "string") fail(result.error);
        return result;
    } catch (error) {
        fail(
            `unsupported: incomplete frame operation: ${
                error instanceof Error ? error.message : "missing context"
            }`,
        );
    }
}

async function executeBinding(
    binding: Binding,
    action: Action,
    origin: CrosswordRpcOrigin,
    configGeneration: string,
): Promise<unknown> {
    const response = await frameMessage(
        origin.tabId,
        binding.owner.inventory.frame,
        {
            type:
                action.method === "readClue"
                    ? "crosswordFrameRead"
                    : "crosswordFrameEnter",
            params: {
                ...action.params,
                snapshotId: binding.owner.inventory.snapshot.snapshotId,
                candidateId: binding.owner.candidateId,
                configGeneration,
                ...(action.method === "readClue" ? { body: binding.body } : {}),
            },
        },
    );
    if (!Object.prototype.hasOwnProperty.call(response, "result"))
        fail("unsupported: missing crossword frame result");
    return response.result;
}

function validSnapshot(value: unknown): value is CrosswordSnapshot {
    if (!value || typeof value !== "object") return false;
    const snapshot = value as CrosswordSnapshot;
    const text = (value: unknown, maximum: number) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= maximum;
    const integer = (value: unknown) =>
        Number.isSafeInteger(value) && (value as number) >= 0;
    return (
        text(snapshot.snapshotId, 256) &&
        text(snapshot.documentToken, 256) &&
        text(snapshot.puzzleId, 256) &&
        integer(snapshot.revision) &&
        integer(snapshot.modeGeneration) &&
        Number.isFinite(snapshot.createdAt) &&
        snapshot.createdAt <= Date.now() &&
        Date.now() - snapshot.createdAt <= limits.snapshotLifetimeMs &&
        snapshot.collectorVersion === limits.collectorVersion &&
        snapshot.complete === true &&
        Array.isArray(snapshot.candidates) &&
        snapshot.candidates.length <= limits.candidates &&
        new Set(snapshot.candidates.map((candidate) => candidate?.id)).size ===
            snapshot.candidates.length &&
        snapshot.candidates.every(
            (candidate) =>
                candidate &&
                text(candidate.id, 64) &&
                text(candidate.text, limits.textLength) &&
                typeof candidate.context === "string" &&
                candidate.context.length <= limits.contextLength &&
                (candidate.role === undefined || text(candidate.role, 128)) &&
                (candidate.scopeId === undefined ||
                    text(candidate.scopeId, 64)) &&
                (candidate.regionId === undefined ||
                    text(candidate.regionId, 64)),
        )
    );
}

async function capture(
    origin: CrosswordRpcOrigin,
    frames: Frame[],
): Promise<Inventory[]> {
    const inventories = await Promise.all(
        frames.map(async (frame) => {
            const { snapshot } = await frameMessage(origin.tabId, frame, {
                type: "crosswordFrameCapture",
            });
            if (!validSnapshot(snapshot))
                fail("unsupported: incomplete or stale frame snapshot");
            return { frame, snapshot };
        }),
    );
    if (
        inventories.reduce(
            (count, item) => count + item.snapshot.candidates.length,
            0,
        ) > limits.candidates ||
        new Blob([JSON.stringify(inventories)]).size > limits.snapshotBytes
    )
        fail("unsupported: incomplete frame inventory (evidence bound)");
    return inventories;
}

function merge(inventories: Inventory[]): {
    snapshot: CrosswordSnapshot;
    owners: Map<string, Owner>;
} {
    const owners = new Map<string, Owner>();
    const candidates: CrosswordCandidate[] = [];
    for (const inventory of inventories) {
        const regions = new Map<string, string>();
        const scopes = new Map<string, string>();
        const opaque = (
            map: Map<string, string>,
            key: string,
            prefix: string,
        ) => {
            let value = map.get(key);
            if (!value) {
                value = `${prefix}${inventory.frame.frameId}-${map.size}`;
                map.set(key, value);
            }
            return value;
        };
        for (const candidate of inventory.snapshot.candidates) {
            const id = `c${candidates.length}`;
            candidates.push({
                id,
                text: candidate.text,
                context: candidate.context,
                ...(candidate.bodyTexts
                    ? { bodyTexts: candidate.bodyTexts }
                    : {}),
                ...(candidate.role === undefined
                    ? {}
                    : { role: candidate.role }),
                regionId: opaque(
                    regions,
                    candidate.regionId ?? "document",
                    "r",
                ),
                scopeId: opaque(
                    scopes,
                    candidate.scopeId ?? candidate.regionId ?? "document",
                    "s",
                ),
            });
            owners.set(id, { inventory, candidateId: candidate.id });
        }
    }
    const snapshot: CrosswordSnapshot = {
        snapshotId: crypto.randomUUID(),
        documentToken: crypto.randomUUID(),
        puzzleId: crypto.randomUUID(),
        revision: 0,
        modeGeneration: 0,
        createdAt: Math.min(
            ...inventories.map((item) => item.snapshot.createdAt),
        ),
        collectorVersion: limits.collectorVersion,
        complete: true,
        candidates,
    };
    if (new Blob([JSON.stringify(snapshot)]).size > limits.snapshotBytes)
        fail("unsupported: incomplete merged frame inventory (byte bound)");
    return { snapshot, owners };
}

function selectedOwner(
    response: ResolveCrosswordClueResponse,
    snapshot: CrosswordSnapshot,
    owners: Map<string, Owner>,
    configGeneration: string,
): Owner {
    const owner = owners.get(response.candidateId ?? "");
    if (
        response.status !== "resolved" ||
        response.configGeneration !== configGeneration ||
        response.snapshotId !== snapshot.snapshotId ||
        response.documentToken !== snapshot.documentToken ||
        response.puzzleId !== snapshot.puzzleId ||
        response.revision !== snapshot.revision ||
        response.modeGeneration !== snapshot.modeGeneration ||
        !owner
    )
        fail(
            `${response.status === "resolved" ? "unsupported" : response.status}: ${
                response.message ?? "no selected crossword target"
            }`,
        );
    return owner;
}

export async function routeCrosswordFrameAction(
    message: unknown,
    sender: chrome.runtime.MessageSender,
): Promise<{ result: unknown }> {
    const action = validateAction(message);
    listen();
    let rejectCancellation: (error: Error) => void = () => {};
    const cancellation = new Promise<never>((_, reject) => {
        rejectCancellation = reject;
    });
    const operation: Operation = {
        cancelled: false,
        cancel: (reason = "cancelled: crossword frame action") => {
            if (operation.cancelled) return;
            operation.cancelled = true;
            if (operation.snapshotId && operation.origin)
                cancelCrosswordDecisionRpc(
                    operation.origin,
                    operation.snapshotId,
                );
            rejectCancellation(new Error(reason));
        },
    };
    operations.add(operation);
    const timer = setTimeout(
        () =>
            operation.cancel(
                "unavailable: crossword frame action timed out; no retry",
            ),
        limits.timeoutMs,
    );
    const active = () => {
        if (operation.cancelled) fail("cancelled: crossword frame action");
    };
    const run = async () => {
        const origin = await getCrosswordRpcOrigin(sender);
        active();
        if (!origin || origin.frameId !== 0)
            fail(
                "unsupported: crossword frame action requires a trusted top document",
            );
        operation.origin = origin;
        if ((await getCrosswordMode()) !== "decision")
            fail("unsupported: decision mode is not selected");
        active();
        const capability = await forwardCrosswordDecisionRpc(
            "getCrosswordDecisionCapabilities",
            undefined,
            origin,
        );
        active();
        if (!capability.available || !capability.configGeneration)
            fail("unavailable: crossword decision capability");
        const frames = await framesFor(origin);
        active();
        const inventories = await capture(origin, frames);
        active();
        const signature = JSON.stringify(inventories);
        const strategy = await getCrosswordDecisionStrategy();
        active();
        const key = JSON.stringify([
            origin,
            action.params.clueNumber,
            action.params.clueDirection,
            capability.configGeneration,
            strategy,
        ]);
        const inventoryKey = JSON.stringify([
            origin,
            capability.configGeneration,
            strategy,
        ]);
        let regionInventory = cachedRegionInventory(inventoryKey, signature);
        let binding = bindings.get(key);
        if (binding?.signature !== signature || binding.expires <= Date.now()) {
            bindings.delete(key);
            binding = undefined;
        }
        if (!binding) {
            const merged = regionInventory ?? {
                ...merge(inventories),
                signature,
                tabId: origin.tabId,
                expires:
                    Math.min(
                        ...inventories.map((item) => item.snapshot.createdAt),
                    ) + limits.snapshotLifetimeMs,
            };
            const { snapshot, owners } = merged;
            operation.snapshotId = snapshot.snapshotId;
            const response = await forwardCrosswordDecisionRpc(
                "resolveCrosswordClue",
                {
                    snapshot,
                    clueNumber: action.params.clueNumber,
                    clueDirection: action.params.clueDirection,
                    strategy,
                    ...(action.method === "readClue"
                        ? { includeBody: true }
                        : {}),
                },
                origin,
            );
            active();
            const owner = selectedOwner(
                response,
                snapshot,
                owners,
                capability.configGeneration,
            );
            regionInventory = merged;
            binding = {
                signature,
                owner,
                snapshot,
                candidateId: response.candidateId!,
                tabId: origin.tabId,
                expires: snapshot.createdAt + limits.snapshotLifetimeMs,
                body: response.body,
            };
            if (action.method === "readClue" && !binding.body)
                fail("unsupported: missing clue body binding");
        } else if (action.method === "readClue" && !binding.body) {
            const owner = binding.owner;
            const snapshot = binding.snapshot;
            operation.snapshotId = snapshot.snapshotId;
            const response = await forwardCrosswordDecisionRpc(
                "resolveCrosswordClue",
                {
                    snapshot,
                    clueNumber: action.params.clueNumber,
                    clueDirection: action.params.clueDirection,
                    includeBody: true,
                    bodyCandidateId: binding.candidateId,
                },
                origin,
            );
            active();
            selectedOwner(
                response,
                snapshot,
                new Map([[binding.candidateId, owner]]),
                capability.configGeneration,
            );
            if (!response.body) fail("unsupported: missing clue body binding");
            binding = { ...binding, body: response.body };
        }
        const after = await forwardCrosswordDecisionRpc(
            "getCrosswordDecisionCapabilities",
            undefined,
            origin,
        );
        active();
        if (
            !after.available ||
            after.configGeneration !== capability.configGeneration ||
            (await getCrosswordDecisionStrategy()) !== strategy ||
            (await getCrosswordMode()) !== "decision"
        )
            fail("cancelled: crossword mode or configuration changed");
        active();
        // No retry: a frame may have applied an entry even if its reply is lost.
        const result = await executeBinding(
            binding,
            action,
            origin,
            capability.configGeneration,
        );
        active();
        bindings.delete(key);
        if (bindings.size >= 128)
            bindings.delete(bindings.keys().next().value!);
        bindings.set(key, binding);
        if (strategy === "hybrid2" && regionInventory) {
            regionInventories.delete(inventoryKey);
            if (regionInventories.size >= 128)
                regionInventories.delete(
                    regionInventories.keys().next().value!,
                );
            regionInventories.set(inventoryKey, regionInventory);
        }
        return { result };
    };
    try {
        return await Promise.race([run(), cancellation]);
    } finally {
        clearTimeout(timer);
        operations.delete(operation);
    }
}
