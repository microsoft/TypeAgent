// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcherTestFixture } from "./dispatcherTestFixture.js";
import { jest } from "@jest/globals";

describe("dispatcher test fixture cleanup", () => {
    it("closes initialization that completes after teardown starts", async () => {
        const close = jest.fn(async () => {});
        let initialized!: (dispatcher: { close: typeof close }) => void;
        const fixture = createDispatcherTestFixture(
            () =>
                new Promise<{ close: typeof close }>((resolve) => {
                    initialized = resolve;
                }),
        );
        const cleanup = fixture.close();
        expect(close).not.toHaveBeenCalled();
        initialized({ close });
        await cleanup;
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("preserves initialization and shutdown failures", async () => {
        const startupError = new Error("startup failed");
        const failed = createDispatcherTestFixture(() =>
            Promise.reject(startupError),
        );
        await expect(failed.dispatcher).rejects.toBe(startupError);
        await expect(failed.close()).rejects.toBe(startupError);

        const shutdownError = new Error("shutdown failed");
        const started = createDispatcherTestFixture(async () => ({
            close: async () => {
                throw shutdownError;
            },
        }));
        await expect(started.close()).rejects.toBe(shutdownError);
    });
});
