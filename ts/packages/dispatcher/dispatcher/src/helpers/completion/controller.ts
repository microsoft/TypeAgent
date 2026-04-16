// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompletionDirection } from "@typeagent/agent-sdk";
import { SearchMenuItem } from "./searchMenu.js";
import { type SearchMenuDataProvider } from "./searchMenu.js";
import {
    ICompletionDispatcher,
    PartialCompletionSession,
    CompletionState,
} from "./session.js";

export type { CompletionState };

export type CompletionControllerOptions = {
    /** Called whenever the completion list changes (items shown or hidden).
     *  Used by the CLI to trigger re-render when completions arrive async. */
    onUpdate?: () => void;
};

/**
 * High-level completion controller wrapping PartialCompletionSession.
 *
 * Implements SearchMenuDataProvider so consumers can pass the controller
 * directly to their SearchMenu as the data source.
 *
 * API surface:
 *   - update()  — called on each keystroke
 *   - accept()  — called on Tab/Enter
 *   - dismiss() — called on Escape
 *   - hide()    — called when cursor leaves valid position
 *   - getCompletionState() — returns current completions for rendering
 *   - setOnUpdate() — set/replace the onUpdate callback
 *
 * Both CLI and Shell create a controller. The onUpdate callback fires
 * whenever completion state changes.  Renderers query
 * getCompletionState() in the callback to get the current items.
 */
export class CompletionController
    implements SearchMenuDataProvider<SearchMenuItem>
{
    private readonly session: PartialCompletionSession;

    constructor(
        dispatcher: ICompletionDispatcher,
        options?: CompletionControllerOptions,
    ) {
        const onUpdate = options?.onUpdate ?? (() => {});
        this.session = new PartialCompletionSession(dispatcher, onUpdate);
    }

    // ── SearchMenuDataProvider implementation ─────────────────────────

    public filterItems(prefix: string): SearchMenuItem[] {
        return this.session.filterItems(prefix);
    }

    public numChoices(): number {
        return this.session.numChoices();
    }

    // ── Callback wiring ──────────────────────────────────────────────

    /**
     * Set or replace the callback invoked when completions change.
     */
    public setOnUpdate(onUpdate: () => void): void {
        this.session.setOnUpdate(onUpdate);
    }

    // ── Completion lifecycle ─────────────────────────────────────────

    /**
     * Drive the completion state machine on each keystroke.
     * @param input   Current input text
     * @param direction  "forward" (typing) or "backward" (backspace)
     */
    public update(
        input: string,
        direction: CompletionDirection = "forward",
    ): void {
        this.session.update(input, direction);
    }

    /** Accept the current completion (Tab/Enter). Resets session to idle. */
    public accept(): void {
        this.session.resetToIdle();
    }

    /**
     * Dismiss completions (Escape key). Performs smart level-shift or refetch.
     * @param input      Current input text
     * @param direction  Direction hint for the session
     */
    public dismiss(
        input: string,
        direction: CompletionDirection = "forward",
    ): void {
        this.session.explicitHide(input, direction);
    }

    /** Hide the menu without clearing session state (e.g. cursor moved away). */
    public hide(): void {
        this.session.hide();
    }

    /**
     * Returns the current completion state for rendering, or undefined
     * when there are no completions to show.
     */
    public getCompletionState(): CompletionState | undefined {
        return this.session.getCompletionState();
    }
}

/** Factory function for creating a CompletionController. */
export function createCompletionController(
    dispatcher: ICompletionDispatcher,
    options?: CompletionControllerOptions,
): CompletionController {
    return new CompletionController(dispatcher, options);
}
