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
import {
    readFileSync,
    readdirSync,
    writeFileSync,
    mkdirSync,
    existsSync,
} from "fs";
import { join } from "path";
import registerDebug from "debug";

const debug = registerDebug("typeagent:benchmark");

export interface BenchmarkOptions {
    category?: string;
    scenarioId?: string;
    noLlmJudge?: boolean;
    compareBaseline?: string;
    scenarioDir: string;
    outputDir: string;
    benchmarkDir: string;
}

export interface DispatcherAdapter {
    processCommand(command: string): Promise<unknown>;
    getDisplayText(): string;
    close(): Promise<void>;
}

export class BenchmarkRunner {
    private traceCollector = new TraceCollector();
    private results: ScenarioResult[] = [];
    private flowNameMap: Record<string, string>;

    constructor(
        private dispatcher: DispatcherAdapter,
        private options: BenchmarkOptions,
        flowNameMap?: Record<string, string>,
    ) {
        this.flowNameMap = flowNameMap ?? {};
    }

    private resolveFlowName(canonical: string): string {
        return this.flowNameMap[canonical] ?? canonical;
    }

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

        // Compare with baseline if provided
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

        // Write outputs
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
        const scenarioFiles = [
            "grammar-match.json",
            "grammar-subschemas.json",
            "grammar-competition.json",
            "execution.json",
            "llm-translation.json",
            "fallback-chain.json",
            "end-to-end.json",
        ];

        const allScenarios: BenchmarkScenario[] = [];

        for (const file of scenarioFiles) {
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

        // Apply filters
        let filtered = allScenarios;
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

            // Expand variables in utterance text
            let text = utterance.text;
            const benchmarkDir = process.env.TEMP
                ? join(process.env.TEMP, "powershell-benchmark")
                : "";
            const powershellPkg = join(this.options.benchmarkDir, "..");
            text = text.replace(/\$\{BENCHMARK_DIR\}/g, benchmarkDir);
            text = text.replace(/\$\{POWERSHELL_PKG\}/g, powershellPkg);

            debug(`Running [${scenario.id}]: "${text}"`);

            // Collect trace
            this.traceCollector.startCollecting();
            this.traceCollector.clearLogs();

            let commandResult: unknown;
            let trace: PipelineTrace;

            let displayText = "";
            try {
                commandResult = await this.dispatcher.processCommand(text);
                displayText = this.dispatcher.getDisplayText();
                trace = this.traceCollector.buildTrace(text, scenarioStart);
                trace.executionResult = {
                    success: !(commandResult as any)?.lastError,
                    output: displayText,
                    error: (commandResult as any)?.lastError,
                };
                debug(
                    `Result for "${text}": ${JSON.stringify(commandResult)?.substring(0, 300)}`,
                );
                if (displayText) {
                    debug(`Display: ${displayText.substring(0, 200)}`);
                }
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

            // Detect fallback from display text and CommandResult
            const resultObj = commandResult as any;
            if (resultObj?.lastError) {
                trace.fallbackTriggered = true;
                trace.fallbackReason = resultObj.lastError;
            }
            if (
                displayText &&
                /reasoning|editPowerShellFlow|createPowerShellFlow/i.test(
                    displayText,
                )
            ) {
                trace.reasoningInvoked = true;
            }
            // Check if actions include reasoning-produced actions
            const actions = resultObj?.actions as any[];
            if (
                actions?.some(
                    (a: any) =>
                        a.actionName === "editPowerShellFlow" ||
                        a.actionName === "createPowerShellFlow",
                )
            ) {
                trace.reasoningInvoked = true;
                trace.fallbackTriggered = true;
            }

            // Resolve canonical flow names to actual LLM-generated names
            // ONLY for non-grammar scenarios - grammar tests use built-in action names
            const isGrammarTest = scenario.category.startsWith("grammar");
            const resolvedUtterance = {
                ...utterance,
                expected: {
                    ...utterance.expected,
                    matchedFlow:
                        utterance.expected.matchedFlow && !isGrammarTest
                            ? this.resolveFlowName(
                                  utterance.expected.matchedFlow,
                              )
                            : utterance.expected.matchedFlow,
                },
            };

            // Run evaluators
            const evaluations: EvaluationResult[] = [];

            evaluations.push(
                ...evaluateGrammarMatch(
                    resolvedUtterance,
                    trace,
                    commandResult,
                ),
            );
            evaluations.push(
                ...evaluateExecution(resolvedUtterance, trace, commandResult),
            );
            evaluations.push(
                ...evaluateFallback(resolvedUtterance, trace, commandResult),
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
