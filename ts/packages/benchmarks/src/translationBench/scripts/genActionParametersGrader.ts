// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Post-genCatalog step: derive/update action-parameters-grader.generated.json
 * from catalog.generated.json.
 *
 * Incremental by default: only added/updated actions (paramSpec fingerprint
 * change) are reclassified; removed catalog actions are dropped; unchanged
 * entries are kept as-is. Fingerprints include GRADER_RULES_VERSION so policy
 * code bumps force rebuild without always needing --force.
 *
 * On-disk artifact omits lastDiff (stderr only) and does **not** persist
 * recommendedByAction (derive via toRecommendedByActionVerifyMap on demand).
 *
 * Usage:
 *   node dist/translationBench/scripts/genActionParametersGrader.js \
 *     [--catalog path] [--out path] [--force] [--model name]
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

import { getChatModelNames, openai as ai } from "@typeagent/aiclient";

import {
    buildActionParametersGraderCatalog,
    diffActionParametersGrader,
    loadActionParametersGraderCatalogFile,
    type ActionParametersGraderCatalog,
    type GeneratedActionCatalog,
    type ParameterGraderLlm,
} from "../synthesizer/catalogGenerator/index.js";
import {
    completionSettingsFromModelConfiguration,
    loadTranslationBenchParameterGraderPromptPack,
} from "../synthesizer/synthesizerPrompts.js";

function parseArgs(argv: string[]): {
    catalogPath: string;
    outPath: string;
    force: boolean;
    model?: string;
} {
    let catalogPath = "src/translationBench/catalog.generated.json";
    let outPath = "src/translationBench/action-parameters-grader.generated.json";
    let force = false;
    let model: string | undefined;
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]!;
        if (arg === "--force") {
            force = true;
            continue;
        }
        if (arg === "--catalog") {
            const next = argv[++i];
            if (next === undefined || next.startsWith("-")) {
                throw new Error("--catalog requires a path");
            }
            catalogPath = next;
            continue;
        }
        if (arg === "--out") {
            const next = argv[++i];
            if (next === undefined || next.startsWith("-")) {
                throw new Error("--out requires a path");
            }
            outPath = next;
            continue;
        }
        if (arg === "--model") {
            const next = argv[++i];
            if (next === undefined || next.startsWith("-")) {
                throw new Error("--model requires a name");
            }
            model = next;
            continue;
        }
        if (arg.startsWith("-")) {
            throw new Error(`Unknown flag '${arg}'`);
        }
        positionals.push(arg);
    }
    if (positionals[0] !== undefined) catalogPath = positionals[0];
    if (positionals[1] !== undefined) outPath = positionals[1];
    return {
        catalogPath,
        outPath,
        force,
        ...(model !== undefined ? { model } : {}),
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
    const model = ai.createChatModel(
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

/**
 * Stream pretty JSON without holding recommendedByAction or a giant pretty
 * string alongside the grader object. Atomic publish via .tmp + rename.
 */
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

    // Omit lastDiff from disk (run log only). No recommendedByAction — derive
    // via toRecommendedByActionVerifyMap when a consumer needs it.
    const {
        lastDiff: _lastDiff,
        byAction,
        ...header
    } = grader;

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

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const catalogPath = path.resolve(args.catalogPath);
    const outPath = path.resolve(args.outPath);

    if (!existsSync(catalogPath)) {
        throw new Error(`Catalog not found: ${catalogPath}`);
    }
    // Ensure prompt pack is loadable (fail fast).
    loadTranslationBenchParameterGraderPromptPack();

    const catalog = JSON.parse(
        readFileSync(catalogPath, "utf8"),
    ) as GeneratedActionCatalog;
    if (!Array.isArray(catalog.actions) || !catalog.catalogVersion) {
        throw new Error(
            `Invalid catalog at ${catalogPath}: expected catalogVersion + actions[]`,
        );
    }

    let previous =
        args.force ? undefined : loadActionParametersGraderCatalogFile(outPath);

    const preview = diffActionParametersGrader(catalog, previous);
    process.stderr.write(
        `[genActionParametersGrader] diff: ` +
            `+${preview.added.length} ~${preview.updated.length} ` +
            `-${preview.removed.length} =${preview.unchanged.length}` +
            (args.force ? " (force full)" : "") +
            "\n",
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

    // Drop prior from memory before write.
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
}

main().catch((error) => {
    console.error("genActionParametersGrader failed:", error);
    process.exit(1);
});
