// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Minimal test helpers for shell-specific completion tests (switchMode).
// The canonical test helpers and most completion tests live in
// packages/dispatcher/dispatcher/test/partialCompletion/.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    PartialCompletionSession,
    SearchMenuPosition,
} from "agent-dispatcher/helpers/completion";
import { CompletionGroup, SeparatorMode } from "@typeagent/agent-sdk";
import { CommandCompletionResult } from "agent-dispatcher";

export { PartialCompletionSession };
export type { SearchMenuPosition };

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
