// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ParamSpec =
    | "wildcard"
    | "checked_wildcard"
    | "entity_wildcard"
    | "number"
    | "percentage"
    | "ordinal"
    | "time"
    | "literal";

export type ActionParamSpecs = Record<string, ParamSpec> | false;
export type CompletionEmojis = Record<string, string>; // Key is parameter/entity name, value is emoji string
export type SchemaConfig = {
    // Key is the action name.
    // If the value is false, then explanation/caching is disabled.
    // Otherwise, the value is an object where the key is the parameter name, and the value the one of the ParamSpec above.
    paramSpec?: Record<string, ActionParamSpecs>;

    paramCompletionEmojis?: Record<string, CompletionEmojis>; // Key is action name
    entityCompletionEmojis?: Record<string, CompletionEmojis>; // Key is entity type name

    // separate the cache by action name
    actionNamespace?: boolean; // default to false
};
