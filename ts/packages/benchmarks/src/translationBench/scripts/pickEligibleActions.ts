// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";
import { getChatModelNames, openai as llmClient } from "@typeagent/aiclient";

import {
    pickEligibleGoldActions,
    type ActionQualityPickerLlm,
    type EligibleGoldActionsArtifact,
} from "../policy/actionQualityPicker.js";
import {
    loadActionParametersGraderCatalogFile,
    type GeneratedActionCatalog,
} from "../policy/policyGenerator.js";

const DEFAULT_CATALOG = "src/translationBench/catalog.generated.json";
const DEFAULT_GRADER =
    "src/translationBench/action-parameters-grader.generated.json";
const DEFAULT_OUT =
    "src/translationBench/eligible-gold-actions.generated.json";

export function parseCli(argv: string[]) {
    const program = new Command()
        .name("pickEligibleActions")
        .description(
            "Build eligible-gold-actions.generated.json (human policy + LLM classifier)",
        )
        .requiredOption("--model <name>", "chat model for LLM picker pass")
        .option("--catalog <path>", "catalog.generated.json", DEFAULT_CATALOG)
        .option(
            "--grader <path>",
            "action-parameters-grader.generated.json",
            DEFAULT_GRADER,
        )
        .option("--out <path>", "allowlist output path", DEFAULT_OUT)
        .option("--batch-size <n>", "LLM batch size (1-64)", "40")
        .allowExcessArguments(false)
        .parse(argv, { from: "user" });

    const opts = program.opts<{
        catalog: string;
        grader: string;
        out: string;
        model: string;
        batchSize: string;
    }>();
    const batchSize = Number(opts.batchSize);
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64) {
        throw new Error("--batch-size must be an integer 1..64");
    }
    return {
        catalogPath: opts.catalog,
        graderPath: opts.grader,
        outPath: opts.out,
        model: opts.model,
        batchSize,
    };
}

async function createPickerLlm(
    modelName: string,
): Promise<ActionQualityPickerLlm> {
    const available = await getChatModelNames();
    if (!available.includes(modelName)) {
        throw new Error(
            `Model '${modelName}' is not configured. Available: ${available.join(", ")}`,
        );
    }
    const model = llmClient.createChatModel(
        modelName,
        {
            response_format: { type: "json_object" },
            temperature: 0,
        },
        undefined,
        ["translation-bench-action-quality-picker"],
    );
    return {
        model: modelName,
        async complete(prompt: string) {
            const result = await model.complete(prompt);
            if (!result.success) {
                throw new Error(
                    `action-quality picker model failed: ${result.message}`,
                );
            }
            return result.data;
        },
    };
}

function writeJsonAtomic(
    outPath: string,
    value: EligibleGoldActionsArtifact,
): void {
    const abs = path.resolve(outPath);
    const tmp = `${abs}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmp, abs);
}

async function main(): Promise<void> {
    const args = parseCli(process.argv.slice(2));
    if (!existsSync(args.catalogPath)) {
        throw new Error(`Missing catalog at ${args.catalogPath}`);
    }
    if (!existsSync(args.graderPath)) {
        throw new Error(`Missing grader at ${args.graderPath}`);
    }
    const catalog = JSON.parse(
        readFileSync(args.catalogPath, "utf8"),
    ) as GeneratedActionCatalog;
    const grader = loadActionParametersGraderCatalogFile(args.graderPath);
    if (grader === undefined) {
        throw new Error(`Failed to load grader at ${args.graderPath}`);
    }

    const llm = await createPickerLlm(args.model);
    const artifact = await pickEligibleGoldActions(catalog, grader, {
        llm,
        batchSize: args.batchSize,
    });

    writeJsonAtomic(args.outPath, artifact);
    // Refresh dist copy so runtime next to compiled modules sees the new file.
    const distOut = path.resolve(
        "dist/translationBench/eligible-gold-actions.generated.json",
    );
    if (existsSync(path.dirname(distOut)) || existsSync("dist")) {
        writeJsonAtomic(distOut, artifact);
    }
    process.stderr.write(
        `[pickEligibleActions] wrote ${path.resolve(args.outPath)}: ` +
            `allow=${artifact.allowlist.length}/${catalog.actions.length} ` +
            `model=${artifact.model}\n`,
    );
}

main().then(
    () => process.exit(0),
    (e) => {
        console.error("pickEligibleActions failed:", e);
        process.exit(1);
    },
);
