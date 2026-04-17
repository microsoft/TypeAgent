// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    PartialCompletionSession,
} from "../../src/helpers/completion/session.js";
import { CompletionGroup, SeparatorMode } from "@typeagent/agent-sdk";
import { CommandCompletionResult } from "@typeagent/dispatcher-types";

export { PartialCompletionSession };
export type { ICompletionDispatcher };
export type { CompletionGroup };
export type { CommandCompletionResult };

// Create a session with a mock onUpdate callback.
export function makeSession(
    dispatcher: ICompletionDispatcher | MockDispatcher,
): {
    session: PartialCompletionSession;
    onUpdate: jest.Mock;
} {
    const onUpdate = jest.fn();
    const session = new PartialCompletionSession(
        dispatcher as ICompletionDispatcher,
        onUpdate,
    );
    return { session, onUpdate };
}

// Convenience: check whether the session considers completions active.
export function isActive(session: PartialCompletionSession): boolean {
    return session.getCompletionState() !== undefined;
}

// Convenience: get the filtered item texts, or [].
export function getItemTexts(session: PartialCompletionSession): string[] {
    const state = session.getCompletionState();
    return state ? state.items.map((i) => i.selectedText) : [];
}

export type MockDispatcher = {
    getCommandCompletion: jest.MockedFunction<
        ICompletionDispatcher["getCommandCompletion"]
    >;
};

export function makeDispatcher(
    result: CommandCompletionResult = {
        startIndex: 0,
        completions: [],
        closedSet: true,
        directionSensitive: false,
        afterWildcard: "none",
    },
): MockDispatcher {
    return {
        getCommandCompletion: jest
            .fn<ICompletionDispatcher["getCommandCompletion"]>()
            .mockResolvedValue(result),
    };
}

export function makeCompletionResult(
    completions: string[],
    startIndex: number = 0,
    opts: Partial<CommandCompletionResult> & {
        separatorMode?: SeparatorMode;
    } = {},
): CommandCompletionResult {
    const { separatorMode = "space", ...rest } = opts;
    const group: CompletionGroup = {
        name: "test",
        completions,
        separatorMode,
    };
    return {
        startIndex,
        completions: [group],
        closedSet: false,
        directionSensitive: false,
        afterWildcard: "none",
        ...rest,
    };
}

// Build a CommandCompletionResult with multiple CompletionGroups,
// each with its own separatorMode.
export function makeMultiGroupResult(
    groups: { completions: string[]; separatorMode?: SeparatorMode }[],
    startIndex: number = 0,
    opts: Partial<CommandCompletionResult> = {},
): CommandCompletionResult {
    const completions: CompletionGroup[] = groups.map((g, i) => ({
        name: `group-${i}`,
        completions: g.completions,
        separatorMode: g.separatorMode,
    }));
    return {
        startIndex,
        completions,
        closedSet: true,
        directionSensitive: false,
        afterWildcard: "none",
        ...opts,
    };
}

// Test utility: returns the selectedText values of items currently loaded
// in the session's internal trie.
export function loadedItems(session: PartialCompletionSession): string[] {
    return session.getLoadedItems().map((i) => i.selectedText);
}

// Flush microtask queue.  setTimeout schedules a macrotask that runs
// only after all pending microtasks (including nested async/await
// continuations) have drained.
export function flushPromises(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
