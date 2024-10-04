// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ArgDefinition,
    ArgDefinitions,
    DefaultValueDefinition,
    FlagDefinition,
    FlagDefinitions,
    FlagValuePrimitiveTypes,
    FullFlagDefinition,
    ParameterDefinitions,
} from "../command.js";

// Output Types

// ===============================
// Flags output types
// ===============================
type FlagDefaultValueType =
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
type FlagOutputType<T extends FlagDefinition> = T extends FullFlagDefinition
    ? // Base the type of the value on the default values if available.
      T["default"] extends FlagDefaultValueType
        ? FlagValueTypeFromValue<Writeable<T["default"]>>
        : // Base the value on the type name literal, and value is undefined not flag is not specified
          T["multiple"] extends true
          ? FlagValueTypeFromLiteral<T["type"]>[] | undefined
          : FlagValueTypeFromLiteral<T["type"]> | undefined
    : FlagValueTypeFromValue<T>;

type FlagsOutput<T extends FlagDefinitions | undefined> =
    T extends FlagDefinitions
        ? {
              [P in keyof T]: FlagOutputType<T[P]>;
          }
        : undefined;

// ===============================
// Arg output types
// ===============================
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

function getTypeFromValue(key: string, value?: FlagDefaultValueType) {
    if (value === undefined) {
        return "string";
    }
    if (Array.isArray(value)) {
        const element = value[0];
        if (Array.isArray(element)) {
            throw new Error(`Invalid nested array value for ${key}`);
        }
        return getTypeFromValue(key, element);
    }

    return typeof value as "string" | "number" | "boolean";
}

function isFullFlagDefinition(def: FlagDefinition): def is FullFlagDefinition {
    return typeof def === "object" && !Array.isArray(def);
}

function expandFlagDefinition(key: string, def: FlagDefinition) {
    const full = isFullFlagDefinition(def) ? def : undefined;
    const value = full?.default ?? (def as DefaultValueDefinition);
    return {
        multiple: full?.multiple ?? Array.isArray(value),
        type: full?.type ?? getTypeFromValue(key, value),
        default: value,
    } as FullFlagDefinition;
}

export function resolveFlag(
    definitions: FlagDefinitions,
    flag: string,
): FullFlagDefinition | undefined {
    if (flag.startsWith("--")) {
        const key = flag.substring(2);
        const def = definitions[key];
        if (def === undefined) {
            return def;
        }
        return expandFlagDefinition(key, def);
    }
    const alias = flag.substring(1);
    for (const [key, def] of Object.entries(definitions)) {
        if (isFullFlagDefinition(def) && def?.char === alias) {
            return expandFlagDefinition(key, def);
        }
    }
}

function parseIntParameter(
    valueStr: string,
    kind: "flag" | "argument",
    name: string,
) {
    const value = parseInt(valueStr);
    if (value.toString() !== valueStr) {
        throw new Error(
            `Invalid number value '${valueStr}' for ${kind} '${name}'`,
        );
    }
    return value;
}

export function splitParams(params: string) {
    const split = params.match(/"[^"]+"|\S+/g) ?? [];
    return split.map((s) => s.replace(/^"|"$/g, ""));
}

export function parseParams<T extends ParameterDefinitions>(
    request: string,
    parameters: T,
): ParsedCommandParams<T> {
    const parsedFlags: any = {};
    const aliases = new Map<string, string>();
    const valueTypes = new Map<string, "string" | "number" | "boolean">();
    const allowMultiple = new Map<string, boolean>();
    const flagDefs = parameters.flags;
    if (flagDefs) {
        for (const [key, value] of Object.entries(flagDefs)) {
            if (isFullFlagDefinition(value)) {
                if (value.char !== undefined) {
                    if (aliases.has(value.char)) {
                        throw new Error(`Duplicate alias: ${value.char}`);
                    }
                    aliases.set(value.char, key);
                }
                parsedFlags[key] = value.default;
                allowMultiple.set(
                    key,
                    value.multiple ?? Array.isArray(value.default),
                );
                valueTypes.set(
                    key,
                    value.type ?? getTypeFromValue(key, value.default),
                );
            } else {
                parsedFlags[key] = value;
                allowMultiple.set(key, Array.isArray(value));
                valueTypes.set(key, getTypeFromValue(key, value));
            }
        }
    }

    // split the command line arguments by spaces respecting quotes
    const strip = splitParams(request);
    let argDefIndex = 0;
    const argDefs =
        parameters.args !== undefined
            ? Object.entries(parameters.args)
            : undefined;
    const parsedArgs: any = {};
    for (let i = 0; i < strip.length; i++) {
        const arg = strip[i];
        let flag: string | undefined;
        if (arg.startsWith("--")) {
            flag = arg.substring(2);
            if (flag.endsWith("-")) {
                flag = flag.substring(0, flag.length - 1);
            }
            if (!parsedFlags.hasOwnProperty(flag)) {
                throw new Error(`Invalid flag '${arg}'`);
            }
        } else if (arg.startsWith("-")) {
            const alias = arg.substring(1);
            flag = aliases.get(alias);
            if (flag === undefined) {
                throw new Error(`Invalid flag '${arg}'`);
            }
        }

        if (flag === undefined) {
            if (argDefs === undefined || argDefIndex >= argDefs.length) {
                throw new Error(`Too many arguments '${arg}'`);
            }
            const [name, argDef] = argDefs[argDefIndex];
            const argValue =
                argDef.type === "number"
                    ? parseIntParameter(arg, "argument", name)
                    : arg;
            if (argDef.multiple !== true) {
                argDefIndex++;
                parsedArgs[name] = argValue;
            } else {
                // TODO: currently only support multiple for the last argument. Define have a way to terminate multiple
                if (parsedArgs[name] === undefined) {
                    parsedArgs[name] = [argValue];
                } else {
                    parsedArgs[name].push(argValue);
                }
            }
            continue;
        }

        const valueType = valueTypes.get(flag);
        let value: FlagDefaultValueType;
        if (valueType === "boolean") {
            value = true;
        } else {
            const valueStr = i === strip.length - 1 ? undefined : strip[++i];
            if (valueStr === undefined || valueStr.startsWith("--")) {
                throw new Error(`Missing value for flag '${arg}'`);
            }
            if (valueType === "number") {
                value = parseIntParameter(valueStr, "flag", arg);
            } else {
                value = valueStr;
            }
        }
        const multiple = allowMultiple.get(flag);
        if (multiple) {
            if (parsedFlags[flag] === undefined) {
                parsedFlags[flag] = [value];
            } else {
                parsedFlags[flag].push(value);
            }
        } else {
            parsedFlags[flag] = value;
        }
    }

    if (argDefs !== undefined) {
        if (argDefIndex !== argDefs.length) {
            for (let i = argDefIndex; i < argDefs.length; i++) {
                const [name, argDef] = argDefs[i];
                if (argDef.optional === true) {
                    continue;
                }
                if (
                    argDef.multiple === true &&
                    parsedArgs[name] !== undefined
                ) {
                    continue;
                }
                throw new Error(`Missing argument '${name}'`);
            }
        }
    }
    return {
        args: argDefs !== undefined ? parsedArgs : undefined,
        flags: flagDefs !== undefined ? parsedFlags : undefined,
    };
}
