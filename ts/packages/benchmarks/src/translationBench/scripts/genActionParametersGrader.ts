// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Post-genCatalog step: derive/update action-parameters-grader.generated.json
 * from catalog.generated.json.
 *
 * Incremental by default; --force full reclassify.
 *
 * --audit-dataset runs coverage/strictness checks against a benchmark JSONL
 * (case records) after write. Missing grader actions/fields exit non-zero.
 * Soft-match risks (free_text/temporal exact, nested object exact) warn only.
 * --audit-only skips rebuild and audits the on-disk --out grader.
 */

import {
    createWriteStream,
    existsSync,
    readFileSync,
    renameSync,
    unlinkSync,
} from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";

import { Command } from "commander";
import { getChatModelNames, openai as llmClient } from "@typeagent/aiclient";

import {
    auditActionParametersGraderAgainstDataset,
    buildActionParametersGraderCatalog,
    diffActionParametersGrader,
    loadActionParametersGraderCatalogFile,
    type ActionParametersGraderCatalog,
    type ActionParametersGraderDatasetAuditReport,
    type GeneratedActionCatalog,
    type ParameterGraderLlm,
} from "../synthesizer/catalogGenerator/index.js";
import {
    completionSettingsFromModelConfiguration,
    loadTranslationBenchParameterGraderPromptPack,
} from "../synthesizer/synthesizerPrompts.js";

const DEFAULT_CATALOG = "src/translationBench/catalog.generated.json";
const DEFAULT_OUT =
    "src/translationBench/action-parameters-grader.generated.json";

/** Actions known to appear in datasets without param policies (no-op / reject). */
const AUDIT_ALLOWED_MISSING_ACTIONS = new Set(["dispatcher.unknown"]);

export function parseCli(argv: string[]) {
    const program = new Command()
        .name("genActionParametersGrader")
        .description(
            "Build action-parameters-grader.generated.json (incremental by default)",
        )
        .option(
            "--catalog <path>",
            "catalog.generated.json path",
            DEFAULT_CATALOG,
        )
        .option("--out <path>", "grader output path", DEFAULT_OUT)
        .option("--force", "full rebuild (default is incremental)", false)
        .option("--model <name>", "chat model for regex-miss LLM fallback")
        .option(
            "--audit-dataset <path>",
            "benchmark JSONL to audit grader coverage against after write",
        )
        .option(
            "--audit-only",
            "skip rebuild; audit on-disk --out against --audit-dataset",
            false,
        )
        .argument("[catalog]", "optional positional catalog path")
        .argument("[out]", "optional positional out path")
        .allowExcessArguments(false)
        .parse(argv, { from: "user" });

    const opts = program.opts<{
        catalog: string;
        out: string;
        force: boolean;
        model?: string;
        auditDataset?: string;
        auditOnly: boolean;
    }>();
    const [posCatalog, posOut] = program.args;
    if (opts.auditOnly === true && opts.auditDataset === undefined) {
        throw new Error("--audit-only requires --audit-dataset <path>");
    }
    return {
        catalogPath: posCatalog ?? opts.catalog,
        outPath: posOut ?? opts.out,
        force: opts.force === true,
        auditOnly: opts.auditOnly === true,
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.auditDataset !== undefined
            ? { auditDatasetPath: opts.auditDataset }
            : {}),
    };
}

/**
 * Load case-shaped rows from a benchmark JSONL (skips metadata / non-case lines).
 */
export function loadBenchmarkCasesForGraderAudit(datasetPath: string): Array<{
    id?: string;
    seed?: {
        expectedActions?: ReadonlyArray<{
            schemaName: string;
            actionName: string;
            parameters?: Record<string, unknown>;
        }>;
    };
    generalizations?: ReadonlyArray<{
        expectedActions?: ReadonlyArray<{
            schemaName: string;
            actionName: string;
            parameters?: Record<string, unknown>;
        }>;
    }>;
    targetAction?: { schemaName: string; actionName: string };
}> {
    if (!existsSync(datasetPath)) {
        throw new Error(`Audit dataset not found: ${datasetPath}`);
    }
    const text = readFileSync(datasetPath, "utf8");
    const cases: Array<{
        id?: string;
        seed?: {
            expectedActions?: ReadonlyArray<{
                schemaName: string;
                actionName: string;
                parameters?: Record<string, unknown>;
            }>;
        };
        generalizations?: ReadonlyArray<{
            expectedActions?: ReadonlyArray<{
                schemaName: string;
                actionName: string;
                parameters?: Record<string, unknown>;
            }>;
        }>;
        targetAction?: { schemaName: string; actionName: string };
    }> = [];
    let lineNo = 0;
    for (const line of text.split(/\r?\n/)) {
        lineNo += 1;
        const trimmed = line.trim();
        if (trimmed === "") continue;
        let row: unknown;
        try {
            row = JSON.parse(trimmed);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            throw new Error(
                `Audit dataset JSON parse failed at ${datasetPath}:${lineNo}: ${message}`,
            );
        }
        if (row === null || typeof row !== "object" || Array.isArray(row)) {
            continue;
        }
        const rec = row as Record<string, unknown>;
        const recordType = rec.recordType;
        if (recordType !== undefined && recordType !== "case") {
            continue;
        }
        if (rec.seed === undefined && rec.targetAction === undefined) {
            continue;
        }
        cases.push(rec as (typeof cases)[number]);
    }
    if (cases.length === 0) {
        throw new Error(
            `Audit dataset ${datasetPath} contained no case records ` +
                `(expected JSONL lines with seed/targetAction, recordType=case).`,
        );
    }
    return cases;
}

export function formatGraderDatasetAuditReport(
    report: ActionParametersGraderDatasetAuditReport,
    datasetPath: string,
): string {
    const lines: string[] = [
        `[genActionParametersGrader] audit ${datasetPath}: ` +
            `cases=${report.caseCount} uniqueActions=${report.uniqueActions} ` +
            `ok=${report.ok}`,
        `  stats: exact=${report.stats.paramsScoredExact} ` +
            `nonempty=${report.stats.paramsScoredNonempty} ` +
            `ignore=${report.stats.paramsScoredIgnore} ` +
            `exists=${report.stats.paramsScoredExists} ` +
            `missingActions=${report.stats.missingGraderActions} ` +
            `missingFields=${report.stats.missingGraderFields} ` +
            `freeTextExact=${report.stats.freeTextExactRisk} ` +
            `temporalExact=${report.stats.temporalExactRisk} ` +
            `nestedObjectExact=${report.stats.nestedObjectExact}`,
    ];
    for (const finding of report.findings) {
        const loc =
            finding.actionId !== undefined
                ? finding.field !== undefined
                    ? ` ${finding.actionId}.${finding.field}`
                    : ` ${finding.actionId}`
                : "";
        const count =
            finding.count !== undefined ? ` (n=${finding.count})` : "";
        lines.push(
            `  [${finding.severity}] ${finding.code}${loc}: ${finding.message}${count}`,
        );
    }
    return lines.join("\n") + "\n";
}

/**
 * Run dataset audit. Treats AUDIT_ALLOWED_MISSING_ACTIONS as non-fatal.
 */
export function runGraderDatasetAudit(
    grader: ActionParametersGraderCatalog,
    datasetPath: string,
): { ok: boolean; report: ActionParametersGraderDatasetAuditReport } {
    const cases = loadBenchmarkCasesForGraderAudit(datasetPath);
    const report = auditActionParametersGraderAgainstDataset(grader, cases);
    const findings = report.findings.filter((f) => {
        if (
            f.code === "missing_grader_action" &&
            f.actionId !== undefined &&
            AUDIT_ALLOWED_MISSING_ACTIONS.has(f.actionId)
        ) {
            return false;
        }
        return true;
    });
    const suppressed = report.findings.length - findings.length;
    if (suppressed > 0) {
        findings.push({
            severity: "warning",
            code: "allowed_missing_action",
            message:
                `Suppressed ${suppressed} missing_grader_action finding(s) ` +
                `for allowlisted system actions (${[...AUDIT_ALLOWED_MISSING_ACTIONS].join(", ")})`,
            count: suppressed,
        });
    }
    const errors = findings.filter((f) => f.severity === "error");
    const adjusted: ActionParametersGraderDatasetAuditReport = {
        ...report,
        findings,
        ok: errors.length === 0,
        stats: {
            ...report.stats,
            missingGraderActions: findings.filter(
                (f) => f.code === "missing_grader_action",
            ).length,
        },
    };
    return { ok: adjusted.ok, report: adjusted };
}

async function createGraderLlm(modelName: string): Promise<ParameterGraderLlm> {
    const available = await getChatModelNames();
    if (!available.includes(modelName)) {
        throw new Error(
            `Model '${modelName}' is not configured. Available: ${available.join(", ")}`,
        );
    }
    const pack = loadTranslationBenchParameterGraderPromptPack();
    const fromPrompt = completionSettingsFromModelConfiguration(
        pack.policyClassifier.modelConfiguration,
    );
    const model = llmClient.createChatModel(
        modelName,
        {
            response_format: { type: "json_object" },
            ...fromPrompt,
        },
        undefined,
        ["translation-bench-parameter-grader"],
    );
    return {
        model: modelName,
        async complete(prompt) {
            const result = await model.complete(prompt);
            if (!result.success) {
                throw new Error(
                    `Parameter-grader model failed: ${result.message}`,
                );
            }
            return result.data;
        },
    };
}

async function writeGraderArtifact(
    outPath: string,
    grader: ActionParametersGraderCatalog,
): Promise<void> {
    const tmpPath = `${outPath}.tmp`;
    const stream = createWriteStream(tmpPath, { encoding: "utf8" });
    let streamError: Error | undefined;
    stream.on("error", (err) => {
        streamError = err;
    });
    const write = (chunk: string): Promise<void> =>
        new Promise((resolve, reject) => {
            if (streamError) {
                reject(streamError);
                return;
            }
            if (stream.write(chunk)) {
                resolve();
                return;
            }
            const onDrain = () => {
                stream.off("error", onError);
                resolve();
            };
            const onError = (err: Error) => {
                stream.off("drain", onDrain);
                reject(err);
            };
            stream.once("drain", onDrain);
            stream.once("error", onError);
        });

    const { lastDiff: _lastDiff, byAction, ...header } = grader;

    await write("{\n");
    const headerKeys = Object.keys(header) as Array<keyof typeof header>;
    for (const key of headerKeys) {
        const json = JSON.stringify(header[key], null, 2).replace(
            /\n/g,
            "\n  ",
        );
        await write(`  ${JSON.stringify(key)}: ${json},\n`);
    }

    await write(`  "byAction": {\n`);
    const actionIds = Object.keys(byAction).sort();
    for (let i = 0; i < actionIds.length; i += 1) {
        const id = actionIds[i]!;
        const entryJson = JSON.stringify(byAction[id], null, 2).replace(
            /\n/g,
            "\n    ",
        );
        const comma = i < actionIds.length - 1 ? "," : "";
        await write(`    ${JSON.stringify(id)}: ${entryJson}${comma}\n`);
    }
    await write(`  }\n}\n`);

    stream.end();
    await finished(stream);
    renameSync(tmpPath, outPath);
}

export async function main(
    argv: string[] = process.argv.slice(2),
): Promise<void> {
    const args = parseCli(argv);
    const catalogPath = path.resolve(args.catalogPath);
    const outPath = path.resolve(args.outPath);
    const auditDatasetPath =
        args.auditDatasetPath !== undefined
            ? path.resolve(args.auditDatasetPath)
            : undefined;

    if (args.auditOnly) {
        if (auditDatasetPath === undefined) {
            throw new Error("--audit-only requires --audit-dataset");
        }
        const grader = loadActionParametersGraderCatalogFile(outPath);
        if (grader === undefined) {
            throw new Error(
                `genActionParametersGrader: --audit-only requires existing grader at ${outPath}`,
            );
        }
        const { ok, report } = runGraderDatasetAudit(grader, auditDatasetPath);
        process.stderr.write(
            formatGraderDatasetAuditReport(report, auditDatasetPath),
        );
        if (!ok) {
            throw new Error(
                `genActionParametersGrader: dataset audit failed for ${auditDatasetPath} ` +
                    `(${report.findings.filter((f) => f.severity === "error").length} error(s))`,
            );
        }
        return;
    }

    if (!existsSync(catalogPath)) {
        throw new Error(`Catalog not found: ${catalogPath}`);
    }
    loadTranslationBenchParameterGraderPromptPack();

    const catalog = JSON.parse(
        readFileSync(catalogPath, "utf8"),
    ) as GeneratedActionCatalog;
    if (!Array.isArray(catalog.actions) || !catalog.catalogVersion) {
        throw new Error(
            `Invalid catalog at ${catalogPath}: expected catalogVersion + actions[]`,
        );
    }

    let previous = args.force
        ? undefined
        : loadActionParametersGraderCatalogFile(outPath);

    const preview = diffActionParametersGrader(catalog, previous);
    process.stderr.write(
        `[genActionParametersGrader] mode=${args.force ? "force" : "incremental"} ` +
            `diff: +${preview.added.length} ~${preview.updated.length} ` +
            `-${preview.removed.length} =${preview.unchanged.length}\n`,
    );

    const llm =
        args.model !== undefined
            ? await createGraderLlm(args.model)
            : undefined;

    const grader = await buildActionParametersGraderCatalog(catalog, {
        ...(previous !== undefined ? { previous } : {}),
        ...(args.force ? { forceFull: true } : {}),
        ...(llm !== undefined ? { llm } : {}),
        includeLastDiff: true,
        onProgress(done, total) {
            if (total === 0) return;
            process.stderr.write(
                `[genActionParametersGrader] classify ${done}/${total}\n`,
            );
        },
    });

    previous = undefined;

    try {
        await writeGraderArtifact(outPath, grader);
    } catch (error) {
        try {
            unlinkSync(`${outPath}.tmp`);
        } catch {
            // ignore
        }
        throw error;
    }

    const d = grader.lastDiff ?? preview;
    process.stderr.write(
        `[genActionParametersGrader] wrote ${outPath}: ` +
            `${Object.keys(grader.byAction).length} actions ` +
            `(+${d.added.length} ~${d.updated.length} -${d.removed.length} =${d.unchanged.length}); ` +
            `regexFields=${grader.regexMatchCount} llmFields=${grader.llmFallbackCount}; ` +
            `catalogVersion=${catalog.catalogVersion}\n`,
    );

    if (auditDatasetPath !== undefined) {
        const { ok, report } = runGraderDatasetAudit(grader, auditDatasetPath);
        process.stderr.write(
            formatGraderDatasetAuditReport(report, auditDatasetPath),
        );
        if (!ok) {
            throw new Error(
                `genActionParametersGrader: dataset audit failed for ${auditDatasetPath} ` +
                    `(${report.findings.filter((f) => f.severity === "error").length} error(s)); ` +
                    `grader was written to ${outPath}`,
            );
        }
    }
}

main().catch((error) => {
    console.error("genActionParametersGrader failed:", error);
    process.exit(1);
});
