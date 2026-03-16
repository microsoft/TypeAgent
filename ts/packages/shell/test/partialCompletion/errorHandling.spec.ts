// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    PartialCompletionSession,
    ICompletionDispatcher,
    CommandCompletionResult,
    makeMenu,
    makeCompletionResult,
    getPos,
} from "./helpers.js";

describe("PartialCompletionSession — backend error handling", () => {
    test("rejected promise clears PENDING state so next update can proceed", async () => {
        const menu = makeMenu();
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValueOnce(new Error("network error"))
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        // Flush rejected promise + catch handler
        await Promise.resolve();
        await Promise.resolve();

        // After rejection, anchor is still "play" with separatorMode="space".
        // Diverged input triggers a re-fetch (anchor no longer matches).
        session.update("stop", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
        expect(dispatcher.getCommandCompletion).toHaveBeenLastCalledWith(
            "stop",
        );
    });

    test("rejected promise: same input within anchor does not re-fetch", async () => {
        const menu = makeMenu();
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValueOnce(new Error("network error"))
                .mockResolvedValue(makeCompletionResult(["song"], 4)),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();
        await Promise.resolve();

        // Same input — anchor still matches, reuse session (no re-fetch)
        session.update("play", getPos);

        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);
    });

    test("rejected promise does not leave session stuck in PENDING", async () => {
        const menu = makeMenu();
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
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);

        // While PENDING, second update is suppressed
        session.update("play more", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(1);

        // Now reject
        rejectFn(new Error("timeout"));
        await Promise.resolve();
        await Promise.resolve();

        // Session is no longer PENDING — diverged input triggers re-fetch
        session.update("stop", getPos);
        expect(dispatcher.getCommandCompletion).toHaveBeenCalledTimes(2);
    });

    test("rejected promise does not populate menu", async () => {
        const menu = makeMenu();
        const dispatcher: ICompletionDispatcher = {
            getCommandCompletion: jest
                .fn<ICompletionDispatcher["getCommandCompletion"]>()
                .mockRejectedValue(new Error("timeout")),
        };
        const session = new PartialCompletionSession(menu, dispatcher);

        session.update("play", getPos);
        await Promise.resolve();
        await Promise.resolve();

        // setChoices should only have the initial empty-array call, not real items
        expect(menu.setChoices).toHaveBeenCalledTimes(1);
        expect(menu.setChoices).toHaveBeenCalledWith([]);
    });
});
