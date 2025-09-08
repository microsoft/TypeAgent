// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConstructionCache } from "./constructionCache.js";
import chalk from "chalk";
import { printTransformNamespaces } from "../utils/print.js";
import { isMatchPart } from "../constructions/matchPart.js";
import { isParsePart } from "../constructions/parsePart.js";
import {
    Construction,
    ConstructionPart,
    WildcardMode,
} from "./constructions.js";
import {
    MatchedValueTranslator,
    createActionProps,
} from "./constructionValue.js";
import { normalizeParamString } from "../explanation/requestAction.js";

export function getPartNames(parts: ConstructionPart[], verbose: boolean) {
    const counts = new Map<string, number>();
    const needFullName = new Map<string, boolean>();
    if (!verbose) {
        parts.forEach((p) => {
            if (isMatchPart(p) && p.matchSet) {
                const name = p.matchSet.name;
                needFullName.set(name, needFullName.has(name));
            }
        });
    }
    return new Map<ConstructionPart, string>(
        parts.map((p) => {
            let name: string;
            if (isMatchPart(p)) {
                if (p.matchSet) {
                    name =
                        verbose || needFullName.get(p.matchSet.name)
                            ? p.matchSet.fullName
                            : p.matchSet.name;
                } else {
                    name = "wildcard";
                }
            } else if (isParsePart(p)) {
                name = p.toString();
            } else {
                throw new Error("Unknown construction part");
            }

            const count = counts.get(name) ?? 0;
            counts.set(name, count + 1);
            return [p, count === 0 ? name : `${name}#${count}`];
        }),
    );
}

const printMatchedValueTranslator: MatchedValueTranslator = {
    transform: (transformInfo, matchedText, history) =>
        `map(${matchedText.join(",")})`,
    parse: (parsePart, match) => `convert(${match})`,
};

export type PrintOptions = {
    builtin: boolean;
    all: boolean;
    verbose: boolean;
    match?: string[] | undefined;
    part?: string[] | undefined;
    id?: number[] | undefined;
};

function filterConstruction(construction: Construction, options: PrintOptions) {
    const normalizedMatches = options.match?.map((m) =>
        normalizeParamString(m),
    );
    if (normalizedMatches && normalizedMatches.length > 0) {
        if (
            !normalizedMatches.every((m) =>
                construction.parts.some((p) => {
                    if (isMatchPart(p) && p.matchSet) {
                        for (const e of p.matchSet.matches.values()) {
                            if (e.includes(m)) {
                                return true;
                            }
                        }
                    }
                }),
            )
        ) {
            return false;
        }
    }

    if (options.id && !options.id.includes(construction.id)) {
        return false;
    }

    if (options.part) {
        if (
            !options.part.every((p) =>
                construction.parts.some((c) => {
                    if (isMatchPart(c)) {
                        if (c.matchSet !== undefined) {
                            return c.matchSet.fullName.includes(p);
                        }
                    } else if (isParsePart(c)) {
                        return c.toString().includes(p);
                    }
                    return false;
                }),
            )
        ) {
            return false;
        }
    }
    return true;
}
export function printConstructionCache(
    cache: ConstructionCache,
    options: PrintOptions,
) {
    const { all, verbose, match, id } = options;
    const normalizedMatches = match?.map((m) => normalizeParamString(m));
    for (const name of cache.getConstructionNamespaces()) {
        const { constructions } = cache.getConstructionNamespace(name)!;

        const filteredConstructions = constructions.filter((c) =>
            filterConstruction(c, options),
        );
        console.log(
            `Namespace: ${chalk.yellowBright(name)} (${
                filteredConstructions.length
            } ${filteredConstructions.length !== constructions.length ? "filtered " : ""}constructions)`,
        );
        for (const construction of filteredConstructions) {
            if (normalizedMatches && normalizedMatches.length > 0) {
                if (
                    !normalizedMatches.every((m) =>
                        construction.parts.some((p) => {
                            if (isMatchPart(p) && p.matchSet) {
                                for (const e of p.matchSet.matches.values()) {
                                    if (e.includes(m)) {
                                        return true;
                                    }
                                }
                            }
                            return false;
                        }),
                    )
                ) {
                    continue;
                }
            }

            if (id && !id.includes(construction.id)) {
                continue;
            }
            console.log(
                `${construction.id.toString().padStart(3)}: ${chalk.green(
                    construction.toString(verbose),
                )}`,
            );
            const symbolicValues: string[] = [];
            const names = getPartNames(construction.parts, verbose);
            const columns: string[][] = construction.parts.map((p) => {
                const name = names.get(p)!;
                if (isMatchPart(p)) {
                    const matches = p.matchSet
                        ? Array.from(p.matchSet.matches.values())
                        : [];
                    if (p.wildcardMode !== WildcardMode.Disabled) {
                        matches.unshift(".*");
                    }
                    if (!verbose && !all && matches.length > 5) {
                        matches.splice(
                            4,
                            matches.length - 4,
                            `<...> (${matches.length - 4} more)`,
                        );
                    }
                    if (p.capture) {
                        symbolicValues.push(name);
                    }
                    return [name, ...matches];
                } else if (isParsePart(p)) {
                    symbolicValues.push(name);
                    return [name, p.regExp.toString()];
                } else {
                    throw new Error("Unknown construction part");
                }
            });

            const maxLines = columns.reduce(
                (accum, c) => Math.max(accum, c.length),
                0,
            );
            const widths = columns.map((c) =>
                c.reduce((accum, l) => Math.max(accum, l.length), 0),
            );
            const lines: string[][] = [];
            for (let i = 0; i < maxLines; i++) {
                lines.push(
                    columns.map((c, col) => (c[i] || "").padEnd(widths[col])),
                );
                if (i === 0) {
                    lines.push(widths.map((w) => "-".repeat(w)));
                }
            }
            console.log(
                chalk.cyanBright(
                    lines.map((l) => `  ${l.join(" | ")}`).join("\n"),
                ),
            );

            // Print the resulting JSON with symbolic values.
            const result = construction.getMatchedValues(
                symbolicValues,
                {
                    enableWildcard: false,
                    enableEntityWildcard: false,
                    rejectReferences: false,
                    partial: false,
                },
                printMatchedValueTranslator,
            );

            const value =
                result === undefined
                    ? chalk.red("    Value: Internal error")
                    : `    Value:\n${JSON.stringify(
                          createActionProps(result.values),
                          undefined,
                          2,
                      ).replace(/^/gm, " ".repeat(6))}`;
            console.log(value);
        }
    }
    if (verbose) {
        printTransformNamespaces(cache.getTransformNamespaces(), console.log);
    }
}
