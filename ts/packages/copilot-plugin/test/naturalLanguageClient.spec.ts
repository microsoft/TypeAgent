// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { Dispatcher } from "@typeagent/agent-server-client";
import {
    createClientIO,
    submitCancellableCommand,
} from "../src/shared/typeagent-client.js";

describe("unchanged user-originated natural-language requests", () => {
    it.each([
        "list my playlists",
        "learn: create a playlist",
        "dev: create a playlist",
        "record: create a playlist",
        "dev: learn: create a playlist",
        'read "東京"\nIDs: 007, α\\β',
    ])(
        "submits exact text without structured reinterpretation: %s",
        async (command) => {
            const submitCommand = jest.fn(async () => ({
                ok: true,
                entry: {
                    requestId: "id",
                    completion: Promise.resolve(undefined),
                },
            }));
            const dispatcher = { submitCommand } as unknown as Dispatcher;
            await submitCancellableCommand(dispatcher, command);
            expect(submitCommand).toHaveBeenCalledWith(
                command,
                undefined,
                undefined,
                expect.stringMatching(/^copilot-plugin-/),
            );
        },
    );

    it("does not submit a command for an already-cancelled caller", async () => {
        const submitCommand = jest.fn<Dispatcher["submitCommand"]>();
        const dispatcher = { submitCommand } as unknown as Dispatcher;
        const controller = new AbortController();
        controller.abort();
        await expect(
            submitCancellableCommand(
                dispatcher,
                "learn: keep exact",
                controller.signal,
            ),
        ).resolves.toEqual({ cancelled: true });
        expect(submitCommand).not.toHaveBeenCalled();
    });

    it("reports complete legacy forms and choices instead of supplying answers", () => {
        const prompts: unknown[] = [];
        const io = createClientIO({
            onPendingPrompt: (value) => prompts.push(value),
        });
        const requestId = { requestId: "request", connectionId: "connection" };
        io.requestChoice(
            requestId,
            'id-"東京"',
            "multiChoice",
            "Choose",
            ["one", "two"],
            "fixture",
        );
        expect(prompts[0]).toEqual({
            type: "choice",
            arguments: [
                requestId,
                'id-"東京"',
                "multiChoice",
                "Choose",
                ["one", "two"],
                "fixture",
            ],
        });
    });
});
