// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from "@oclif/core";
import chalk from "chalk";
import { CorrectionRecord } from "agent-cache";
import {
    getCacheFactory,
    readExplanationTestData,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import path from "node:path";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
} from "default-agent-provider";

function commonPathPrefix(s: string[]) {
    const paths = s.map((str) => str.split(path.sep));
    let index = 0;
    while (
        paths.every((p) => index < p.length && p[index] === paths[0][index])
    ) {
        index++;
    }
    return paths[0].slice(0, index).join(path.sep);
}
const sum = (value: Record<string, number>) => {
    return Object.values(value).reduce((a, b) => a + b, 0);
};
type SortRowsFunc = (
    a: [string, Record<string, number>],
    b: [string, Record<string, number>],
) => number;
function printStats(
    name: string,
    stats: Map<string, Record<string, number>>,
    options?: {
        sortColumns?: boolean;
        sortRows?: SortRowsFunc;
        columnRatio?: {
            total: Record<string, number>;
            rows: string[];
        };
        columnTotal?: boolean;
    },
) {
    if (stats.size === 0) {
        return;
    }
    const keyWidth = Math.min(
        80,
        Math.max(...Array.from(stats.keys()).map((k) => k.length + 1)),
    );
    const columns = Array.from(
        new Set(
            Array.from(stats.values()).flatMap((v) => Object.keys(v)),
        ).values(),
    );
    if (columns.length === 0) {
        return;
    }
    if (options?.sortColumns) {
        columns.sort();
    }
    if (columns.length > 1) {
        columns.unshift("Total");
    }
    const data = Array.from(stats.entries());
    if (options?.sortRows) {
        data.sort(options.sortRows);
    }

    const fullData = data.map(
        ([row, values]): [string, Record<string, number>] => {
            const fullValues: Record<string, number> = {};
            let rowTotal = 0;
            for (const column of columns) {
                fullValues[column] = values[column] ?? 0;
                rowTotal += fullValues[column];
            }
            fullValues["Total"] = rowTotal;
            return [row, fullValues];
        },
    );

    const columnRatio = options?.columnRatio;
    const columnRatioTotal = columnRatio ? { ...columnRatio.total } : undefined;
    if (columnRatioTotal) {
        columnRatioTotal["Total"] = sum(columnRatioTotal);
    }
    const columnWidth = 6 + (columnRatio ? 9 : 0);
    const tableWidth = keyWidth + (columnWidth + 3) * (columns.length + 1);
    const header = [
        chalk.cyan(`${name.padEnd(keyWidth)}`),
        ...columns.map((c) => c.padStart(columnWidth)),
    ];
    console.log(header.join(" | "));
    console.log("-".repeat(tableWidth));

    const getValueStr = (row: string, value: number, total?: number) => {
        const v = value.toString().padStart(6);
        if (total) {
            if (options?.columnRatio?.rows.includes(row)) {
                const ratio = value / total;
                if (ratio < 1) {
                    return `${v} (${(ratio * 100).toFixed(2).padStart(5)}%)`;
                }
                return `${v} (${ratio.toFixed(3).padStart(5)} )`;
            }
            return v.padEnd(columnWidth);
        }
        return v;
    };

    const columnTotal: Record<string, number> | undefined =
        options?.columnTotal !== false ? {} : undefined;
    const printRow = (row: string, values: Record<string, number>) => {
        const items = [row.slice(0, keyWidth).padEnd(keyWidth)];
        for (const column of columns) {
            items.push(
                getValueStr(row, values[column], columnRatioTotal?.[column]),
            );
            if (columnTotal) {
                columnTotal[column] =
                    (columnTotal[column] ?? 0) + values[column];
            }
        }
        console.log(items.join(" | "));
    };

    for (const [row, value] of fullData) {
        printRow(row, value);
    }

    console.log("-".repeat(tableWidth));
    if (columnTotal) {
        printRow("Total", columnTotal);
    }
    console.log();
}

const { schemaNames } = await getAllActionConfigProvider(
    getDefaultAppAgentProviders(getInstanceDir()),
);

export default class ExplanationDataStatCommand extends Command {
    static strict = false;
    static args = {
        files: Args.string({
            description:
                "List of explanation data files. Default to all test files in the config.json.",
        }),
    };
    static flags = {
        schema: Flags.string({
            description: "Filter by translator",
            options: schemaNames,
            multiple: true,
        }),
        explainer: Flags.string({
            description: "Filter by explainer",
            options: getCacheFactory().getExplainerNames(),
            multiple: true,
        }),
        succeeded: Flags.boolean({
            description: "Stats for only test data succeeded (default to all)",
            default: false,
        }),
        failed: Flags.boolean({
            description: "Stats for only test data failed (default to all)",
            default: false,
            exclusive: ["succeeded"],
        }),
        corrections: Flags.boolean({
            description: "Show correction stats",
            default: false,
        }),
        file: Flags.boolean({
            description: "Show file stats",
            default: false,
        }),
        error: Flags.boolean({
            description: "Show error stats",
            default: false,
        }),
        all: Flags.boolean({
            description: "Show all stats",
            default: false,
        }),
        message: Flags.boolean({
            description: "Sort by message",
            default: false,
        }),
    };
    async run(): Promise<void> {
        const { flags, argv } = await this.parse(ExplanationDataStatCommand);
        const files =
            argv.length !== 0
                ? (argv as string[])
                : await getDefaultConstructionProvider().getImportTranslationFiles();

        const collectOneStat = (
            statsMap: Map<string, Record<string, number>>,
            key: string,
            field: string,
            value: number = 1,
        ) => {
            const stats = statsMap.get(key) ?? {};
            stats[field] = (stats[field] ?? 0) + value;
            statsMap.set(key, stats);
        };

        const errorStats = new Map<string, Record<string, number>>();
        const correctStats = new Map<string, Record<string, number>>();
        const summaryStats = new Map<string, Record<string, number>>();
        const collectOneCorrectionStats = (
            correction: string,
            succeeded: boolean,
        ) => {
            const normalize = correction
                .replace(
                    /^(Parameter|Property) ['A-Za-z0-9.]+ has /,
                    "$1 <string> has ",
                )
                .replace(/ '.*', which/, " <string>, which")
                .replace(/ '.*', /, " <string>, ")
                .replace(/ '.*' for (parameter|property)/, " <string> for $1")
                .replace(/end of request '.*'$/, "end of request <string>")
                .replace(
                    /explanation has '.*' not found/,
                    "explanation has <string> not found",
                )
                .replaceAll(/ '.*?'([ ,]|$)/g, " <string>$1")
                .replaceAll(/ -?\d+ /g, " <number> ")
                .replaceAll(
                    /in the substring '.*'./g,
                    "in the substring <string> ",
                );
            collectOneStat(
                correctStats,
                normalize,
                succeeded ? "Succ" : "Failed",
            );
        };
        const collectCorrectionStats = (
            corrections: CorrectionRecord<object>[],
            succeeded: boolean,
        ) => {
            for (const { correction } of corrections) {
                if (Array.isArray(correction)) {
                    correction.forEach((c) =>
                        collectOneCorrectionStats(c, succeeded),
                    );
                } else {
                    collectOneCorrectionStats(correction, succeeded);
                }
            }
        };

        let fileCount = 0;
        let entryCount = 0;
        let failedCount = 0;

        const basePath = commonPathPrefix(files);
        const showFiles = flags.file || flags.all;
        const showCorrections = flags.corrections || flags.all;
        const showErrors = flags.error || flags.all;
        if (showFiles) {
            console.log(
                `${chalk.cyan(`File stats: (${path.relative(process.cwd(), basePath)})`.padEnd(70))} |  Total |   Succ | Failed (Rate)`,
            );
            console.log("-".repeat(100));
        }

        const printFileStat = (
            file: string,
            entries: number,
            failed: number,
        ) => {
            const total = entries + failed;
            console.log(
                `${chalk.cyanBright(file.padEnd(70))} | ${total.toString().padStart(6)} | ${entries.toString().padStart(6)} | ${failed.toString().padStart(6)} (${((failed / total) * 100).toFixed(2).padStart(5)}%)`,
            );
        };
        for (const file of files) {
            try {
                const data = await readExplanationTestData(file);
                if (
                    (flags.schema && !flags.schema.includes(data.schemaName)) ||
                    (flags.explainer &&
                        !flags.explainer.includes(data.explainerName))
                ) {
                    continue;
                }

                if (flags.succeeded || !flags.failed) {
                    for (const entry of data.entries) {
                        collectOneStat(
                            summaryStats,
                            "Retries",
                            data.explainerName,
                            (entry.corrections?.length ?? 0) + 1,
                        );
                        if (showCorrections && entry.corrections) {
                            collectCorrectionStats(entry.corrections, true);
                        }
                    }
                }
                if (flags.failed || !flags.succeeded) {
                    if (data.failed !== undefined) {
                        for (const entry of data.failed) {
                            collectOneStat(
                                summaryStats,
                                entry.action === undefined
                                    ? "  Translation"
                                    : "  Explanation",
                                data.explainerName,
                            );

                            collectOneStat(
                                summaryStats,
                                "Retries",
                                data.explainerName,
                                (entry.corrections?.length ?? 0) + 1,
                            );
                            if (showCorrections && entry.corrections) {
                                collectCorrectionStats(
                                    entry.corrections,
                                    false,
                                );
                            }

                            if (showErrors) {
                                const message = entry.message
                                    .split(":")
                                    .slice(0, 2)
                                    .join(":");
                                collectOneStat(
                                    errorStats,
                                    message,
                                    data.explainerName,
                                );
                            }
                        }
                    }
                }
                const entries = data.entries.length;
                const failed = data.failed?.length ?? 0;

                entryCount += entries;
                failedCount += failed;
                collectOneStat(summaryStats, "Files", data.explainerName);
                collectOneStat(
                    summaryStats,
                    "Entries",
                    data.explainerName,
                    entries + failed,
                );
                collectOneStat(
                    summaryStats,
                    "Failed",
                    data.explainerName,
                    failed,
                );

                fileCount++;

                if (showFiles) {
                    const relFile = path.relative(basePath, file);
                    printFileStat(relFile, entries, failed);
                }
            } catch (e: any) {
                throw new Error(`Error processing ${file}: ${e.message}`);
            }
        }
        if (showFiles) {
            console.log("-".repeat(110));
            printFileStat("Total", entryCount, failedCount);
            console.log();
        }

        const sortStats: SortRowsFunc = flags.message
            ? (a, b) => a[0].localeCompare(b[0])
            : (a, b) => sum(b[1]) - sum(a[1]);

        if (showCorrections) {
            printStats("Correction stats", correctStats, {
                sortRows: sortStats,
            });
        }

        if (showErrors) {
            printStats("Error stats", errorStats, {
                sortColumns: true,
                sortRows: sortStats,
            });
        }

        const rowOrder = [
            "Files",
            "Entries",
            "Failed",
            "  Translation",
            "  Explanation",
            "Retries",
        ];

        printStats("Summary", summaryStats, {
            sortColumns: true,
            sortRows: (a, b) => {
                const indexA = rowOrder.indexOf(a[0]);
                const indexB = rowOrder.indexOf(b[0]);
                if (indexA === -1) {
                    if (indexB === -1) {
                        return a[0].localeCompare(b[0]);
                    }
                    return 1;
                } else {
                    if (indexB === -1) {
                        return -1;
                    }
                }
                return indexA - indexB;
            },
            columnRatio: {
                total: summaryStats.get("Entries") ?? {},
                rows: ["Failed", "  Translation", "  Explanation", "Retries"],
            },
            columnTotal: false,
        });
    }
}
