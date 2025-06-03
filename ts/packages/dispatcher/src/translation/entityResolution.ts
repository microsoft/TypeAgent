// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateSchemaTypeDefinition,
    SchemaCreator as sc,
    validateType,
} from "action-schema";
import { Result, success, error } from "typechat";
import { createJsonTranslatorWithValidator } from "common-utils";

import { FullAction } from "agent-cache";
import { ResolveEntityResult } from "@typeagent/agent-sdk";
import registerDebug from "debug";
const debugActionEntities = registerDebug(
    "typeagent:dispatcher:actions:entities",
);

type EntitySelection = {
    selections: {
        name: string;
        index: number;
    }[];
};

export async function filterEntitySelection(
    action: FullAction,
    type: string,
    name: string,
    result: ResolveEntityResult,
) {
    const selectionSchema = sc.type(
        "EntitySelection",
        sc.obj({
            selections: sc.array(
                sc.obj({
                    name: sc.field(
                        sc.string(...result.entities.map((e) => e.name)),
                        `Name of a '${type}' entity that '${name}' could mean from the list of '${type}' entities.`,
                    ),
                    index: sc.field(
                        sc.number(),
                        `The index of the '${type}' entity`,
                    ),
                    reason: sc.field(
                        sc.string(),
                        `Explain why '${name}' could mean the selected entity`,
                    ),
                }),
            ),
        }),
    );
    const validator = {
        getSchemaText: () => generateSchemaTypeDefinition(selectionSchema),
        getTypeName: () => "EntitySelection",
        validate(jsonObject: unknown): Result<EntitySelection> {
            try {
                validateType(selectionSchema.type, jsonObject);
                return success(jsonObject as EntitySelection);
            } catch (e: any) {
                return error(e.message);
            }
        },
    };
    const translator = createJsonTranslatorWithValidator<EntitySelection>(
        validator.getTypeName().toLowerCase(),
        validator,
    );

    // REVIEW: do we need to specify the parameter name and not just the value?
    const selectionResult = await translator.translate(
        [
            `Select the '${type.toLowerCase()}' entities that '${name}' in the user requested action could refer to.`,
            "The user requested is",
            JSON.stringify(action, undefined, 2),
            `The following possible '${type}' entities:`,
            JSON.stringify(
                result.entities.map((entity, index) => {
                    return { index, name: entity.name };
                }),
                undefined,
                2,
            ),
        ].join("\n"),
    );

    if (
        selectionResult.success &&
        selectionResult.data.selections.length !== 0
    ) {
        debugActionEntities(
            `Filtered entity selection: ${JSON.stringify(selectionResult.data)}`,
        );
        result.entities = selectionResult.data.selections.map(
            // TODO: Should we use the index here? Probably need the translation to validate the index to match the name.
            (selection) =>
                result.entities.find((e) => e.name === selection.name)!,
        );
    } else {
        debugActionEntities(
            `No entity selection made, using all entities: ${JSON.stringify(
                selectionResult,
                undefined,
                2,
            )}`,
        );
    }
}
