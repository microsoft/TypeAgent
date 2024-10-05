// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ArgDefinition,
    ArgDefinitions,
    FlagDefinition,
    FlagDefinitions,
    FlagValuePrimitiveTypes,
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
type FlagOutputType<T extends FlagDefinition> =
    T["default"] extends FlagDefaultValueType
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

function getTypeFromValue(value?: FlagDefaultValueType) {
    if (value === undefined) {
        return "string";
    }
    if (Array.isArray(value)) {
        const element = value[0];
        if (Array.isArray(element)) {
            throw new Error(
                `Invalid nested array default value for flag definition`,
            );
        }
        return getTypeFromValue(element);
    }

    return typeof value as "string" | "number" | "boolean";
}

export function getFlagMultiple(def: FlagDefinition) {
    return def.multiple ?? Array.isArray(def.default);
}
export function getFlagType(def: FlagDefinition) {
    return def.type ?? getTypeFromValue(def.default);
}

export function resolveFlag(
    definitions: FlagDefinitions,
    flag: string,
): [string, FlagDefinition] | undefined {
    if (flag.startsWith("--")) {
        const key = flag.substring(2);
        const def = definitions[key];
        return def !== undefined ? [key, def] : undefined;
    }
    if (flag.startsWith("-")) {
        const alias = flag.substring(1);
        for (const [key, def] of Object.entries(definitions)) {
            if (def?.char === alias) {
                return [key, def];
            }
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

function stripQuoteFromTerm(term: string) {
    if (term.length !== 0 && (term[0] === "'" || term[0] === '"')) {
        const lastChar = term[term.length - 1];
        if (term.length === 1 || lastChar !== term[0]) {
            return term.substring(1);
        }
        return term.substring(1, term.length - 1);
    }
    return term;
}

export function parseParams<T extends ParameterDefinitions>(
    parameters: string,
    paramDefs: T,
): ParsedCommandParams<T> {
    let curr = parameters.trim();
    const nextTerm = () => {
        if (curr.length === 0) {
            return undefined;
        }
        const quote = curr[0];
        let term;
        if (quote === "'" || quote === '"') {
            let end = 0;
            while (true) {
                end = curr.indexOf(quote, end + 1);
                if (end === -1) {
                    term = curr;
                    curr = "";
                    break;
                }
                if (curr[end - 1] !== "\\") {
                    term = curr.substring(0, end + 1);
                    curr = curr.substring(end + 1).trim();
                    break;
                }
            }
        } else {
            const result = curr.match(/^\s*\S+/);
            if (result === null || result.length !== 1) {
                return undefined;
            }
            term = result[0].trim();
            curr = curr.substring(result[0].length).trim();
        }
        return term;
    };
    const flagDefs = paramDefs.flags;
    const argDefs =
        paramDefs.args !== undefined
            ? Object.entries(paramDefs.args)
            : undefined;
    const parsedFlags: any = {};
    const parsedArgs: any = {};
    let argDefIndex = 0;
    while (true) {
        // Save the rest for implicit quote arguments;
        const rest = curr;
        const next = nextTerm();
        if (next === undefined) {
            break;
        }
        const flagInfo = flagDefs ? resolveFlag(flagDefs, next) : undefined;
        if (flagInfo !== undefined) {
            const [name, flag] = flagInfo;
            const valueType = getFlagType(flag);
            let value: FlagDefaultValueType;
            if (valueType === "boolean") {
                value = true;
            } else {
                const valueStr = nextTerm();
                if (valueStr === undefined || valueStr.startsWith("--")) {
                    throw new Error(`Missing value for flag '${next}'`);
                }
                const stripped = stripQuoteFromTerm(valueStr);
                if (valueType === "number") {
                    value = parseIntParameter(stripped, "flag", next);
                } else {
                    value = stripped;
                }
            }
            const multiple = getFlagMultiple(flag);
            if (multiple) {
                if (parsedFlags[name] === undefined) {
                    parsedFlags[name] = [value];
                } else {
                    parsedFlags[name].push(value);
                }
            } else {
                if (parsedFlags[name] !== undefined) {
                    throw new Error(`Duplicate flag '${next}'`);
                }
                parsedFlags[name] = value;
            }
        } else {
            if (next.startsWith("-")) {
                throw new Error(`Invalid flag '${next}'`);
            }
            if (argDefs === undefined || argDefIndex >= argDefs.length) {
                throw new Error(`Too many arguments '${next}'`);
            }
            const [name, argDef] = argDefs[argDefIndex];

            let arg = stripQuoteFromTerm(next);
            if (argDef.implicitQuotes === true && arg === next) {
                arg = rest; // take the rest of the parameters
                curr = "";
            }
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
        }
    }

    if (flagDefs !== undefined) {
        // Fill in default values
        for (const [name, flagDef] of Object.entries(flagDefs)) {
            if (
                parsedFlags[name] === undefined &&
                flagDef.default !== undefined
            ) {
                parsedFlags[name] = flagDef.default;
            }
        }
    }
    if (argDefs !== undefined) {
        // Detect missing arguments
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
