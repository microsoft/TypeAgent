// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@collision neighborhoods` — translator-only neighborhood construction.
//
// Collapsed from the previous `preview` subcommand. Persistence is the
// default; the leaf command reads translation-results.json, derives
// neighborhoods directly from translator misroute edges (no similarity
// scan, no embedding-probe corpus), computes per-action gravity, and
// writes both JSON and HTML artifacts to <workdir>/neighborhoods.{json,html}.

import * as fs from "node:fs";
import * as path from "node:path";

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";

import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { buildNeighborhoodsFromTranslator } from "../../../neighborhoods/merge.js";
import { buildNeighborhoodPreviewHTML } from "../../../neighborhoods/previewViz.js";
import {
    computeActionGravity,
    type ActionGravity,
} from "../../../neighborhoods/actionGravity.js";
import type { TranslationProbeFile } from "../../../translation/translationProbeRunner.js";
import {
    defaultPath,
    ensureDir,
    fileLinkHtml,
    fileLinkMd,
    resolveWorkdir,
} from "../../../neighborhoods/optimize/util.js";

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_NEIGHBORHOODS_JSON = "neighborhoods.json";
const DEFAULT_NEIGHBORHOODS_HTML = "neighborhoods.html";
const DEFAULT_TRANSLATOR_CORPUS = "translation-results.json";
const DEFAULT_MIN_MISROUTE_COUNT = 2;
const DEFAULT_SAMPLES_PER_CATEGORY = 5;

// =============================================================================
// JSON output shape
// =============================================================================

interface NeighborhoodsOutput {
    schemaVersion: 1;
    builtAt: string;
    sources: { translatorCorpus: string };
    neighborhoods: ReturnType<
        typeof buildNeighborhoodsFromTranslator
    >["neighborhoods"];
    gravity: Record<string, ActionGravity[]>;
}

// =============================================================================
// Handler: @collision neighborhoods
// =============================================================================

export class CollisionNeighborhoodsCommandHandler implements CommandHandler {
    public readonly description =
        "Build neighborhoods directly from translator misroute edges and write a persisted JSON index plus an HTML viz.";
    public readonly parameters = {
        flags: {
            corpus: {
                description: `Translator probe results JSON (default <workdir>/${DEFAULT_TRANSLATOR_CORPUS})`,
                type: "string",
                optional: true,
            },
            "min-misroute": {
                description: `Drop edges below this count (default ${DEFAULT_MIN_MISROUTE_COUNT})`,
                type: "number",
                default: DEFAULT_MIN_MISROUTE_COUNT,
            },
            "include-same-schema": {
                description:
                    "Include same-schema misroute edges (e.g. email.send + email.reply). Default: true",
                type: "boolean",
                default: true,
            },
            "samples-per-category": {
                description: `Per-category cap on edge sample phrases (default ${DEFAULT_SAMPLES_PER_CATEGORY}).`,
                type: "number",
                default: DEFAULT_SAMPLES_PER_CATEGORY,
            },
            out: {
                description: `Output JSON path (default <workdir>/${DEFAULT_NEIGHBORHOODS_JSON})`,
                type: "string",
                optional: true,
            },
            "out-html": {
                description: `Output HTML path (default <workdir>/${DEFAULT_NEIGHBORHOODS_HTML})`,
                type: "string",
                optional: true,
            },
            workdir: {
                description:
                    "Directory for default-named files. Default: <instanceDir>/collisions",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const workdir = params.flags.workdir
            ? resolveWorkdir(systemContext, params.flags.workdir)
            : undefined;
        const corpusPath = defaultPath(
            systemContext,
            params.flags.corpus,
            workdir,
            DEFAULT_TRANSLATOR_CORPUS,
        );
        const outPath = defaultPath(
            systemContext,
            params.flags.out,
            workdir,
            DEFAULT_NEIGHBORHOODS_JSON,
        );
        const outHtmlPath = defaultPath(
            systemContext,
            params.flags["out-html"],
            workdir,
            DEFAULT_NEIGHBORHOODS_HTML,
        );

        if (!fs.existsSync(corpusPath)) {
            displayWarn(
                `Translator probe corpus not found at ${corpusPath}. Run @collision corpus translate first.`,
                context,
            );
            return;
        }

        displayStatus(
            `Neighborhoods · loading translator corpus ${corpusPath}…`,
            context,
        );
        let translationResults: TranslationProbeFile;
        try {
            translationResults = JSON.parse(
                fs.readFileSync(corpusPath, "utf-8"),
            ) as TranslationProbeFile;
        } catch (err) {
            displayWarn(
                `Failed to read translator corpus ${corpusPath}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
                context,
            );
            return;
        }

        const minMisrouteCount = Math.max(
            1,
            params.flags["min-misroute"] ?? DEFAULT_MIN_MISROUTE_COUNT,
        );
        const includeSameSchema = params.flags["include-same-schema"] ?? true;
        const samplesPerCategoryCap = Math.max(
            1,
            params.flags["samples-per-category"] ??
                DEFAULT_SAMPLES_PER_CATEGORY,
        );

        displayStatus(`Neighborhoods · merging…`, context);
        const preview = buildNeighborhoodsFromTranslator({
            translationResults,
            minMisrouteCount,
            includeSameSchema,
            translatorCorpusFile: corpusPath,
            samplesPerCategoryCap,
        });

        // Compute gravity for each neighborhood. Cheap and the optimize loop
        // will read it for case selection.
        const gravity: Record<string, ActionGravity[]> = {};
        for (const n of preview.neighborhoods) {
            gravity[n.id] = computeActionGravity(n);
        }

        const output: NeighborhoodsOutput = {
            schemaVersion: 1,
            builtAt: preview.builtAt,
            sources: { translatorCorpus: corpusPath },
            neighborhoods: preview.neighborhoods,
            gravity,
        };

        ensureDir(path.dirname(outPath));
        fs.writeFileSync(outPath, JSON.stringify(output, undefined, 2));

        // HTML viz reuses the existing preview renderer. Pass an empty
        // pairScores array — translator-only construction doesn't have
        // similarity scores to drive the slider, and the viz hides the
        // control when no scores are present.
        const html = buildNeighborhoodPreviewHTML(preview, {
            pairScores: [],
        });
        ensureDir(path.dirname(outHtmlPath));
        fs.writeFileSync(outHtmlPath, html);

        const total = preview.neighborhoods.length;
        const cross = preview.neighborhoods.filter(
            (n) => n.kind === "cross-schema",
        ).length;
        const same = preview.neighborhoods.filter(
            (n) => n.kind === "same-schema",
        ).length;
        const summaryHtml =
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:900px;">` +
            `<h3 style="margin:0 0 6px;font-size:14px;">Neighborhoods written</h3>` +
            `<div style="font-size:12px;color:#777;margin-bottom:6px;"><b>${total}</b> neighborhood(s) · ${cross} cross-schema · ${same} same-schema</div>` +
            `<div style="font-size:12px;">JSON: ${fileLinkHtml(outPath)}</div>` +
            `<div style="font-size:12px;">HTML: ${fileLinkHtml(outHtmlPath)}</div>` +
            `<div style="font-size:11px;color:#777;margin-top:6px;">Source: ${corpusPath}</div>` +
            `</div>`;
        const summaryMd = [
            `Neighborhoods written: ${fileLinkMd(outPath)}`,
            `  ${total} neighborhood(s) · ${cross} cross-schema · ${same} same-schema`,
            `  HTML: ${fileLinkMd(outHtmlPath)}`,
            `  Source: ${corpusPath}`,
        ];
        const summaryText = [
            `Neighborhoods written: ${outPath}`,
            `  ${total} neighborhood(s) · ${cross} cross-schema · ${same} same-schema`,
            `  HTML: ${outHtmlPath}`,
            `  Source: ${corpusPath}`,
        ];
        context.actionIO.appendDisplay({
            type: "html",
            content: summaryHtml,
            alternates: [
                { type: "markdown", content: summaryMd },
                { type: "text", content: summaryText },
            ],
        });
    }
}
