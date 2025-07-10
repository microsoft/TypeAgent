// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FlagValueTypes,
    ParameterDefinitions,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    getFlagMultiple,
    getFlagType,
    resolveFlag,
} from "@typeagent/agent-sdk/helpers/command";
import { setObjectProperty } from "common-utils";

function parseBooleanParameter(
    valueStr: string,
    kind: "flag" | "argument",
    name: string,
) {
    // Allow true/false or 1/0 as boolean values.
    const lower = valueStr.toLowerCase();
    if (lower === "true" || lower === "1") {
        return true;
    }
    if (lower === "false" || lower === "0") {
        return false;
    }

    // Caller can default the flag to true and roll back in this case.
    throw new Error(
        `Invalid boolean value '${valueStr}' for ${kind} '${name}'`,
    );
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

function parseJsonParameter(
    valueStr: string,
    kind: "flag" | "argument",
    name: string,
) {
    try {
        const v = JSON.parse(valueStr);
        if (v === null || typeof v !== "object") {
            throw new Error("Not an object");
        }
        return v;
    } catch (e: any) {
        throw new Error(
            `Invalid JSON value for ${kind} '${name}': ${e.message}`,
        );
    }
}

function stripQuoteFromToken(term: string) {
    if (term.length !== 0 && (term[0] === "'" || term[0] === '"')) {
        const lastChar = term[term.length - 1];
        if (term.length === 1 || lastChar !== term[0]) {
            return term.substring(1);
        }
        return term.substring(1, term.length - 1);
    }
    return term;
}

function invalidValueToken(valueToken: string) {
    // for strings, value that starts with '--' needs to be quoted.
    if (valueToken.startsWith("--")) {
        return true;
    }

    if (
        valueToken.length === 2 &&
        valueToken[0] === "-" &&
        valueToken.charCodeAt(1) < 48 /* "0" */ &&
        valueToken.charCodeAt(1) > 57 /* "9" */
    ) {
        return true;
    }
    return false;
}
function parseValueToken(
    flagToken: string,
    flag: string,
    parsedFlags: any,
    valueType: "boolean" | "string" | "number" | "json",
    valueToken?: string,
) {
    if (valueToken === undefined || invalidValueToken(valueToken)) {
        throw new Error(`Missing value for flag '${flagToken}'`);
    }

    // stripped any quotes
    const stripped = stripQuoteFromToken(valueToken);

    switch (valueType) {
        case "boolean":
            return parseBooleanParameter(stripped, "flag", flagToken);
        case "number":
            return parseIntParameter(stripped, "flag", flagToken);
        case "string":
            // It is a string, just return the value stripped of quote.
            return stripped;
        case "json":
            const prefix = `--${flag}.`;
            if (!flagToken.startsWith(prefix)) {
                // Full json object
                return parseJsonParameter(stripped, "flag", flagToken);
            }

            // Json object property
            const existing = parsedFlags[flag];
            if (Array.isArray(existing)) {
                throw new Error(
                    `Invalid flag '${flag}': multiple json value cannot use property syntax`,
                );
            }
            parsedFlags[flag] = undefined; // avoid duplicate flag error, this will be assigned back later
            const propertyName = flagToken.substring(prefix.length);
            const data = { obj: existing ?? {} };
            setObjectProperty(data, "obj", propertyName, stripped, true);
            return data.obj;
    }
}

export function parseParams<T extends ParameterDefinitions>(
    parameters: string,
    paramDefs: T,
    partial: boolean = false,
): ParsedCommandParams<T> {
    let curr = parameters.trim();
    const parsedTokens: string[] = [];
    const nextToken = () => {
        if (curr.length === 0) {
            return undefined;
        }
        const quote = curr[0];
        let token;
        if (quote === "'" || quote === '"') {
            let end = 0;
            while (true) {
                end = curr.indexOf(quote, end + 1);
                if (end === -1) {
                    token = curr;
                    curr = "";
                    break;
                }
                if (curr[end - 1] !== "\\") {
                    token = curr.substring(0, end + 1);
                    curr = curr.substring(end + 1).trim();
                    break;
                }
            }
        } else {
            const result = curr.match(/^\s*\S+/);
            if (result === null || result.length !== 1) {
                return undefined;
            }
            token = result[0].trim();
            curr = curr.substring(result[0].length).trim();
        }
        parsedTokens.push(token);
        return token;
    };
    const flagDefs = paramDefs.flags;
    const argDefs =
        paramDefs.args !== undefined
            ? Object.entries(paramDefs.args)
            : undefined;
    const parsedFlags: any = {};
    const parsedArgs: any = {};

    let argDefIndex = 0;
    let lastCompletableParam: string | undefined = undefined;
    let lastParamImplicitQuotes: boolean = false;
    let advanceMultiple = false;
    while (true) {
        try {
            // Save the rest for implicit quote arguments;
            const rest = curr;
            const next = nextToken();
            if (next === undefined) {
                break;
            }
            lastCompletableParam = undefined; // reset last param name
            const flagInfo = flagDefs ? resolveFlag(flagDefs, next) : undefined;
            if (flagInfo !== undefined) {
                if (advanceMultiple) {
                    // Detect a flag, that last multiple flag is terminated.
                    advanceMultiple = false;
                    argDefIndex++;
                }
                const [name, flag] = flagInfo;
                const valueType = getFlagType(flag);
                let value: FlagValueTypes;
                const rollback = curr;
                const valueToken = nextToken();

                try {
                    value = parseValueToken(
                        next,
                        name,
                        parsedFlags,
                        valueType,
                        valueToken,
                    );
                } catch (e) {
                    // rollback to continue with partial or default boolean value.
                    if (valueToken !== undefined) {
                        curr = rollback;
                        parsedTokens.pop();
                    }
                    if (valueType === "boolean") {
                        // default to true if not specified or next value isn't valid for boolean
                        value = true;
                    } else {
                        // Continue with partial parsing
                        throw e;
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
                if (valueType === "string") {
                    lastCompletableParam = `--${name}`;
                    lastParamImplicitQuotes = false;
                }
            } else {
                if (next === "--") {
                    // '--' is used to separate arguments or flags when necessary.
                    // e.g.
                    // - separate boolean flags from arguments that look like boolean values. (true/false or 1/0)
                    // - separate multiple arguments to the next argument.

                    if (advanceMultiple) {
                        // Explicit termination of the last multiple argument.
                        advanceMultiple = false;
                        argDefIndex++;
                    }
                    continue;
                }
                if (next.startsWith("-")) {
                    // Quote is needed if it is an actual argument value similar to a flag.
                    throw new Error(`Invalid flag '${next}'`);
                }
                if (argDefs === undefined || argDefIndex >= argDefs.length) {
                    throw new Error(`Too many arguments '${next}'`);
                }
                const [name, argDef] = argDefs[argDefIndex];

                let arg = stripQuoteFromToken(next);
                if (argDef.implicitQuotes === true && arg === next) {
                    parsedTokens.pop();
                    parsedTokens.push(rest);
                    arg = rest; // take the rest of the parameters
                    curr = "";
                }
                const argType = argDef.type ?? "string";
                const argValue =
                    argType === "number"
                        ? parseIntParameter(arg, "argument", name)
                        : argType === "json"
                          ? parseJsonParameter(arg, "argument", name)
                          : argType === "boolean"
                            ? parseBooleanParameter(arg, "argument", name)
                            : arg;

                if (argDef.multiple !== true) {
                    argDefIndex++;
                    parsedArgs[name] = argValue;
                } else {
                    // Indicate that we are in a multiple argument, and should advance the arg index
                    // if we found a flag or '--' terminator.
                    advanceMultiple = true;
                    if (parsedArgs[name] === undefined) {
                        parsedArgs[name] = [argValue];
                    } else {
                        parsedArgs[name].push(argValue);
                    }
                }
                if (argType === "string") {
                    lastCompletableParam = name;
                    lastParamImplicitQuotes = argDef.implicitQuotes ?? false;
                }
            }
        } catch (e: any) {
            if (!partial) {
                // Ignore error when partial
                throw e;
            }
        }
    }

    // Default values and missing arguments doesn't matter for partial parsing
    if (!partial) {
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
    }
    let nextArgs: string[] = [];
    if (argDefs !== undefined) {
        // Detect missing arguments
        if (argDefIndex !== argDefs.length) {
            for (let i = argDefIndex; i < argDefs.length; i++) {
                const [name, argDef] = argDefs[i];
                nextArgs.push(name);

                if (argDef.optional === true) {
                    continue;
                }
                if (
                    argDef.multiple === true &&
                    parsedArgs[name] !== undefined
                ) {
                    continue;
                }
                if (partial) {
                    break;
                }
                throw new Error(`Missing argument '${name}'`);
            }
        }
    }

    return {
        args: argDefs !== undefined ? parsedArgs : undefined,
        flags: flagDefs !== undefined ? parsedFlags : undefined,
        tokens: parsedTokens,

        lastCompletableParam,
        lastParamImplicitQuotes,
        nextArgs,
    };
}
