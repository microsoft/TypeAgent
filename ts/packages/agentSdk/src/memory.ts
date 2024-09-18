// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent } from "./display.js";

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

export type ActionResultError = {
    error: string;
};

export type ActionResultSuccessNoDisplay = {
    literalText?: string | undefined;
    displayContent?: undefined;
    entities: Entity[];
    relationships?: Relationship[] | undefined;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    error?: undefined;
};

export type ActionResultSuccess = {
    literalText?: string | undefined;
    displayContent: DisplayContent;
    entities: Entity[];
    relationships?: Relationship[] | undefined;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    error?: undefined;
};

export type ActionResult =
    | ActionResultSuccessNoDisplay
    | ActionResultSuccess
    | ActionResultError;
