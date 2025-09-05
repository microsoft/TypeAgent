// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ParamSpec } from "action-schema";
import { ImplicitParameter, WildcardMode } from "./constructions.js";
import { ParamValueType } from "../explanation/requestAction.js";
import { TransformEntityRecord } from "./transforms.js";

// Represent a set of strings that can be matched in a construction part.
export type MatchSetJSON = {
    matches: string[]; // The list of strings in the match set.

    // `${basename}_${index}` has to be unique within a cache, this is used for display and serialization

    // If canBeMerged is true, then the match set will be matched with an existing match set that has the same basename/namespace
    basename: string;
    index: number;

    // Control how a match set is reused when new construction is added to the cache.
    // A match set is reused only if the name+namespace matches.
    // If canBeMerged is false, then the content of the matches must match as well.
    canBeMerged: boolean;
    namespace?: string | undefined;
};

export type TransformInfoJSON = {
    // The namespace in the transform table, determine how the string to value mapping is shared.
    // Currently, either `${schemaName}` or `${schemaName}.${actionName}`
    readonly namespace: string;

    // The property name of the transform without action index.
    // 'fullActionName' (i.e. '${schemaName}.${actionName}')
    // 'parameters.${name}'
    readonly transformName: string;

    // For multi-actions, the action index to prepend to the property name when applying property value.
    readonly actionIndex?: number | undefined;
};

// Represent match set part in a construction
export type MatchPartJSON = {
    // The full name of the match set: `${basename}_${index}`
    matchSet: string;
    // Whether the part is optional
    optional?: true | undefined;

    // If the part can match wildcard (i.e. '.*'). Default is disabled. WildcardMode value indicates whether wildcard is entity or checked.
    wildcardMode?: WildcardMode | undefined;

    // If present, the matched string will be transformed to a property value in the resulting object.
    transformInfos?: TransformInfoJSON[] | undefined;
};

// Represent a parsable part in a construction
export type ParsePartJSON = {
    // The property name for the parsed value.
    propertyName: string;
    // The name of the parser.  See 'propertyParser.ts' for the list of supported parsers.
    parserName: ParamSpec;
};

export type ConstructionPartJSON = MatchPartJSON | ParsePartJSON;

export type ConstructionJSON = {
    // A list of part of the construction that will be matched in sequence.
    parts: ConstructionPartJSON[];

    // List of property names that are needs to be filled with an empty array.
    emptyArrayParameters?: string[];

    // List of implicit parameters that will be added to the resulting object.
    implicitParameters?: ImplicitParameter[];

    // The implicit action name if the request doesn't have a substring that maps to the action, but implies an action as a whole
    implicitActionName?: string;
};

export const constructionCacheJSONVersion = 3;
export type ConstructionCacheJSON = {
    // The version of the construction cache format.  (See 'constructionCacheJSONVersion')
    version: number;

    // The explainer name that generated the construction cache.
    explainerName: string;

    // The list of match sets in the cache.
    matchSets: MatchSetJSON[];

    // The list of constructions in the cache, organized by namespace.
    constructionNamespaces: {
        // '${schemaName},${schemaFileHash},${activityName}' or for multiple actions '${schemaName},${schemaFileHash},${activityName}|${schemaName},${schemaFileHash},${activityName}|...' where the schemaName is sorted.
        name: string;
        constructions: ConstructionJSON[];
    }[];

    // Global transform table, referenced by transformInfo in MatchPartJSON
    transformNamespaces: {
        name: string;
        transforms: TransformsJSON;
    }[];
};

type TransformValueRecordJSON = {
    value: ParamValueType;
    count: number;
    conflicts?: [ParamValueType, number][] | undefined;
};

export type TransformRecordJSON =
    | TransformEntityRecord
    | TransformValueRecordJSON;
export type TransformsJSON = {
    name: string;
    transform: [string, TransformRecordJSON][];
}[];
