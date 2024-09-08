// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface Entity {
    // the name of the entity such as "Bach" or "frog"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];

    additionalEntityText?: string;
    uniqueId?: string;
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

export interface TurnImpression {
    literalText?: string | undefined;
    entities: Entity[];
    relationships?: Relationship[] | undefined;
    displayText: string;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    error?: string | undefined;
}

export function createTurnImpressionFromDisplay(
    displayText: string,
    literalText?: string,
): TurnImpression {
    return {
        literalText,
        entities: [],
        displayText,
    };
}

export function createTurnImpressionFromError(error: string): TurnImpression {
    return {
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
