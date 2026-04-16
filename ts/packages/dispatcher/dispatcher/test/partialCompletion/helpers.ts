// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest, type jest as JestTypes } from "@jest/globals";
import {
    ICompletionDispatcher,
    ISearchMenuControl,
    PartialCompletionSession,
} from "../../src/helpers/completion/session.js";
import { HeadlessSearchMenu } from "../../src/helpers/completion/controller.js";
import { CompletionGroup, SeparatorMode } from "@typeagent/agent-sdk";
import { CommandCompletionResult } from "@typeagent/dispatcher-types";

export { PartialCompletionSession };
export type { ICompletionDispatcher, ISearchMenuControl };
export type { CompletionGroup };
export type { CommandCompletionResult };

type Mocked<T extends (...args: any[]) => any> = T &
    JestTypes.MockedFunction<T>;

// Real trie-backed ISearchMenuControl using HeadlessSearchMenu.
// Every method is a jest.fn() wrapping the real implementation so tests can
// assert on call counts and arguments.
export class TestSearchMenu extends HeadlessSearchMenu {
    override invalidate: Mocked<ISearchMenuControl["invalidate"]> = jest.fn(
        () => super.invalidate(),
    ) as any;

    override updatePrefix: Mocked<ISearchMenuControl["updatePrefix"]> = jest.fn(
        (prefix: string): boolean => super.updatePrefix(prefix),
    ) as any;

    override hide: Mocked<ISearchMenuControl["hide"]> = jest.fn(() =>
        super.hide(),
    ) as any;

    override isActive: Mocked<HeadlessSearchMenu["isActive"]> = jest.fn(() =>
        super.isActive(),
    ) as any;

    constructor(session: PartialCompletionSession) {
        super(() => {}, session);
    }
}

// Create a wired session + menu pair.
export function makeSession(
    dispatcher: ICompletionDispatcher | MockDispatcher,
): { session: PartialCompletionSession; menu: TestSearchMenu } {
    const session = new PartialCompletionSession(
        dispatcher as ICompletionDispatcher,
    );
    const menu = new TestSearchMenu(session);
    session.setMenu(menu);
    return { session, menu };
}

// Legacy helper — creates a TestSearchMenu from a pre-existing session.
export function makeMenu(session: PartialCompletionSession): TestSearchMenu {
    return new TestSearchMenu(session);
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

// Returns the selectedText values of items currently loaded in the
// session's trie.  Replaces the old setChoices-based introspection.
export function loadedItems(session: PartialCompletionSession): string[] {
    return session.filterItems("").map((i) => i.selectedText);
}
