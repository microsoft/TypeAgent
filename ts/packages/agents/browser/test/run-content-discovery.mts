// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Standalone content-based discovery benchmark.
 * Uses the production CrossContextHtmlReducer pipeline for accurate latency.
 *
 * Usage:
 *   npx tsx test/run-content-discovery.mts [--verbose]
 *
 * Requires .env with Azure OpenAI API keys in the ts/ root.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = path.resolve(__dirname, "..", "..", "..", "..", ".env");
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

import { openai as ai } from "aiclient";
import { createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { createNodeHtmlReducer } from "../src/common/crossContextHtmlReducer.js";

const verbose = process.argv.includes("--verbose");

// ── Types ───────────────────────────────────────────────────────────────────

interface WebFlowDef {
    name: string;
    description: string;
    parameters: Record<
        string,
        { type: string; required?: boolean; description?: string }
    >;
    scope: { type: string; domains?: string[] };
}

interface HtmlFragment {
    frameId: string;
    content: string;
}

interface ExpectedPage {
    simulatedDomain: string;
    contentDiscovery?: {
        shouldInclude: string[];
        shouldExclude: string[];
    };
}

interface KnownFailure {
    page: string;
    missingFlow: string;
    reason: string;
    filed: string;
}

interface PageResult {
    page: string;
    domain: string;
    rawHtmlSize: number;
    reducedHtmlSize: number;
    htmlReduceMs: number;
    schemaGenMs: number;
    llmMs: number;
    totalMs: number;
    candidateCount: number;
    selectedCount: number;
    selectedFlows: string[];
    success: boolean;
    error?: string;
    includePass: boolean;
    excludePass: boolean;
    knownFailureCount: number;
    unexpectedFailureCount: number;
}

// ── Paths ───────────────────────────────────────────────────────────────────

const samplesDir = path.resolve(
    __dirname,
    "..",
    "src",
    "agent",
    "webFlows",
    "samples",
);
const fixturesDir = path.resolve(__dirname, "fixtures", "discovery-pages");

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadAllFlows(): WebFlowDef[] {
    return fs
        .readdirSync(samplesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) =>
            JSON.parse(fs.readFileSync(path.join(samplesDir, f), "utf8")),
        );
}

function discoverByScope(domain: string, flows: WebFlowDef[]): WebFlowDef[] {
    return flows.filter((flow) => {
        if (flow.scope.type === "global") return true;
        if (flow.scope.type === "site" && flow.scope.domains?.length) {
            return flow.scope.domains.some((d) => domain.endsWith(d));
        }
        return false;
    });
}

function generateDiscoverySchema(flows: WebFlowDef[]): string {
    const typeNames: string[] = [];
    const typeDefs: string[] = [];

    for (const flow of flows) {
        const typeName = flow.name.charAt(0).toUpperCase() + flow.name.slice(1);
        typeNames.push(typeName);

        const paramFields: string[] = [];
        for (const [name, param] of Object.entries(flow.parameters)) {
            const tsType =
                param.type === "number"
                    ? "number"
                    : param.type === "boolean"
                      ? "boolean"
                      : "string";
            const optional = param.required ? "" : "?";
            const comment = param.description ? ` // ${param.description}` : "";
            paramFields.push(
                `        ${name}${optional}: ${tsType};${comment}`,
            );
        }

        const description = flow.description ? `// ${flow.description}\n` : "";
        const paramsBlock =
            paramFields.length > 0
                ? `    parameters: {\n${paramFields.join("\n")}\n    };`
                : "";

        typeDefs.push(
            `${description}export type ${typeName} = {\n` +
                `    actionName: "${flow.name}";\n` +
                (paramsBlock ? `${paramsBlock}\n` : "") +
                `};`,
        );
    }

    const unionMembers = typeNames.join("\n    | ");
    const union =
        typeNames.length > 0
            ? `export type CandidateActions = \n    | ${unionMembers};`
            : `export type CandidateActions = never;`;

    return (
        typeDefs.join("\n\n") +
        "\n\n" +
        union +
        "\n\n" +
        `export type CandidateActionList = {\n    actions: CandidateActions[];\n};`
    );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log("Content-Based Discovery Benchmark");
    console.log("==================================\n");

    // Initialize HTML reducer (production pipeline)
    console.log(
        "Initializing HTML reducer (production CrossContextHtmlReducer)...",
    );
    const reducer = await createNodeHtmlReducer();
    reducer.removeDivs = false;

    // Initialize LLM
    console.log("Initializing LLM (GPT_4_O_MINI)...");
    const apiSettings = ai.azureApiSettingsFromEnv(
        ai.ModelType.Chat,
        undefined,
        "GPT_4_O_MINI",
    );
    const model = ai.createChatModel(apiSettings);

    // Load flows and expectations
    const allFlows = loadAllFlows();
    const expectedAll: Record<string, ExpectedPage> = JSON.parse(
        fs.readFileSync(path.join(fixturesDir, "expected-flows.json"), "utf8"),
    ).pages;

    const knownFailures: KnownFailure[] = JSON.parse(
        fs.readFileSync(path.join(fixturesDir, "known-failures.json"), "utf8"),
    ).failures;

    const knownFailureSet = new Set(
        knownFailures.map((kf) => `${kf.page}:${kf.missingFlow}`),
    );

    console.log(`Loaded ${allFlows.length} sample flows`);
    console.log(`Loaded ${Object.keys(expectedAll).length} test pages`);
    console.log(`Loaded ${knownFailures.length} known failures\n`);

    const testPages = [
        "product-detail.html",
        "search-results.html",
        "shopping-cart.html",
        "instacart-home.html",
        "instacart-recipe.html",
        "restaurant-listing.html",
        "reservation-page.html",
        "non-commerce.html",
    ];

    const results: PageResult[] = [];

    for (const page of testPages) {
        const pageExpected = expectedAll[page];
        const domain = pageExpected.simulatedDomain;
        const htmlPath = path.join(fixturesDir, page);
        const rawHtml = fs.readFileSync(htmlPath, "utf8");

        const totalStart = Date.now();

        // Step 1: HTML reduction (production pipeline)
        const reduceStart = Date.now();
        const reducedHtml = reducer.reduce(rawHtml);
        const htmlReduceMs = Date.now() - reduceStart;

        const fragments: HtmlFragment[] = [
            { frameId: "main", content: reducedHtml },
        ];

        // Step 2: Scope-based filtering
        const scopedFlows = discoverByScope(domain, allFlows);

        // Step 3: Schema generation
        const schemaStart = Date.now();
        const schema = generateDiscoverySchema(scopedFlows);
        const schemaGenMs = Date.now() - schemaStart;

        // Step 4: LLM content analysis
        const validator = createTypeScriptJsonValidator(
            schema,
            "CandidateActionList",
        );
        const translator = createJsonTranslator(model, validator);

        const htmlText = fragments.map((f) => f.content).join("\n");
        const prompt = `You are given a list of known user actions. Examine the page layout and content, then determine which of these actions can actually be performed on THIS page. Only include actions that the page supports. If none of the known actions apply, return an empty actions array.\n\nPage HTML:\n${htmlText.substring(0, 30000)}\n\nReturn a SINGLE "CandidateActionList" response using the typescript schema:\n\`\`\`\n${schema}\n\`\`\``;

        const llmStart = Date.now();
        const response = await translator.translate(prompt);
        const llmMs = Date.now() - llmStart;
        const totalMs = Date.now() - totalStart;

        const result: PageResult = {
            page,
            domain,
            rawHtmlSize: rawHtml.length,
            reducedHtmlSize: reducedHtml.length,
            htmlReduceMs,
            schemaGenMs,
            llmMs,
            totalMs,
            candidateCount: scopedFlows.length,
            selectedCount: 0,
            selectedFlows: [],
            success: response.success,
            includePass: true,
            excludePass: true,
            knownFailureCount: 0,
            unexpectedFailureCount: 0,
        };

        if (response.success) {
            const selected = response.data as {
                actions: { actionName: string }[];
            };
            result.selectedFlows = [
                ...new Set(selected.actions.map((a) => a.actionName)),
            ];
            result.selectedCount = result.selectedFlows.length;

            // Validate against expectations
            if (pageExpected.contentDiscovery) {
                for (const flowName of pageExpected.contentDiscovery
                    .shouldInclude) {
                    if (!result.selectedFlows.includes(flowName)) {
                        const isKnown = knownFailureSet.has(
                            `${page}:${flowName}`,
                        );
                        if (isKnown) {
                            result.knownFailureCount++;
                            if (verbose) {
                                console.log(
                                    `  KNOWN: ${page} missing expected flow: ${flowName}`,
                                );
                            }
                        } else {
                            result.includePass = false;
                            result.unexpectedFailureCount++;
                            if (verbose) {
                                console.log(
                                    `  FAIL: ${page} missing expected flow: ${flowName}`,
                                );
                            }
                        }
                    }
                }
                for (const flowName of pageExpected.contentDiscovery
                    .shouldExclude) {
                    if (result.selectedFlows.includes(flowName)) {
                        result.excludePass = false;
                        result.unexpectedFailureCount++;
                        if (verbose) {
                            console.log(
                                `  FAIL: ${page} has unexpected flow: ${flowName}`,
                            );
                        }
                    }
                }
            }
        } else {
            result.error = (response as any).message;
        }

        const hasOnlyKnown =
            result.success &&
            result.includePass &&
            result.excludePass &&
            result.knownFailureCount > 0;
        const passIcon =
            result.success && result.includePass && result.excludePass
                ? hasOnlyKnown
                    ? "KNOWN"
                    : "PASS"
                : "FAIL";
        console.log(
            `  [${passIcon}] ${page} (${domain}): ${result.candidateCount} scoped -> ${result.selectedCount} selected, reduce: ${htmlReduceMs}ms (${rawHtml.length} -> ${reducedHtml.length} chars), LLM: ${llmMs}ms, total: ${totalMs}ms`,
        );

        results.push(result);
    }

    // ── Report ──────────────────────────────────────────────────────────────

    console.log("\n=== Content-Based Discovery Latency Report ===\n");
    console.log(
        "Page".padEnd(28) +
            "Domain".padEnd(24) +
            "Raw".padEnd(7) +
            "Reduced".padEnd(9) +
            "Scoped".padEnd(8) +
            "Selected".padEnd(10) +
            "Reduce".padEnd(10) +
            "LLM".padEnd(10) +
            "Total".padEnd(10) +
            "Status".padEnd(8) +
            "Selected Flows",
    );
    console.log("-".repeat(160));

    for (const r of results) {
        const status =
            r.success && r.includePass && r.excludePass ? "PASS" : "FAIL";
        console.log(
            r.page.padEnd(28) +
                r.domain.padEnd(24) +
                String(r.rawHtmlSize).padEnd(7) +
                String(r.reducedHtmlSize).padEnd(9) +
                String(r.candidateCount).padEnd(8) +
                String(r.selectedCount).padEnd(10) +
                `${r.htmlReduceMs}ms`.padEnd(10) +
                `${r.llmMs}ms`.padEnd(10) +
                `${r.totalMs}ms`.padEnd(10) +
                status.padEnd(8) +
                r.selectedFlows.join(", "),
        );
    }

    console.log("-".repeat(160));

    const successful = results.filter((r) => r.success);
    const passed = results.filter(
        (r) => r.success && r.includePass && r.excludePass,
    );
    const knownOnly = results.filter(
        (r) =>
            r.success &&
            r.includePass &&
            r.excludePass &&
            r.knownFailureCount > 0,
    );
    const unexpected = results.filter(
        (r) => r.success && r.unexpectedFailureCount > 0,
    );

    if (successful.length > 0) {
        const avg = (arr: number[]) =>
            Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
        const min = (arr: number[]) => Math.min(...arr);
        const max = (arr: number[]) => Math.max(...arr);

        const reduceTimes = successful.map((r) => r.htmlReduceMs);
        const llmTimes = successful.map((r) => r.llmMs);
        const totalTimes = successful.map((r) => r.totalMs);
        const reductions = successful.map((r) =>
            Math.round((1 - r.reducedHtmlSize / r.rawHtmlSize) * 100),
        );

        console.log(`\nSummary (${successful.length} pages):`);
        console.log(
            `  HTML reduce:    avg ${avg(reduceTimes)}ms, min ${min(reduceTimes)}ms, max ${max(reduceTimes)}ms`,
        );
        console.log(`  HTML reduction: avg ${avg(reductions)}% size reduction`);
        console.log(
            `  LLM latency:    avg ${avg(llmTimes)}ms, min ${min(llmTimes)}ms, max ${max(llmTimes)}ms`,
        );
        console.log(`  Total latency:  avg ${avg(totalTimes)}ms`);
        console.log(
            `  Pass rate:      ${passed.length}/${results.length} (${Math.round((passed.length / results.length) * 100)}%)`,
        );
        if (knownOnly.length > 0) {
            console.log(
                `  Known failures: ${knownOnly.length} pages (${results.reduce((s, r) => s + r.knownFailureCount, 0)} flows tracked)`,
            );
        }
        if (unexpected.length > 0) {
            console.log(
                `  NEW failures:   ${unexpected.length} pages (${results.reduce((s, r) => s + r.unexpectedFailureCount, 0)} flows) ← investigate these`,
            );
        }
    }

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
        console.log(`\nLLM failures:`);
        for (const r of failed) {
            console.log(`  ${r.page}: ${r.error}`);
        }
    }

    const expectationFailures = results.filter(
        (r) => r.success && (!r.includePass || !r.excludePass),
    );
    if (expectationFailures.length > 0) {
        console.log(`\nExpectation failures:`);
        for (const r of expectationFailures) {
            if (!r.includePass) {
                const expected =
                    expectedAll[r.page]?.contentDiscovery?.shouldInclude ?? [];
                const missing = expected.filter(
                    (f) => !r.selectedFlows.includes(f),
                );
                console.log(
                    `  ${r.page}: missing expected flows: ${missing.join(", ")}`,
                );
            }
            if (!r.excludePass) {
                const excluded =
                    expectedAll[r.page]?.contentDiscovery?.shouldExclude ?? [];
                const unexpected = excluded.filter((f) =>
                    r.selectedFlows.includes(f),
                );
                console.log(
                    `  ${r.page}: unexpected flows present: ${unexpected.join(", ")}`,
                );
            }
        }
    }

    // Exit with failure only for unexpected failures (known failures don't block)
    const exitCode = unexpected.length === 0 && failed.length === 0 ? 0 : 1;
    process.exit(exitCode);
}

main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(2);
});
