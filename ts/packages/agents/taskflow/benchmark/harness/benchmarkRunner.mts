// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    BenchmarkScenario,
    ScenarioResult,
    PipelineTrace,
    EvaluationResult,
    Scorecard,
} from "./types.mjs";
import { TraceCollector } from "./traceCollector.mjs";
import { evaluateGrammarMatch } from "./evaluators/grammarEvaluator.mjs";
import {
    evaluateExecution,
    evaluateFallback,
} from "./evaluators/executionEvaluator.mjs";
import {
    buildScorecard,
    printScorecard,
} from "./reporters/scorecardReporter.mjs";
import { writeDetailReport } from "./reporters/detailReporter.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
const debug = (...args: any[]) => {
    if (process.env.DEBUG?.includes("typeagent:benchmark")) {
        console.error("[benchmark]", ...args);
    }
};

export interface BenchmarkOptions {
    category?: string;
    scenarioId?: string;
    noLlmJudge?: boolean;
    compareBaseline?: string;
    scenarioDir: string;
    outputDir: string;
    benchmarkDir: string;
    mode: "default" | "llm" | "live" | "record" | "all";
}

export interface DispatcherAdapter {
    processCommand(command: string): Promise<unknown>;
    getDisplayText(): string;
    close(): Promise<void>;
}

const SCENARIO_FILES = [
    "seeding.json",
    "grammar-match.json",
    "llm-translation.json",
    "execution.json",
    "flow-crud.json",
    "recording.json",
    "flow-generation.json",
    "script-patterns.json",
    "dynamic-registration.json",
    "error-handling.json",
    "end-to-end.json",
];

const MODE_CATEGORIES: Record<string, string[]> = {
    default: [
        "seeding",
        "grammar-match",
        "flow-crud",
        "dynamic-registration",
        "error-handling",
        "end-to-end",
    ],
    llm: [
        "seeding",
        "grammar-match",
        "llm-translation",
        "flow-crud",
        "dynamic-registration",
        "error-handling",
        "end-to-end",
    ],
    live: [
        "seeding",
        "grammar-match",
        "llm-translation",
        "execution",
        "flow-crud",
        "dynamic-registration",
        "script-patterns",
        "error-handling",
        "end-to-end",
    ],
    record: [
        "seeding",
        "grammar-match",
        "llm-translation",
        "execution",
        "flow-crud",
        "dynamic-registration",
        "recording",
        "flow-generation",
        "script-patterns",
        "error-handling",
        "end-to-end",
    ],
    all: [
        "seeding",
        "grammar-match",
        "llm-translation",
        "execution",
        "flow-crud",
        "dynamic-registration",
        "recording",
        "flow-generation",
        "script-patterns",
        "error-handling",
        "end-to-end",
    ],
};

export class BenchmarkRunner {
    private traceCollector = new TraceCollector();
    private results: ScenarioResult[] = [];

    constructor(
        private dispatcher: DispatcherAdapter,
        private options: BenchmarkOptions,
    ) {}

    async run(): Promise<Scorecard> {
        const startTime = Date.now();

        const scenarios = this.loadScenarios();

        console.log(
            `\nLoaded ${scenarios.length} scenario(s) from ${this.options.scenarioDir}`,
        );

        for (const scenario of scenarios) {
            await this.runScenario(scenario);
        }

        const scorecard = buildScorecard(this.results, startTime);

        if (this.options.compareBaseline) {
            try {
                const baseline = JSON.parse(
                    readFileSync(this.options.compareBaseline, "utf-8"),
                );
                const { regressions, improvements } = await import(
                    "./reporters/scorecardReporter.mjs"
                ).then((m) => m.compareScorecards(scorecard, baseline));
                scorecard.regressions = regressions;
                scorecard.improvements = improvements;
            } catch (err) {
                console.error(`Failed to load baseline: ${err}`);
            }
        }

        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "")
            .substring(0, 15);
        const outputDir = join(this.options.outputDir, timestamp);
        mkdirSync(outputDir, { recursive: true });

        writeFileSync(
            join(outputDir, "scorecard.json"),
            JSON.stringify(scorecard, null, 2),
        );
        writeDetailReport(this.results, outputDir);

        printScorecard(scorecard);

        if (scorecard.regressions.length > 0) {
            console.log("  REGRESSIONS:");
            for (const r of scorecard.regressions) {
                console.log(`    - ${r}`);
            }
        }
        if (scorecard.improvements.length > 0) {
            console.log("  IMPROVEMENTS:");
            for (const i of scorecard.improvements) {
                console.log(`    + ${i}`);
            }
        }

        console.log(`\nResults written to: ${outputDir}`);
        return scorecard;
    }

    private loadScenarios(): BenchmarkScenario[] {
        const allScenarios: BenchmarkScenario[] = [];

        for (const file of SCENARIO_FILES) {
            const filePath = join(this.options.scenarioDir, file);
            try {
                const scenarios: BenchmarkScenario[] = JSON.parse(
                    readFileSync(filePath, "utf-8"),
                );
                allScenarios.push(...scenarios);
            } catch {
                debug(`Scenario file not found or invalid: ${filePath}`);
            }
        }

        let filtered = allScenarios;

        // Filter by mode
        const allowedCategories = MODE_CATEGORIES[this.options.mode];
        if (allowedCategories) {
            filtered = filtered.filter((s) =>
                allowedCategories.includes(s.category),
            );
        }

        if (this.options.category) {
            filtered = filtered.filter(
                (s) => s.category === this.options.category,
            );
        }
        if (this.options.scenarioId) {
            filtered = filtered.filter((s) => s.id === this.options.scenarioId);
        }

        return filtered;
    }

    private async runScenario(scenario: BenchmarkScenario): Promise<void> {
        for (const utterance of scenario.utterances) {
            const scenarioStart = Date.now();
            const text = utterance.text;

            debug(`Running [${scenario.id}]: "${text}"`);

            this.traceCollector.startCollecting();
            this.traceCollector.clearLogs();

            let commandResult: unknown;
            let trace: PipelineTrace;
            let displayText = "";

            try {
                commandResult = await this.dispatcher.processCommand(text);
                displayText = this.dispatcher.getDisplayText();

                // If the display pipeline didn't capture text, try to
                // extract it from the command result directly.
                if (!displayText) {
                    displayText = extractDisplayFromResult(commandResult) ?? "";
                }

                trace = this.traceCollector.buildTrace(text, scenarioStart);
                trace.executionResult = {
                    success: !(commandResult as any)?.lastError,
                    output: displayText,
                    error: (commandResult as any)?.lastError,
                };
                debug(
                    `Result for "${text}": ${JSON.stringify(commandResult)?.substring(0, 300)}`,
                );
            } catch (err) {
                trace = this.traceCollector.buildTrace(text, scenarioStart);
                trace.executionResult = {
                    success: false,
                    output: "",
                    error: String(err),
                };
                commandResult = { error: String(err) };
            } finally {
                this.traceCollector.stopCollecting();
            }

            const resultObj = commandResult as any;
            if (resultObj?.lastError) {
                trace.fallbackTriggered = true;
                trace.fallbackReason = resultObj.lastError;
            }
            if (displayText && /reasoning/i.test(displayText)) {
                trace.reasoningInvoked = true;
            }

            const evaluations: EvaluationResult[] = [];

            evaluations.push(
                ...evaluateGrammarMatch(utterance, trace, commandResult),
            );
            evaluations.push(
                ...evaluateExecution(utterance, trace, commandResult),
            );
            evaluations.push(
                ...evaluateFallback(utterance, trace, commandResult),
            );

            const passed = evaluations.every((e) => e.passed);

            this.results.push({
                scenarioId: scenario.id,
                category: scenario.category,
                description: scenario.description,
                utterance: text,
                passed,
                evaluations,
                trace,
                durationMs: Date.now() - scenarioStart,
            });

            const status = passed ? "PASS" : "FAIL";
            console.log(`  [${status}] ${scenario.id}: ${text}`);
        }
    }
}

function extractDisplayFromResult(commandResult: unknown): string | undefined {
    const r = commandResult as any;
    if (!r) return undefined;

    // Check actions array for display content
    if (Array.isArray(r.actions)) {
        const parts: string[] = [];
        for (const action of r.actions) {
            const dc = action?.result?.displayContent;
            if (typeof dc === "string") parts.push(dc);
            else if (Array.isArray(dc)) parts.push(dc.join("\n"));
            if (action?.result?.historyText)
                parts.push(action.result.historyText);
        }
        if (parts.length > 0) return parts.join("\n");
    }

    if (r.displayText) return r.displayText;
    if (r.result?.displayContent) {
        const dc = r.result.displayContent;
        if (typeof dc === "string") return dc;
        if (Array.isArray(dc)) return dc.join("\n");
    }
    return undefined;
}
