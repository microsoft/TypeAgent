// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonObject,
    PartialDeep,
    UndefinedOnPartialDeep,
} from "type-fest";

//===========================================
// Parameter definitions
//===========================================
export type ObjectValue = JsonObject;
type FlagDefinitionValueTypes = string | number | boolean | ObjectValue;

type FlagValueLiteral<T extends FlagDefinitionValueTypes> =
    T extends ObjectValue
        ? "json"
        : T extends number
          ? "number"
          : T extends boolean
            ? "boolean"
            : "string";

type SingleFlagDefinition<T extends FlagDefinitionValueTypes> = {
    description: string;
    multiple?: false;
    char?: string;
    type?: FlagValueLiteral<T>; // default is the type of the default value, or "string" if no default value
    default?: T;
};

type MultipleFlagDefinition<T extends FlagDefinitionValueTypes> = {
    description: string;
    multiple: true;
    char?: string;
    type?: FlagValueLiteral<T>; // default is the type of the default value, or "string" if no default value
    default?: readonly T[];
};

type FlagDefinitionT<T extends FlagDefinitionValueTypes> = T extends boolean
    ? SingleFlagDefinition<T>
    : SingleFlagDefinition<T> | MultipleFlagDefinition<T>;

export type FlagDefinition = FlagDefinitionT<FlagDefinitionValueTypes>;

export type FlagDefinitions = Record<string, FlagDefinition>;

// Arguments
export type ArgDefinition = {
    description: string;
    type?: "string" | "number" | "json"; // default is "string"
    optional?: boolean;
    multiple?: boolean;
    implicitQuotes?: boolean; // implicitly assume there are quotes and take the whole string as the argument
};

export type ArgDefinitions = Record<string, ArgDefinition>;

export type ParameterDefinitions = {
    flags?: FlagDefinitions;
    args?: ArgDefinitions;
};

//================================================
// Output types
//================================================

// -------------------------------
// Flags output types
// -------------------------------
// All possible type of flag values
export type FlagValueTypes =
    | FlagDefinitionValueTypes
    | readonly string[]
    | readonly number[]
    | readonly ObjectValue[];

// For converting the type name to the actual type
type FlagValueTypeFromLiteral<
    T extends "json" | "string" | "number" | "boolean" | undefined,
> = T extends "json"
    ? ObjectValue
    : T extends "number"
      ? number
      : T extends "boolean"
        ? boolean
        : string;

// For infering the type based on the default value
type FlagValueTypeFromValue<T> = T extends never[]
    ? string[]
    : T extends Array<infer Item extends FlagValueTypes>
      ? FlagValueTypeFromValue<Item>[]
      : T extends object
        ? ObjectValue
        : T extends number
          ? number
          : T extends boolean
            ? boolean
            : T extends string
              ? string
              : T extends undefined
                ? string | undefined
                : never;

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
type FlagOutputType<T extends FlagDefinition> =
    T["default"] extends FlagValueTypes
        ? FlagValueTypeFromValue<Writeable<T["default"]>>
        : // Base the value on the type name literal, and value is undefined not flag is not specified
          T["multiple"] extends true
          ? FlagValueTypeFromLiteral<T["type"]>[] | undefined
          : FlagValueTypeFromLiteral<T["type"]> | undefined;

type FlagsOutput<T extends FlagDefinitions | undefined> =
    T extends FlagDefinitions
        ? {
              [P in keyof T]: FlagOutputType<T[P]>;
          }
        : undefined;

// -------------------------------
// Arg output types
// -------------------------------
type ArgTypeFromLiteral<T extends "number" | "string" | "json" | undefined> =
    T extends "json" ? ObjectValue : T extends "number" ? number : string;

type ArgOutputType<T extends ArgDefinition> = T["multiple"] extends true
    ? T["optional"] extends true
        ? ArgTypeFromLiteral<T["type"]>[] | undefined
        : ArgTypeFromLiteral<T["type"]>[]
    : T["optional"] extends true
      ? ArgTypeFromLiteral<T["type"]> | undefined
      : ArgTypeFromLiteral<T["type"]>;

type ArgsOutput<T extends ArgDefinitions | undefined> = T extends ArgDefinitions
    ? {
          [P in keyof T]: ArgOutputType<T[P]>;
      }
    : undefined;

export type ParsedCommandParams<T extends ParameterDefinitions> = {
    args: ArgsOutput<T["args"]>;
    flags: FlagsOutput<T["flags"]>;
    tokens: string[];
    nextArgs: string[];
};

export type PartialParsedCommandParams<T extends ParameterDefinitions> =
    UndefinedOnPartialDeep<PartialDeep<ParsedCommandParams<T>>>;
