// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface Entity {
    // the name of the entity such as "Bach" or "frog"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];
    // a value associated with the entity such as { birthYear: 1685 } for "Bach" or { destination: "Paris" } for "flight"
    value?: object;
    interpreter?: ImpressionInterpreter | undefined;
}

export type AssociationType = string;

export type ProximityType =
    | "temporal"
    | "spatial"
    | "conceptual"
    | "functional"
    | string;

export type StrengthType = "strong" | "moderate" | "weak";

export type Association = {
    type: AssociationType; // The type of relationship
    proximity?: ProximityType;
    strength?: StrengthType;
};

export interface Relationship {
    from: Entity;
    to: Entity;
    association: Association;
}

/**
 * Return the entity's id, if one exists
 * @param entity
 */
export function getEntityId(entity: Entity): string | undefined {
    return entity.interpreter?.getEntityId
        ? entity.interpreter.getEntityId(entity)
        : undefined;
}

export function entitiesToString(entities: Entity[], indent = ""): string {
    // entities in the format "name (type1, type2)"
    return entities
        .map((entity) => `${indent}${entity.name} (${entity.type.join(", ")})`)
        .join("\n");
}

export function turnImpressionToString(turnImpression: TurnImpression): string {
    if (turnImpression.error) {
        return `Error: ${turnImpression.error}`;
    } else {
        // add to result all non-empty fields of the turn impression, using entitiesToString for the entities
        const fields = Object.entries(turnImpression)
            .filter(([key, value]) => value && value.length > 0)
            .map(([key, value]) => {
                if (key === "entities") {
                    return `${key}:\n${entitiesToString(value, "  ")}`;
                }
                return `${key}: ${value}`;
            });
        return fields.join("\n");
    }
}

export const defaultImpressionInterpreter: ImpressionInterpreter = {
    entityToText: (entity) => `${entity.name} (${entity.type.join(", ")})`,
};

export interface ImpressionInterpreter {
    entityToText: (entity: Entity) => string;
    getEntityId?: (entity: Entity) => string | undefined;
}

export interface TurnImpression {
    literalText: string;
    entities: Entity[];
    relationships?: Relationship[] | undefined;
    displayText: string;
    error?: string;

    // REVIEW: this is not "remoteable", need to redesign to enable dispatcher agent isolation.
    impressionInterpreter?: ImpressionInterpreter;
}

export function createTurnImpressionFromDisplay(
    displayText: string,
): TurnImpression {
    return {
        literalText: "",
        entities: [],
        displayText,
    };
}

export function createTurnImpressionFromError(error: string): TurnImpression {
    return {
        literalText: "",
        entities: [],
        displayText: "",
        error,
    };
}

export function createTurnImpressionFromLiteral(
    literalText: string,
): TurnImpression {
    return {
        literalText,
        entities: [],
        displayText: literalText,
    };
}
