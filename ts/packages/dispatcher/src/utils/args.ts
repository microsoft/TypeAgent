// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type FlagValueBaseType = string | number | boolean;
type FlagValueLiteral<T extends FlagValueBaseType> = T extends number
    ? "number"
    : T extends boolean
      ? "boolean"
      : "string";

type BaseConfig = {
    multiple?: boolean;
    char?: string;
    type?: "string" | "number" | "boolean";
    default?: any;
};
interface Config<T extends FlagValueBaseType> extends BaseConfig {
    multiple?: false;
    type?: FlagValueLiteral<T>;
    default?: T;
}

interface MultiConfig<T extends FlagValueBaseType> extends BaseConfig {
    multiple?: true;
    type?: FlagValueLiteral<T>;
    default?: T[];
}

type FlagValueConfigT<T extends FlagValueBaseType> =
    | T
    | T[]
    | Config<T>
    | MultiConfig<T>;

type FlagValueConfig =
    | undefined // default to "string"
    | FlagValueConfigT<string>
    | FlagValueConfigT<number>
    | FlagValueConfigT<boolean>;

type FlagInput = {
    [key: string]: FlagValueConfig;
};

type FlagValueType =
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[];

type FlagValueTypeFromLiteral<
    T extends "string" | "number" | "boolean" | undefined,
> = T extends "number" ? number : T extends "boolean" ? boolean : string;

type FlagValueTypeFromValue<T> = T extends never[]
    ? string[]
    : T extends any[]
      ? FlagValueTypeFromValue<T[0]>[]
      : T extends number
        ? number
        : T extends boolean
          ? boolean
          : T extends string
            ? string
            : string | undefined;

type FlagOutputType<T extends FlagValueConfig> = T extends BaseConfig
    ? T["default"] extends FlagValueType | undefined
        ? FlagValueTypeFromValue<T["default"]>
        : T["multiple"] extends true
          ? FlagValueTypeFromLiteral<T["type"]>[] | undefined
          : FlagValueTypeFromLiteral<T["type"]> | undefined
    : FlagValueTypeFromValue<T>;

type FlagsOutput<T extends FlagInput> = {
    [P in keyof T]: FlagOutputType<T[P]>;
};

type ParseOutput<T extends FlagInput> = {
    args: string[];
    flags: FlagsOutput<T>;
};

function getTypeFromValue(key: string, value?: FlagValueType) {
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
export function parseCommandArgs<T extends FlagInput>(
    request: string,
    defaultFlags?: T,
    noArgs: boolean = false,
): ParseOutput<T> {
    const flags: any = {};
    const aliases = new Map<string, string>();
    const valueTypes = new Map<string, "string" | "number" | "boolean">();
    const allowMultiple = new Map<string, boolean>();
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
            if (noArgs) {
                throw new Error(`Invalid argument: ${arg}`);
            }
            args.push(arg);
            continue;
        }

        const valueType = valueTypes.get(flag);
        let value: FlagValueType;
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
    return { args, flags: flags as FlagsOutput<T> };
}
