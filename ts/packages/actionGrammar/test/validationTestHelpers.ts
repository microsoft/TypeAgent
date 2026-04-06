// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaCreator } from "@typeagent/action-schema";
import type { SchemaLoader } from "../src/grammarCompiler.js";
import type { SchemaTypeDefinition } from "@typeagent/action-schema";

// PlayAction: { actionName: "play"; trackName: string }
export const PlayActionDef: SchemaTypeDefinition = SchemaCreator.intf(
    "PlayAction",
    SchemaCreator.obj({
        actionName: SchemaCreator.field(SchemaCreator.string("play")),
        trackName: SchemaCreator.field(SchemaCreator.string()),
    }),
    undefined,
    true,
);

// PauseAction: { actionName: "pause" }
export const PauseActionDef: SchemaTypeDefinition = SchemaCreator.intf(
    "PauseAction",
    SchemaCreator.obj({
        actionName: SchemaCreator.field(SchemaCreator.string("pause")),
    }),
    undefined,
    true,
);

const typeRegistry = new Map<string, SchemaTypeDefinition>([
    ["PlayAction", PlayActionDef],
    ["PauseAction", PauseActionDef],
]);

export const mockSchemaLoader: SchemaLoader = (
    typeName: string,
): SchemaTypeDefinition | undefined => {
    return typeRegistry.get(typeName);
};
