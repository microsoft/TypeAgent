// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type CommandHandlerContext,
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { getCommandCompletion } from "../src/command/completion.js";

// ---------------------------------------------------------------------------
// Test: afterWildcard and directionSensitive propagation through the
// request handler path (bare text → requestCommandHandler.getCompletion
// → requestCompletion → agentCache.completion)
//
// Strategy: initialize a context, then monkey-patch agentCache.completion
// to return a controlled CompletionResult with afterWildcard and
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

    it('propagates afterWildcard="all" from cache through request handler', async () => {
        patchCacheCompletion({
            groups: [
                {
                    name: "Request Completions",
                    completions: ["by", "from"],
                    separatorMode: "spacePunctuation",
                },
            ],
            matchedPrefixLength: 10,
            closedSet: true,
            directionSensitive: true,
            afterWildcard: "all",
        });

        const result = await getCommandCompletion(
            "play hello",
            "forward",
            context,
        );
        expect(result).toBeDefined();
        expect(result.afterWildcard).toBe("all");
        expect(result.directionSensitive).toBe(true);
        expect(result.closedSet).toBe(true);
        expect(result.completions[0].separatorMode).toBe("spacePunctuation");
    });

    it('propagates afterWildcard="none" from cache through request handler', async () => {
        patchCacheCompletion({
            groups: [
                {
                    name: "Request Completions",
                    completions: ["music"],
                    separatorMode: "spacePunctuation",
                },
            ],
            matchedPrefixLength: 5,
            closedSet: true,
            directionSensitive: false,
            afterWildcard: "none",
        });

        const result = await getCommandCompletion("play ", "forward", context);
        expect(result).toBeDefined();
        expect(result.afterWildcard).toBe("none");
    });

    it('returns afterWildcard="none" when cache returns undefined', async () => {
        patchCacheCompletion(undefined);

        const result = await getCommandCompletion(
            "play hello",
            "forward",
            context,
        );
        expect(result).toBeDefined();
        expect(result.afterWildcard).toBe("none");
    });

    it("propagates directionSensitive through request handler", async () => {
        patchCacheCompletion({
            groups: [
                {
                    name: "Request Completions",
                    completions: ["by"],
                    separatorMode: "space",
                },
            ],
            matchedPrefixLength: 5,
            closedSet: false,
            directionSensitive: true,
            afterWildcard: "none",
        });

        const result = await getCommandCompletion("play ", "forward", context);
        expect(result).toBeDefined();
        expect(result.directionSensitive).toBe(true);
    });

    it("propagates closedSet from cache through request handler", async () => {
        patchCacheCompletion({
            groups: [
                {
                    name: "Request Completions",
                    completions: ["by", "from"],
                    separatorMode: "space",
                },
            ],
            matchedPrefixLength: 10,
            closedSet: true,
            afterWildcard: "all",
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
