// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "@jest/globals";
import type { SessionContext } from "@typeagent/agent-sdk";
import type { ActionParamType } from "@typeagent/action-schema";
import { getSystemTemplateSchema } from "../src/translation/actionTemplate.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

// ---------------------------------------------------------------------------
// getSystemTemplateSchema builds the editable action template used by the
// action-confirmation / proposeAction UI. It converts each action parameter's
// schema type into a TemplateType via toTemplateType. A parameter whose type
// is an enum-like `string-union` (e.g. `mode: "a" | "b"`) must produce a
// string-union template field instead of throwing `Unknown type string-union`.
// Types with no editable representation (any / true / false) must be skipped
// rather than aborting the whole template build.
// ---------------------------------------------------------------------------

const schemaName = "testSchema";
const actionName = "testAction";

function makeContext(parametersType: ActionParamType) {
    const actionSchema = {
        type: {
            type: "object",
            fields: {
                parameters: { type: parametersType },
            },
        },
    };
    const actionSchemas = new Map([[actionName, actionSchema]]);
    const actionSchemaFile = {
        parsedActionSchema: { actionSchemas },
    };
    const agents = {
        getActiveSchemas: () => [schemaName],
        tryGetActionSchemaFile: (name: string) =>
            name === schemaName ? actionSchemaFile : undefined,
    };
    const context = {
        agentContext: { agents },
    } as unknown as SessionContext<CommandHandlerContext>;
    return context;
}

const data = { schemaName, actionName };

describe("getSystemTemplateSchema toTemplateType", () => {
    it("maps a string-union parameter to a string-union template field", async () => {
        const parametersType: ActionParamType = {
            type: "object",
            fields: {
                mode: {
                    type: { type: "string-union", typeEnum: ["a", "b"] },
                },
            },
        } as unknown as ActionParamType;

        const template = await getSystemTemplateSchema(
            "action",
            data,
            makeContext(parametersType),
        );

        const parameters = template.fields.parameters?.type as any;
        expect(parameters?.type).toBe("object");
        expect(parameters.fields.mode.type).toEqual({
            type: "string-union",
            typeEnum: ["a", "b"],
        });
    });

    it("skips any / true / false parameters instead of throwing", async () => {
        const parametersType: ActionParamType = {
            type: "object",
            fields: {
                a: { type: { type: "any" } },
                t: { type: { type: "true" } },
                f: { type: { type: "false" } },
                keep: { type: { type: "string" } },
            },
        } as unknown as ActionParamType;

        const template = await getSystemTemplateSchema(
            "action",
            data,
            makeContext(parametersType),
        );

        const parameters = template.fields.parameters?.type as any;
        expect(Object.keys(parameters.fields)).toEqual(["keep"]);
    });
});

describe("getSystemTemplateSchema discriminated type-union", () => {
    function musicTargetUnion(): ActionParamType {
        const track = {
            type: "object",
            fields: {
                kind: {
                    type: { type: "string-union", typeEnum: ["track"] },
                },
                trackName: { type: { type: "string" } },
                artists: {
                    optional: true,
                    type: {
                        type: "array",
                        elementType: { type: "string" },
                    },
                },
            },
        };
        const artist = {
            type: "object",
            fields: {
                kind: {
                    type: { type: "string-union", typeEnum: ["artist"] },
                },
                artistName: { type: { type: "string" } },
            },
        };
        const album = {
            type: "object",
            fields: {
                kind: {
                    type: { type: "string-union", typeEnum: ["album"] },
                },
                albumName: { type: { type: "string" } },
            },
        };
        const playlist = {
            type: "object",
            fields: {
                kind: {
                    type: { type: "string-union", typeEnum: ["playlist"] },
                },
                playlistName: { type: { type: "string" } },
            },
        };
        return {
            type: "object",
            fields: {
                target: {
                    type: {
                        type: "type-union",
                        types: [track, artist, album, playlist],
                    },
                },
            },
        } as unknown as ActionParamType;
    }

    it("exposes full kind enum for MusicTarget-style discriminated unions", async () => {
        const template = await getSystemTemplateSchema(
            "action",
            {
                schemaName,
                actionName,
                parameters: {
                    target: { kind: "track", trackName: "Bohemian Rhapsody" },
                },
            },
            makeContext(musicTargetUnion()),
        );

        const parameters = template.fields.parameters?.type as any;
        const target = parameters.fields.target.type;
        expect(target.type).toBe("object");
        expect(target.fields.kind.type).toEqual({
            type: "string-union",
            typeEnum: ["track", "artist", "album", "playlist"],
            discriminator: "track",
        });
        expect(target.fields.trackName.type).toEqual({ type: "string" });
        expect(target.fields.artistName).toBeUndefined();
    });

    it("selects album arm fields when data.kind is album", async () => {
        const template = await getSystemTemplateSchema(
            "action",
            {
                schemaName,
                actionName,
                parameters: {
                    target: { kind: "album", albumName: "A Night at the Opera" },
                },
            },
            makeContext(musicTargetUnion()),
        );

        const target = (template.fields.parameters?.type as any).fields.target
            .type;
        expect(target.fields.kind.type.typeEnum).toEqual([
            "track",
            "artist",
            "album",
            "playlist",
        ]);
        expect(target.fields.kind.type.discriminator).toBe("album");
        expect(target.fields.albumName.type).toEqual({ type: "string" });
        expect(target.fields.trackName).toBeUndefined();
        expect(target.fields.playlistName).toBeUndefined();
    });

    it("keeps non-union object parameters unchanged", async () => {
        const parametersType: ActionParamType = {
            type: "object",
            fields: {
                query: { type: { type: "string" } },
            },
        } as unknown as ActionParamType;

        const template = await getSystemTemplateSchema(
            "action",
            { ...data, parameters: { query: "hello" } },
            makeContext(parametersType),
        );
        const parameters = template.fields.parameters?.type as any;
        expect(parameters.fields.query.type).toEqual({ type: "string" });
    });
});
