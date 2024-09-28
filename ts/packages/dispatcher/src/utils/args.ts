// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type FlagValuePrimitiveTypes = string | number | boolean;
type FlagValueLiteral<T extends FlagValuePrimitiveTypes> = T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : "string";

type SingleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
    multiple?: false;
    char?: string;
    type?: FlagValueLiteral<T>;
    default?: T;
};

type MultipleFlagDefinition<T extends FlagValuePrimitiveTypes> = {
    multiple: true;
    char?: string;
    type?: FlagValueLiteral<T>;
    default?: readonly T[];
};

type FlagDefinitionT<T extends FlagValuePrimitiveTypes> = T extends boolean
    ? SingleFlagDefinition<T>
    : SingleFlagDefinition<T> | MultipleFlagDefinition<T>;

type FullFlagDefinition = FlagDefinitionT<FlagValuePrimitiveTypes>;

// shorthand by only providing the default value, type and multiple is inferred.
type DefaultValueDefinition<T extends FlagValuePrimitiveTypes> =
    T extends boolean ? T : T | T[];

type FlagDefinition =
    | undefined // short hand for "string" flag without a default value
    | DefaultValueDefinition<FlagValuePrimitiveTypes>
    | FullFlagDefinition;

type FlagDefinitions = {
    [key: string]: FlagDefinition;
};

type ParameterDefinitions = {
    flags: FlagDefinitions;
    args?: boolean; // TODO: add more capabilities
};

// Output
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

type FlagsOutput<T extends FlagDefinitions> = {
    [P in keyof T]: FlagOutputType<T[P]>;
};

type ParsedCommandArgs<T extends ParameterDefinitions> = {
    args: string[];
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

export function parseCommandArgs<T extends ParameterDefinitions>(
    request: string,
    config?: T,
): ParsedCommandArgs<T> {
    const flags: any = {};
    const aliases = new Map<string, string>();
    const valueTypes = new Map<string, "string" | "number" | "boolean">();
    const allowMultiple = new Map<string, boolean>();
    const defaultFlags = config?.flags;
    if (defaultFlags) {
        for (const [key, value] of Object.entries(defaultFlags)) {
            if (typeof value === "object" && !Array.isArray(value)) {
                if (value.char !== undefined) {
                    if (aliases.has(value.char)) {
                        throw new Error(`Duplicate alias: ${value.char}`);
                    }
                    aliases.set(value.char, key);
                }
                flags[key] = value.default;
                allowMultiple.set(
                    key,
                    value.multiple ?? Array.isArray(value.default),
                );
                valueTypes.set(
                    key,
                    value.type ?? getTypeFromValue(key, value.default),
                );
            } else {
                flags[key] = value;
                allowMultiple.set(key, Array.isArray(value));
                valueTypes.set(key, getTypeFromValue(key, value));
            }
        }
    }

    // split the command line arguments by spaces respecting quotes
    const split = request.match(/"[^"]+"|\S+/g) ?? [];
    const strip = split.map((s) => s.replace(/^"|"$/g, ""));
    const args: string[] = [];
    for (let i = 0; i < strip.length; i++) {
        const arg = strip[i];
        let flag: string | undefined;
        if (arg.startsWith("--")) {
            flag = arg.substring(2);
            if (flag.endsWith("-")) {
                flag = flag.substring(0, flag.length - 1);
            }
            if (!flags.hasOwnProperty(flag)) {
                throw new Error(`Invalid flag: ${flag}`);
            }
        } else if (aliases.size !== 0 && arg.startsWith("-")) {
            const alias = arg.substring(1);
            flag = aliases.get(alias);
            if (flag === undefined) {
                throw new Error(`Invalid flag: ${alias}`);
            }
        }

        if (flag === undefined) {
            if (config?.args === false) {
                throw new Error(`Invalid argument: ${arg}`);
            }
            args.push(arg);
            continue;
        }

        const valueType = valueTypes.get(flag);
        let value: FlagDefaultValueType;
        if (valueType === "boolean") {
            value = true;
        } else {
            const valueStr = i === strip.length - 1 ? undefined : strip[++i];
            if (valueStr === undefined || valueStr.startsWith("--")) {
                throw new Error(`Missing value for flag: ${flag}`);
            }
            if (valueType === "number") {
                value = parseInt(valueStr);
                if (value.toString() !== valueStr) {
                    throw new Error(`Invalid number value for flag: ${flag}`);
                }
            } else {
                value = valueStr;
            }
        }
        const multiple = allowMultiple.get(flag);
        if (multiple) {
            if (flags[flag] === undefined) {
                flags[flag] = [value];
            } else {
                flags[flag].push(value);
            }
        } else {
            flags[flag] = value;
        }
    }

    return { args, flags };
}
