// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @jest-environment node
 */

/**
 * Integration test: content-based action discovery latency measurement.
 * Requires API keys — run via `pnpm run test:live` or `npx jest --testPathPattern contentDiscovery`.
 *
 * Sends HTML fixtures + webflow schema to the LLM and measures:
 * - Schema generation time
 * - LLM round-trip latency per page
 * - Total discovery time per page
 * - Average across all pages
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env from ts/ root for API keys
const envPath = path.resolve(__dirname, "..", "..", "..", "..", ".env");
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const samplesDir = path.resolve(
    __dirname,
    "..",
    "src",
    "agent",
    "webFlows",
    "samples",
);

const fixturesDir = path.resolve(__dirname, "fixtures", "discovery-pages");

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

interface PageResult {
    page: string;
    domain: string;
    htmlReduceMs: number;
    schemaGenMs: number;
    llmMs: number;
    totalMs: number;
    candidateCount: number;
    selectedCount: number;
    selectedFlows: string[];
    success: boolean;
    error?: string;
}

function loadAllFlows(): WebFlowDef[] {
    return fs
        .readdirSync(samplesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) =>
            JSON.parse(fs.readFileSync(path.join(samplesDir, f), "utf8")),
        );
}

function loadExpected(): Record<
    string,
    {
        simulatedDomain: string;
        contentDiscovery?: { shouldInclude: string[]; shouldExclude: string[] };
    }
> {
    return JSON.parse(
        fs.readFileSync(path.join(fixturesDir, "expected-flows.json"), "utf8"),
    ).pages;
}

// Identity function — Jest cannot run the production CrossContextHtmlReducer
// (jsdom 28 / undici incompatibility). Use run-content-discovery.mts for
// accurate latency with production HTML processing.
let reduceHtml: (html: string) => string = (html) => html;

function htmlToFragments(htmlContent: string): HtmlFragment[] {
    const reduced = reduceHtml(htmlContent);
    return [{ frameId: "main", content: reduced }];
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

function discoverByScope(domain: string, flows: WebFlowDef[]): WebFlowDef[] {
    return flows.filter((flow) => {
        if (flow.scope.type === "global") return true;
        if (flow.scope.type === "site" && flow.scope.domains?.length) {
            return flow.scope.domains.some((d) => domain.endsWith(d));
        }
        return false;
    });
}

describe("content-based discovery latency", () => {
    let allFlows: WebFlowDef[];
    let expected: ReturnType<typeof loadExpected>;
    let model: any;
    let createJsonTranslator: any;
    let createTypeScriptJsonValidator: any;

    beforeAll(async () => {
        allFlows = loadAllFlows();
        expected = loadExpected();

        // NOTE: Production HTML reduction (CrossContextHtmlReducer) cannot run
        // in Jest due to jsdom 28 / undici incompatibility with Jest's CJS transformer.
        // Use the standalone benchmark script (test/run-content-discovery.mts) for
        // accurate latency measurement with production HTML processing.
        // This Jest test passes raw HTML to the LLM as a functional correctness check.

        // Use aiclient directly — avoids jest moduleNameMapper issues with .mjs imports
        const ai = await import("aiclient");
        const typechat = await import("typechat");
        const typechatTs = await import("typechat/ts");

        const apiSettings = ai.openai.azureApiSettingsFromEnv(
            ai.openai.ModelType.Chat,
            undefined,
            "GPT_4_O_MINI",
        );
        model = ai.openai.createChatModel(apiSettings);
        createJsonTranslator = typechat.createJsonTranslator;
        createTypeScriptJsonValidator =
            typechatTs.createTypeScriptJsonValidator;
    }, 30000);

    const results: PageResult[] = [];

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

    for (const page of testPages) {
        it(`discovers actions on ${page}`, async () => {
            const pageExpected = expected[page];
            const domain = pageExpected.simulatedDomain;
            const htmlPath = path.join(fixturesDir, page);
            const html = fs.readFileSync(htmlPath, "utf8");

            const totalStart = Date.now();

            // HTML passed as-is (see run-content-discovery.mts for production reducer)
            const fragments = htmlToFragments(html);

            // Layer 1: scope-based
            const scopedFlows = discoverByScope(domain, allFlows);

            // Schema generation
            const schemaStart = Date.now();
            const schema = generateDiscoverySchema(scopedFlows);
            const schemaGenMs = Date.now() - schemaStart;

            // Layer 2: LLM content analysis
            const validator = createTypeScriptJsonValidator(
                schema,
                "CandidateActionList",
            );
            const llmTranslator = createJsonTranslator(model, validator);

            const htmlText = fragments
                .map((f: HtmlFragment) => f.content)
                .join("\n");
            const prompt = `You are given a list of known user actions. Examine the page layout and content, then determine which of these actions can actually be performed on THIS page. Only include actions that the page supports. If none of the known actions apply, return an empty actions array.\n\nPage HTML:\n${htmlText.substring(0, 30000)}\n\nReturn a SINGLE "CandidateActionList" response using the typescript schema:\n\`\`\`\n${schema}\n\`\`\``;

            const llmStart = Date.now();
            const response = await llmTranslator.translate(prompt);
            const llmMs = Date.now() - llmStart;
            const totalMs = Date.now() - totalStart;

            const result: PageResult = {
                page,
                domain,
                htmlReduceMs: 0,
                schemaGenMs,
                llmMs,
                totalMs,
                candidateCount: scopedFlows.length,
                selectedCount: 0,
                selectedFlows: [],
                success: response.success,
            };

            if (response.success) {
                const selected = (response as any).data as {
                    actions: { actionName: string }[];
                };
                result.selectedFlows = [
                    ...new Set(selected.actions.map((a) => a.actionName)),
                ];
                result.selectedCount = result.selectedFlows.length;

                // Validate content-based expectations
                if (pageExpected.contentDiscovery) {
                    for (const flowName of pageExpected.contentDiscovery
                        .shouldInclude) {
                        expect(result.selectedFlows).toContain(flowName);
                    }
                    for (const flowName of pageExpected.contentDiscovery
                        .shouldExclude) {
                        expect(result.selectedFlows).not.toContain(flowName);
                    }
                }
            } else {
                result.error = (response as any).message;
            }

            results.push(result);

            console.log(
                `  ${page} (${domain}): ${result.candidateCount} scoped → ${result.selectedCount} selected, LLM: ${llmMs}ms, total: ${totalMs}ms`,
            );

            expect(response.success).toBe(true);
        }, 60000);
    }

    afterAll(() => {
        if (results.length === 0) return;

        console.log("\n=== Content-Based Discovery Latency Report ===\n");
        console.log(
            "Page".padEnd(30) +
                "Domain".padEnd(25) +
                "Scoped".padEnd(8) +
                "Selected".padEnd(10) +
                "Reduce".padEnd(10) +
                "Schema".padEnd(10) +
                "LLM".padEnd(10) +
                "Total".padEnd(10) +
                "Selected Flows",
        );
        console.log("-".repeat(150));

        for (const r of results) {
            console.log(
                r.page.padEnd(30) +
                    r.domain.padEnd(25) +
                    String(r.candidateCount).padEnd(8) +
                    String(r.selectedCount).padEnd(10) +
                    `${r.htmlReduceMs}ms`.padEnd(10) +
                    `${r.schemaGenMs}ms`.padEnd(10) +
                    `${r.llmMs}ms`.padEnd(10) +
                    `${r.totalMs}ms`.padEnd(10) +
                    r.selectedFlows.join(", "),
            );
        }

        const successful = results.filter((r) => r.success);
        if (successful.length > 0) {
            const avgReduce = Math.round(
                successful.reduce((sum, r) => sum + r.htmlReduceMs, 0) /
                    successful.length,
            );
            const avgLlm = Math.round(
                successful.reduce((sum, r) => sum + r.llmMs, 0) /
                    successful.length,
            );
            const avgTotal = Math.round(
                successful.reduce((sum, r) => sum + r.totalMs, 0) /
                    successful.length,
            );
            const minLlm = Math.min(...successful.map((r) => r.llmMs));
            const maxLlm = Math.max(...successful.map((r) => r.llmMs));

            console.log(`\nSummary (${successful.length} pages):`);
            console.log(`  HTML reduce:   avg ${avgReduce}ms`);
            console.log(
                `  LLM latency:   avg ${avgLlm}ms, min ${minLlm}ms, max ${maxLlm}ms`,
            );
            console.log(`  Total latency:  avg ${avgTotal}ms`);
            console.log(
                `  Pass rate: ${successful.length}/${results.length} (${Math.round((successful.length / results.length) * 100)}%)`,
            );
        }

        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
            console.log(`\nFailed pages:`);
            for (const r of failed) {
                console.log(`  ${r.page}: ${r.error}`);
            }
        }
    });
});
