// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CompletionController is the public consumer-facing type for the completion
// session.  PartialCompletionSession exposes consumer-friendly aliases
// (accept, dismiss) directly, so no wrapper class is needed — this module
// provides the type alias and factory for backward-compatible imports.

import {
    ICompletionDispatcher,
    PartialCompletionSession,
    CompletionState,
} from "./session.js";
import { CompletionDirection } from "@typeagent/agent-sdk";

export type { CompletionState };

export type CompletionControllerOptions = {
    /** Called whenever the completion list changes (items shown or hidden).
     *  Used by the CLI to trigger re-render when completions arrive async. */
    onUpdate?: () => void;
};

/**
 * Consumer-facing interface for the completion session.
 *
 * API surface:
 *   - update()  — called on each keystroke
 *   - accept()  — called on Tab/Enter
 *   - dismiss() — called on Escape
 *   - show()    — explicitly reactivate after a dismiss (Ctrl+Space)
 *   - hide()    — called when cursor leaves valid position
 *   - getCompletionState() — returns current completions for rendering
 *   - setOnUpdate() — set/replace the onUpdate callback
 *   - dispose() — permanently shut down; clears state and detaches callbacks
 *
 * Both CLI and Shell create a controller via createCompletionController().
 * The onUpdate callback fires whenever completion state changes.  Renderers
 * query getCompletionState() in the callback to get the current items.
 */
export interface CompletionController {
    update(input: string, direction?: CompletionDirection): void;
    accept(): void;
    dismiss(input: string, direction?: CompletionDirection): void;
    show(input: string, direction?: CompletionDirection): void;
    hide(): void;
    getCompletionState(): CompletionState | undefined;
    setOnUpdate(onUpdate: () => void): void;
    dispose(): void;
}

/** Factory function for creating a CompletionController. */
export function createCompletionController(
    dispatcher: ICompletionDispatcher,
    options?: CompletionControllerOptions,
): CompletionController {
    return new PartialCompletionSession(dispatcher, options?.onUpdate);
}
