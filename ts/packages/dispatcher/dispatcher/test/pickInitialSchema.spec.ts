// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Covers the translation-side commit of a registry-first contextSelector topical
// route (§11.4): `pickInitialSchema` pins the sibling schema and carries the U-2
// note ONLY when the route is actually honored — before embedding selection (so
// it works with embedding off) and behind the active-schema and fixed-schema
// guards. This is the "note is shown only when the route is committed" half of
// the fix; the matchCollision side (sets `pendingTopicalRoute`, no preemptive
// note) is covered in collisionMatch.spec.ts.

import { pickInitialSchema } from "../src/translation/translateRequest.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

const NOTE = "↪ routed to taskflow — recent topic";

function makeSysCtx(opts: {
    fixed?: string;
    embedding?: boolean;
    lastSchema?: string;
}): CommandHandlerContext {
    return {
        session: {
            getConfig: () => ({
                translation: {
                    switch: {
                        fixed: opts.fixed ?? "",
                        embedding: opts.embedding ?? false,
                    },
                },
                collision: {
                    llmSelect: {
                        detect: false,
                        topN: 3,
                        scoreDeltaThreshold: 0.05,
                        strategy: "first-match",
                    },
                    preference: {
                        registryFirst: false,
                        registryPath: "",
                        enabled: true,
                        ambiguitySource: "runtime",
                    },
                },
            }),
        },
        lastActionSchemaName: opts.lastSchema,
        agents: {
            semanticSearchActionSchema: async () => undefined,
        },
    } as unknown as CommandHandlerContext;
}

describe("pickInitialSchema — topical route commit (§11.4)", () => {
    it("honors an active topical route with embedding off and carries the note", async () => {
        const ctx = makeSysCtx({ embedding: false });
        const res = await pickInitialSchema(
            "send me the rundown",
            new Set(["taskflow"]),
            ctx,
            { schemaName: "taskflow", note: NOTE },
        );
        expect(res.kind).toBe("schema");
        if (res.kind === "schema") {
            // Pinned before embedding selection -> holds even with embedding off.
            expect(res.schemaName).toBe("taskflow");
            // The note rides along, to be shown at this committed point.
            expect(res.note).toBe(NOTE);
        }
    });

    it("lets a fixed initial schema override a topical route (no note)", async () => {
        const ctx = makeSysCtx({ fixed: "player" });
        const res = await pickInitialSchema(
            "play something",
            new Set(["player", "taskflow"]),
            ctx,
            { schemaName: "taskflow", note: NOTE },
        );
        expect(res.kind).toBe("schema");
        if (res.kind === "schema") {
            expect(res.schemaName).toBe("player");
            expect(res.note).toBeUndefined();
        }
    });

    it("ignores a topical route whose schema is inactive and shows no note", async () => {
        const ctx = makeSysCtx({ embedding: false, lastSchema: "browser" });
        const res = await pickInitialSchema(
            "send me the rundown",
            new Set(["browser"]), // taskflow is NOT active this turn
            ctx,
            { schemaName: "taskflow", note: NOTE },
        );
        expect(res.kind).toBe("schema");
        if (res.kind === "schema") {
            expect(res.schemaName).toBe("browser");
            expect(res.note).toBeUndefined();
        }
    });

    it("selects normally (no note) when there is no topical route", async () => {
        const ctx = makeSysCtx({ embedding: false, lastSchema: "browser" });
        const res = await pickInitialSchema(
            "do the thing",
            new Set(["browser"]),
            ctx,
        );
        expect(res.kind).toBe("schema");
        if (res.kind === "schema") {
            expect(res.schemaName).toBe("browser");
            expect(res.note).toBeUndefined();
        }
    });
});
