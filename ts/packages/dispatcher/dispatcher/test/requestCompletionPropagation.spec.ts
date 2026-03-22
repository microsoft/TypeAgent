// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type CommandHandlerContext,
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { getCommandCompletion } from "../src/command/completion.js";

// ---------------------------------------------------------------------------
// Test: openWildcard and directionSensitive propagation through the
// request handler path (bare text → requestCommandHandler.getCompletion
// → requestCompletion → agentCache.completion)
//
// Strategy: initialize a context, then monkey-patch agentCache.completion
// to return a controlled CompletionResult with openWildcard and
// directionSensitive.  Send bare text (no @-prefix) so the dispatcher
// routes through the request handler.
// ---------------------------------------------------------------------------

describe("Request handler completion propagation", () => {
    let context: CommandHandlerContext;

    beforeAll(async () => {
        context = await initializeCommandHandlerContext("test", {
            agents: {
                actions: false,
                schemas: false,
            },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
        });
    });
    afterAll(async () => {
        if (context) {
            await closeCommandHandlerContext(context);
        }
    });

    function patchCacheCompletion(result: unknown): void {
        (context.agentCache as any).completion = () => result;
    }

    afterEach(() => {
        // Restore original (disabled cache returns undefined)
        patchCacheCompletion(undefined);
    });

    it("propagates openWildcard=true from cache through request handler", async () => {
        patchCacheCompletion({
            completions: ["by", "from"],
            matchedPrefixLength: 10,
            separatorMode: "spacePunctuation",
            closedSet: true,
            directionSensitive: true,
            openWildcard: true,
        });

        const result = await getCommandCompletion(
            "play hello",
            "forward",
            context,
        );
        expect(result).toBeDefined();
        expect(result.openWildcard).toBe(true);
        expect(result.directionSensitive).toBe(true);
        expect(result.closedSet).toBe(true);
        expect(result.separatorMode).toBe("spacePunctuation");
    });

    it("propagates openWildcard=false from cache through request handler", async () => {
        patchCacheCompletion({
            completions: ["music"],
            matchedPrefixLength: 5,
            separatorMode: "spacePunctuation",
            closedSet: true,
            directionSensitive: false,
            openWildcard: false,
        });

        const result = await getCommandCompletion("play ", "forward", context);
        expect(result).toBeDefined();
        expect(result.openWildcard).toBe(false);
    });

    it("returns openWildcard=false when cache returns undefined", async () => {
        patchCacheCompletion(undefined);

        const result = await getCommandCompletion(
            "play hello",
            "forward",
            context,
        );
        expect(result).toBeDefined();
        expect(result.openWildcard).toBe(false);
    });

    it("propagates directionSensitive through request handler", async () => {
        patchCacheCompletion({
            completions: ["by"],
            matchedPrefixLength: 5,
            closedSet: false,
            directionSensitive: true,
            openWildcard: false,
        });

        const result = await getCommandCompletion("play ", "forward", context);
        expect(result).toBeDefined();
        expect(result.directionSensitive).toBe(true);
    });

    it("propagates closedSet from cache through request handler", async () => {
        patchCacheCompletion({
            completions: ["by", "from"],
            matchedPrefixLength: 10,
            closedSet: true,
            openWildcard: true,
        });

        const result = await getCommandCompletion(
            "play hello",
            "forward",
            context,
        );
        expect(result).toBeDefined();
        expect(result.closedSet).toBe(true);
    });
});
