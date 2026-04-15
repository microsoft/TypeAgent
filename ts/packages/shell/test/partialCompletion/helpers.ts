// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest, type jest as JestTypes } from "@jest/globals";
import {
    ICompletionDispatcher,
    ISearchMenu,
    PartialCompletionSession,
} from "../../src/renderer/src/partialCompletionSession.js";
import { SearchMenuPosition } from "../../src/preload/electronTypes.js";
import { CompletionGroup, SeparatorMode } from "@typeagent/agent-sdk";
import { CommandCompletionResult } from "agent-dispatcher";
import { SearchMenuBase } from "../../src/renderer/src/searchMenuBase.js";

export { PartialCompletionSession };
export type { ICompletionDispatcher, ISearchMenu };
export type { CompletionGroup };
export type { CommandCompletionResult };
export type { SearchMenuPosition };

type Mocked<T extends (...args: any[]) => any> = T &
    JestTypes.MockedFunction<T>;

// Real trie-backed ISearchMenu backed by SearchMenuBase.
// Every method is a jest.fn() wrapping the real implementation so tests can
// assert on call counts and arguments.
export class TestSearchMenu extends SearchMenuBase {
    override setChoices: Mocked<SearchMenuBase["setChoices"]> = jest.fn(
        (...args: Parameters<SearchMenuBase["setChoices"]>) =>
            super.setChoices(...args),
    ) as any;

    override updatePrefix: Mocked<ISearchMenu["updatePrefix"]> = jest.fn(
        (prefix: string, position: SearchMenuPosition): boolean =>
            super.updatePrefix(prefix, position),
    ) as any;

    override hasExactMatch: Mocked<ISearchMenu["hasExactMatch"]> = jest.fn(
        (text: string): boolean => super.hasExactMatch(text),
    ) as any;

    override hide: Mocked<ISearchMenu["hide"]> = jest.fn(() =>
        super.hide(),
    ) as any;

    override isActive: Mocked<ISearchMenu["isActive"]> = jest.fn(() =>
        super.isActive(),
    ) as any;
}

export function makeMenu(): TestSearchMenu {
    return new TestSearchMenu();
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

export const anyPosition: SearchMenuPosition = { left: 0, bottom: 0 };
export const getPos = (_prefix: string) => anyPosition;

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

// Returns the selectedText values from the last setChoices call on a
// TestSearchMenu mock.  Avoids repeating the verbose mock.calls pattern.
export function lastSetChoicesItems(menu: TestSearchMenu): string[] {
    const calls = menu.setChoices.mock.calls;
    return calls[calls.length - 1][0].map(
        (i: { selectedText: string }) => i.selectedText,
    );
}
