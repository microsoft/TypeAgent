// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    PendingInteractionType,
    PendingInteractionRequest,
    RequestId,
} from "@typeagent/dispatcher-types";

type PendingEntry = {
    type: PendingInteractionType;
    requestId?: RequestId;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeoutTimer?: ReturnType<typeof setTimeout>;
    defaultValue?: boolean; // askYesNo default
    // Full request data for replay
    request: PendingInteractionRequest;
};

/**
 * Manages in-flight interactions that are waiting for client responses.
 * Each interaction has a unique interactionId, a deferred Promise,
 * and optional timeout behavior.
 */
export class PendingInteractionManager {
    private pending = new Map<string, PendingEntry>();

    /**
     * Create a pending interaction and return a Promise that resolves
     * when the client responds (or rejects on timeout/cancellation).
     */
    create<T>(
        request: PendingInteractionRequest,
        timeoutMs?: number,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const entry: PendingEntry = {
                type: request.type,
                resolve,
                reject,
                request,
            };

            if (request.requestId !== undefined) {
                entry.requestId = request.requestId;
            }

            // Store default value for askYesNo timeout fallback
            if (request.type === "askYesNo") {
                const askYesNoDefault = (
                    request as PendingInteractionRequest & {
                        type: "askYesNo";
                    }
                ).defaultValue;
                if (askYesNoDefault !== undefined) {
                    entry.defaultValue = askYesNoDefault;
                }
            }

            this.pending.set(request.interactionId, entry);

            if (timeoutMs !== undefined && timeoutMs > 0) {
                entry.timeoutTimer = setTimeout(() => {
                    this.cancel(
                        request.interactionId,
                        new Error("Interaction timed out"),
                    );
                }, timeoutMs);
            }
        });
    }

    /**
     * Resolve a pending interaction with the client's response.
     * Returns true if the interaction was found and resolved.
     */
    resolve(interactionId: string, value: unknown): boolean {
        const entry = this.pending.get(interactionId);
        if (!entry) return false;
        this.pending.delete(interactionId);
        if (entry.timeoutTimer !== undefined) {
            clearTimeout(entry.timeoutTimer);
        }
        entry.resolve(value);
        return true;
    }

    /**
     * Reject/cancel a pending interaction (e.g., client disconnected, timeout).
     * For askYesNo with an explicit defaultValue, resolves with that value;
     * otherwise rejects. Returns true if the interaction was found and cancelled.
     */
    cancel(interactionId: string, error: Error): boolean {
        const entry = this.pending.get(interactionId);
        if (!entry) return false;
        this.pending.delete(interactionId);
        if (entry.timeoutTimer !== undefined) {
            clearTimeout(entry.timeoutTimer);
        }

        // For askYesNo, resolve with default if one was explicitly provided;
        // otherwise reject — no declared safe fallback exists.
        if (entry.type === "askYesNo") {
            if (entry.defaultValue !== undefined) {
                entry.resolve(entry.defaultValue);
            } else {
                entry.reject(error);
            }
            return true;
        }

        // For proposeAction and popupQuestion, reject
        entry.reject(error);
        return true;
    }

    /**
     * Get all pending interaction requests (for replay to reconnecting clients).
     */
    getPending(): PendingInteractionRequest[] {
        const result: PendingInteractionRequest[] = [];
        for (const entry of this.pending.values()) {
            result.push(entry.request);
        }
        return result;
    }

    /**
     * Check if an interaction is still pending.
     */
    has(interactionId: string): boolean {
        return this.pending.has(interactionId);
    }

    /**
     * Get the number of pending interactions.
     */
    get size(): number {
        return this.pending.size;
    }

    /**
     * Cancel all pending interactions.
     */
    cancelAll(error: Error): void {
        for (const interactionId of [...this.pending.keys()]) {
            this.cancel(interactionId, error);
        }
    }
}
