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
import registerDebug from "debug";
import { Entity } from "@typeagent/agent-sdk";
const debugActionEntities = registerDebug(
    "typeagent:dispatcher:actions:entities",
);

type EntitySelection = {
    name: string;
    index: number;
    reason: "same" | "category" | string;
};
type EntitySelections = {
    selections: EntitySelection[];
};

export type DispatcherResolveEntityResult = {
    match: "exact" | "same" | "category" | "fuzzy";
    entities: Entity[];
};

export async function filterEntitySelection(
    action: FullAction,
    type: string,
    name: string,
    result: DispatcherResolveEntityResult,
) {
    const selectionSchema = sc.type(
        "EntitySelections",
        sc.obj({
            selections: sc.array(
                sc.obj({
                    name: sc.field(
                        sc.string(
                            ...new Set(
                                result.entities.map((e) => e.name),
                            ).values(),
                        ),
                        `Name of a '${type}' entity that '${name}' could mean from the list of '${type}' entities.`,
                    ),
                    index: sc.field(
                        sc.number(),
                        `The index of the '${type}' entity`,
                    ),
                    reason: sc.field(
                        sc.union(
                            sc.string("same"),
                            sc.string("category"),
                            sc.string("similar"),
                            sc.string(),
                        ),
                        [
                            "reason for selection:",
                            `- same: the name and '${name}' refer to the same entity`,
                            `- category: the name is a category that includes '${name}'`,
                            `- similar: the name has common characteristics to '${name}'`,
                        ],
                    ),

                    explanation: sc.field(
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
        validate(jsonObject: unknown): Result<EntitySelections> {
            try {
                validateType(selectionSchema.type, jsonObject);
                return success(jsonObject as EntitySelections);
            } catch (e: any) {
                return error(e.message);
            }
        },
    };
    const translator = createJsonTranslatorWithValidator<EntitySelections>(
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
        const same: EntitySelection[] = [];
        const categories: EntitySelection[] = [];
        const others: EntitySelection[] = [];
        for (const selection of selectionResult.data.selections) {
            switch (selection.reason) {
                case "same":
                    same.push(selection);
                    break;
                case "category":
                    categories.push(selection);
                    break;
                default:
                    others.push(selection);
                    break;
            }
        }
        if (same.length > 0) {
            result.match = "same";
            result.entities = same.map(
                // TODO: Should we use the index here? Probably need the translation to validate the index to match the name.
                (selection) =>
                    result.entities.find((e) => e.name === selection.name)!,
            );
        } else if (categories.length > 0) {
            result.match = "category";
            result.entities = categories.map(
                // TODO: Should we use the index here? Probably need the translation to validate the index to match the name.
                (selection) =>
                    result.entities.find((e) => e.name === selection.name)!,
            );
        } else {
            result.match = "fuzzy";
            result.entities = others.map(
                // TODO: Should we use the index here? Probably need the translation to validate the index to match the name.
                (selection) =>
                    result.entities.find((e) => e.name === selection.name)!,
            );
        }
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
