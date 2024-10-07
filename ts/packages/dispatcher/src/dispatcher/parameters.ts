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
    while (true) {
        try {
            // Save the rest for implicit quote arguments;
            const rest = curr;
            const next = nextToken();
            if (next === undefined) {
                break;
            }
            const flagInfo = flagDefs ? resolveFlag(flagDefs, next) : undefined;
            if (flagInfo !== undefined) {
                const [name, flag] = flagInfo;
                const valueType = getFlagType(flag);
                let value: FlagValueTypes;
                if (valueType === "boolean") {
                    value = true;
                } else {
                    const rollback = curr;
                    const valueStr = nextToken();
                    if (valueStr === undefined || valueStr.startsWith("-")) {
                        // rollback to continue with partial
                        if (valueStr !== undefined) {
                            curr = rollback;
                            parsedTokens.pop();
                        }
                        throw new Error(`Missing value for flag '${next}'`);
                    }
                    const stripped = stripQuoteFromToken(valueStr);
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

                let arg = stripQuoteFromToken(next);
                if (argDef.implicitQuotes === true && arg === next) {
                    parsedTokens.pop();
                    parsedTokens.push(rest);
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
    }
    return {
        args: argDefs !== undefined ? parsedArgs : undefined,
        flags: flagDefs !== undefined ? parsedFlags : undefined,
        tokens: parsedTokens,
    };
}
