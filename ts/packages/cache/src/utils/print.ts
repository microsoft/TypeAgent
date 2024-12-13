// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getElapsedString, getColorElapsedString } from "common-utils";
import chalk from "chalk";
import { ProcessRequestActionResult } from "../cache/cache.js";
import { ImportConstructionResult } from "../index.js";
import { Transforms } from "../constructions/transforms.js";
import { ProcessExplanationResult } from "../cache/explainWorkQueue.js";

export function printProcessExplanationResult(
    result: ProcessExplanationResult,
    log: (message?: string) => void = console.log.bind(console),
) {
    const explanation = result.explanation;
    if (explanation.success) {
        log(
            chalk.italic(
                chalk.grey(JSON.stringify(explanation.data, undefined, 2)),
            ),
        );
        const suffix = explanation.corrections?.length
            ? ` (${explanation.corrections.length} corrections)`
            : "";
        log(`Explanation${suffix}: ${getColorElapsedString(result.elapsedMs)}`);

        if (result.toPrettyString) {
            log(chalk.cyanBright(result.toPrettyString(explanation.data)));
        }
    } else {
        log(
            chalk.red(
                `${explanation.message} [${getElapsedString(
                    result.elapsedMs,
                )}]${
                    explanation.corrections
                        ? `\n${JSON.stringify(
                              explanation.corrections,
                              undefined,
                              2,
                          )}`
                        : ""
                }`,
            ),
        );
    }
}

export function printProcessRequestActionResult(
    result: ProcessRequestActionResult,
    log: (message?: string) => void = console.log.bind(console),
) {
    printProcessExplanationResult(result.explanationResult, log);
    if (result.constructionResult) {
        const color = result.constructionResult.added
            ? chalk.green
            : chalk.yellow;
        log(color(result.constructionResult.message));
    }
}

export function printImportConstructionResult(
    result: ImportConstructionResult,
    log: (message?: string) => void = console.log.bind(console),
) {
    log("=".repeat(80));
    log(`Existing Constructions: ${result.existingCount}`);
    log(`                 Input: ${result.inputCount}`);
    log(`     New Constructions: ${result.newCount}`);
    log(`   Added Constructions: ${result.addCount}`);
}

export function printTransformNamespaces(
    transformNamespaces: Map<string, Transforms>,
    log: (message: string) => void,
    prefix: string = "",
) {
    log(
        `${prefix}Transforms:\n${Array.from(transformNamespaces)
            .map(
                ([namespace, transforms]) =>
                    `${prefix}  ${namespace}:\n${chalk.grey(transforms.toString(`${prefix}    `))}`,
            )
            .join("\n")}`,
    );
}
