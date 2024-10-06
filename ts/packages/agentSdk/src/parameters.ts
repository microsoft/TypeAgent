// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//===========================================
// Parameter definitions
//===========================================
export type FlagValuePrimitiveTypes = string | number | boolean;
type FlagValueLiteral<T extends FlagValuePrimitiveTypes> = T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : "string";

type SingleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
    description: string;
    multiple?: false;
    char?: string;
    type?: FlagValueLiteral<T>;
    default?: T;
};

type MultipleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
    description: string;
    multiple: true;
    char?: string;
    type?: FlagValueLiteral<T>;
    default?: readonly T[];
};

type FlagDefinitionT<T extends FlagValuePrimitiveTypes> = T extends boolean
    ? SingleFlagDefinition<T>
    : SingleFlagDefinition<T> | MultipleFlagDefinition<T>;

export type FlagDefinition = FlagDefinitionT<FlagValuePrimitiveTypes>;

export type FlagDefinitions = Record<string, FlagDefinition>;

// Arguments
export type ArgDefinition = {
    description: string;
    type?: "string" | "number";
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
export type FlagValueTypes =
    | string
    | number
    | boolean
    | readonly string[]
    | readonly number[];

type FlagValueTypeFromLiteral<
    T extends "string" | "number" | "boolean" | undefined,
> = T extends "number" ? number : T extends "boolean" ? boolean : string;

type FlagValueTypeFromValue<T> = T extends never[]
    ? string[]
    : T extends Array<infer Item extends FlagValuePrimitiveTypes>
      ? FlagValueTypeFromValue<Item>[]
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
type ArgTypeFromLiteral<T extends "number" | "string" | undefined> =
    T extends "number" ? number : string;

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
};
