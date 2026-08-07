// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createWriteStream,
    existsSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";

import { Command } from "commander";
import { getChatModelNames, openai as llmClient } from "@typeagent/aiclient";

import {
    buildActionParametersGraderCatalog,
    buildActionParametersLlmJudgeCatalog,
    diffActionParametersGrader,
    loadActionParametersGraderCatalogFile,
    type ActionParametersGraderCatalog,
    type ActionParametersLlmJudgeCatalog,
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

function defaultLlmOutPath(outPath: string): string {
    const dir = path.dirname(outPath);
    const base = path.basename(outPath);
    if (base.includes("action-parameters-grader")) {
        return path.join(
            dir,
            base.replace(
                "action-parameters-grader",
                "action-parameters-grader-llm",
            ),
        );
    }
    return path.join(dir, "action-parameters-grader-llm.generated.json");
}

export function parseCli(argv: string[]) {
    const program = new Command()
        .name("genActionParametersGrader")
        .description(
            "Build action-parameters-grader.generated.json (+ llmAsAJudge sibling list)",
        )
        .option(
            "--catalog <path>",
            "catalog.generated.json path",
            DEFAULT_CATALOG,
        )
        .option("--out <path>", "grader output path", DEFAULT_OUT)
        .option(
            "--llm-out <path>",
            "llmAsAJudge pair list output path (default: beside --out)",
        )
        .option("--force", "full rebuild (default is incremental)", false)
        .option("--model <name>", "chat model for regex-miss LLM fallback")
        .argument("[catalog]", "optional positional catalog path")
        .argument("[out]", "optional positional out path")
        .allowExcessArguments(false)
        .parse(argv, { from: "user" });

    const opts = program.opts<{
        catalog: string;
        out: string;
        llmOut?: string;
        force: boolean;
        model?: string;
    }>();
    const [posCatalog, posOut] = program.args;
    const outPath = posOut ?? opts.out;
    return {
        catalogPath: posCatalog ?? opts.catalog,
        outPath,
        llmOutPath: opts.llmOut ?? defaultLlmOutPath(outPath),
        force: opts.force === true,
        model: opts.model,
    };
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

function writeJsonArtifactAtomic(outPath: string, value: unknown): void {
    const tmpPath = `${outPath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmpPath, outPath);
}

export async function main(
    argv: string[] = process.argv.slice(2),
): Promise<void> {
    const args = parseCli(argv);
    const catalogPath = path.resolve(args.catalogPath);
    const outPath = path.resolve(args.outPath);
    const llmOutPath = path.resolve(args.llmOutPath);
    const force = args.force;

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

    let previous = force
        ? undefined
        : loadActionParametersGraderCatalogFile(outPath);

    const preview = diffActionParametersGrader(catalog, previous);
    process.stderr.write(
        `[genActionParametersGrader] mode=${force ? "force" : "incremental"} ` +
            `diff: +${preview.added.length} ~${preview.updated.length} ` +
            `-${preview.removed.length} =${preview.unchanged.length}\n`,
    );

    const llm =
        args.model !== undefined
            ? await createGraderLlm(args.model)
            : undefined;

    const grader = await buildActionParametersGraderCatalog(catalog, {
        ...(previous !== undefined ? { previous } : {}),
        ...(force ? { forceFull: true } : {}),
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

    const llmCatalog: ActionParametersLlmJudgeCatalog =
        buildActionParametersLlmJudgeCatalog(grader);

    try {
        await writeGraderArtifact(outPath, grader);
        writeJsonArtifactAtomic(llmOutPath, llmCatalog);
    } catch (error) {
        for (const p of [`${outPath}.tmp`, `${llmOutPath}.tmp`]) {
            try {
                unlinkSync(p);
            } catch {
                // ignore
            }
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
    process.stderr.write(
        `[genActionParametersGrader] wrote ${llmOutPath}: ` +
            `${llmCatalog.parameters.length} llmAsAJudge parameter(s), ` +
            `${llmCatalog.excludedActions.length} excluded action(s)\n`,
    );
}

main().catch((error) => {
    console.error("genActionParametersGrader failed:", error);
    process.exit(1);
});
