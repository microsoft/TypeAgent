// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    ICompletionDispatcher,
    CommandCompletionResult,
    makeSession,
    makeCompletionResult,
    flushPromises,
} from "./helpers.js";

describe("PartialCompletionSession — backend error handling", () => {
    test("rejected promise clears PENDING state so next update can proceed", async () => {
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValueOnce(new Error("network error"))
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const { session } = makeSession(dispatcher);

        session.update("play");
        // Flush rejected promise + catch handler
        await flushPromises();

        // After rejection, anchor is still "play" with separatorMode="space".
        // Diverged input triggers a re-fetch (anchor no longer matches).
        session.update("stop");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "stop",
            "forward",
        );
    });

    test("rejected promise: same input within anchor does not re-fetch", async () => {
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValueOnce(new Error("network error"))
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const { session } = makeSession(dispatcher);

        session.update("play");
        await flushPromises();

        // Same input — anchor still matches, reuse session (no re-fetch)
        session.update("play");

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("rejected promise does not leave session stuck in PENDING", async () => {
        let rejectFn!: (e: Error) => void;
        const rejecting = new Promise<CommandCompletionResult>(
            (_, reject) => (rejectFn = reject),
        );
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockReturnValueOnce(rejecting)
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const { session } = makeSession(dispatcher);

        session.update("play");

        // While PENDING, second update is suppressed
        session.update("play more");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Now reject
        rejectFn(new Error("timeout"));
        await flushPromises();

        // Session is no longer PENDING — diverged input triggers re-fetch.
        // Call count: (1) original "play", (2) reconcile re-fetches
        // "play more" (type-ahead while pending), (3) "stop" diverges.
        session.update("stop");
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(3);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "stop",
            "forward",
        );
    });

    test("rejected promise does not populate completions", async () => {
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValue(new Error("timeout")),
        };
        const { session } = makeSession(dispatcher);

        session.update("play");
        await flushPromises();

        // After rejection, no completions should be available.
        // The initial startNewSession fires one onUpdate (clearing state).
        expect(session.getCompletionState()).toBeUndefined();
    });
});
