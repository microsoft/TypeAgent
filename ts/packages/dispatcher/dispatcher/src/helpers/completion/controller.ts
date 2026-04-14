// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompletionDirection } from "@typeagent/agent-sdk";
import {
    SearchMenuBase,
    SearchMenuPosition,
    SearchMenuItem,
} from "./searchMenu.js";
import {
    ISearchMenu,
    ICompletionDispatcher,
    PartialCompletionSession,
    CompletionState,
} from "./session.js";

export type { CompletionState };

export type CompletionControllerOptions = {
    /** Custom ISearchMenu implementation (e.g. Shell's SearchMenu for DOM rendering).
     *  When omitted, an internal menu is created that fires onUpdate on show/hide. */
    menu?: ISearchMenu;
    /** Called whenever the completion list changes (items shown or hidden). */
    onUpdate?: () => void;
};

// Default position callback for consumers without spatial positioning (CLI).
const defaultPosition: SearchMenuPosition = { left: 0, bottom: 0 };
const defaultGetPosition = () => defaultPosition;

/**
 * Internal SearchMenu for the controller when no custom menu is provided.
 * Fires the onUpdate callback whenever items are shown or hidden.
 */
class CallbackSearchMenu extends SearchMenuBase {
    constructor(private readonly onUpdate: () => void) {
        super();
    }

    protected override onShow(
        _position: SearchMenuPosition,
        _prefix: string,
        _items: SearchMenuItem[],
    ): void {
        this.onUpdate();
    }

    protected override onHide(): void {
        this.onUpdate();
    }
}

/**
 * High-level completion controller wrapping PartialCompletionSession + ISearchMenu.
 *
 * Simplifies the completion API surface for consumers:
 *   - update()  — called on each keystroke
 *   - accept()  — called on Tab/Enter
 *   - dismiss() — called on Escape
 *   - hide()    — called when cursor leaves valid position
 *   - getCompletionState() — returns current completions for rendering
 *
 * CLI creates a controller without a custom menu (internal CallbackSearchMenu).
 * Shell creates a controller with its SearchMenu for DOM dropdown rendering.
 */
export class CompletionController {
    private readonly session: PartialCompletionSession;

    constructor(
        dispatcher: ICompletionDispatcher,
        options?: CompletionControllerOptions,
    ) {
        const onUpdate = options?.onUpdate ?? (() => {});
        const menu = options?.menu ?? new CallbackSearchMenu(onUpdate);
        this.session = new PartialCompletionSession(menu, dispatcher);
    }

    /**
     * Drive the completion state machine on each keystroke.
     * @param input   Current input text
     * @param direction  "forward" (typing) or "backward" (backspace)
     * @param getPosition  Optional position callback for menu placement (Shell).
     *                     Defaults to {left:0, bottom:0} for text-mode consumers.
     */
    public update(
        input: string,
        direction: CompletionDirection = "forward",
        getPosition?: (prefix: string) => SearchMenuPosition | undefined,
    ): void {
        this.session.update(
            input,
            getPosition ?? defaultGetPosition,
            direction,
        );
    }

    /** Accept the current completion (Tab/Enter). Resets session to idle. */
    public accept(): void {
        this.session.resetToIdle();
    }

    /**
     * Dismiss completions (Escape key). Performs smart level-shift or refetch.
     * @param input      Current input text
     * @param direction  Direction hint for the session
     * @param getPosition  Optional position callback for menu placement
     */
    public dismiss(
        input: string,
        direction: CompletionDirection = "forward",
        getPosition?: (prefix: string) => SearchMenuPosition | undefined,
    ): void {
        this.session.explicitHide(
            input,
            getPosition ?? defaultGetPosition,
            direction,
        );
    }

    /** Hide the menu without clearing session state (e.g. cursor moved away). */
    public hide(): void {
        this.session.hide();
    }

    /**
     * Returns the current completion state for rendering, or undefined
     * when there are no completions to show.
     */
    public getCompletionState(input: string): CompletionState | undefined {
        return this.session.getCompletionState(input);
    }

    /**
     * Returns the completion prefix (text typed after the anchor), or
     * undefined when no completions are active.  Useful for Shell's
     * handleSelect which needs the prefix before calling accept().
     */
    public getCompletionPrefix(input: string): string | undefined {
        return this.session.getCompletionPrefix(input);
    }
}

/** Factory function for creating a CompletionController. */
export function createCompletionController(
    dispatcher: ICompletionDispatcher,
    options?: CompletionControllerOptions,
): CompletionController {
    return new CompletionController(dispatcher, options);
}
