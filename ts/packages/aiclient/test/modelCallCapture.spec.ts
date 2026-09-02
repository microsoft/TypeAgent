// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getModelCallSink,
    withModelCallSink,
    type ModelCallSink,
} from "../src/modelCallCapture.js";

describe("model call capture", () => {
    it("scopes sinks across asynchronous and nested work", async () => {
        const outer: ModelCallSink = () => {};
        const inner: ModelCallSink = () => {};

        expect(getModelCallSink()).toBeUndefined();
        await withModelCallSink(outer, async () => {
            expect(getModelCallSink()).toBe(outer);
            await Promise.resolve();
            expect(getModelCallSink()).toBe(outer);
            withModelCallSink(inner, () => {
                expect(getModelCallSink()).toBe(inner);
            });
            expect(getModelCallSink()).toBe(outer);
        });
        expect(getModelCallSink()).toBeUndefined();
    });
});
