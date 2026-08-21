// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    getChatModelTelemetryContext,
    withChatModelTelemetryContext,
    type ChatModel,
    type ChatModelTelemetryContext,
} from "@typeagent/aiclient";
import type { ActionConfigProvider } from "../src/translation/actionConfigProvider.js";
import type { Neighborhood } from "../src/neighborhoods/types.js";
import type { TranslationProbeFile } from "../src/translation/translationProbeRunner.js";
import type {
    AttemptRecord,
    CaseDescription,
    Hypothesis,
} from "../src/neighborhoods/optimize/types.js";
import {
    _clearRegistryForTest,
    registerLever,
    type LeverPlugin,
    type ProposeContext,
} from "../src/neighborhoods/optimize/registry.js";
import { generateHypotheses } from "../src/neighborhoods/optimize/hypothesisGenerator.js";
import { distillGuidelineCandidates } from "../src/neighborhoods/optimize/guidelineDistiller.js";
import { analyzeCase } from "../src/neighborhoods/optimize/caseAnalyzer.js";

function makeStubModel(observed: ChatModelTelemetryContext[]): ChatModel {
    return {
        complete: async () => {
            observed.push(getChatModelTelemetryContext());
            return {
                success: true,
                data: JSON.stringify({
                    failurePattern: "unclassified",
                    proposedText: "Prefer explicit action descriptions.",
                }),
            };
        },
    } as unknown as ChatModel;
}

function makeCaseDescription(): CaseDescription {
    return {
        schemaVersion: 1,
        neighborhoodId: "n1",
        members: [
            { schemaName: "list", actionName: "addItems" },
            { schemaName: "list", actionName: "removeItems" },
        ],
        severityTier: "leaky",
        failurePattern: "unclassified",
        failurePatternHeuristic: "unclassified",
        misroutePhrases: [],
        cleanPhrases: [],
        reverseDirectionPhrases: [],
        currentJSDoc: {},
        currentManifestDescriptions: {},
        currentPasDescriptions: {},
        originalChecksum: {},
    };
}

function makeProposeContext(model: ChatModel): ProposeContext {
    return {
        createModel: () => model,
        pmap: async <T, R>(
            items: readonly T[],
            _concurrency: number,
            fn: (item: T, index: number) => Promise<R>,
        ) => Promise.all(items.map(fn)),
        workdir: "test-workdir",
        outDir: "test-outdir",
        schemaGuidelines: "",
    };
}

describe("optimize LLM classification", () => {
    afterEach(() => {
        _clearRegistryForTest();
    });

    it("classifies every lever and nested retry as background hypothesis generation", async () => {
        const observed: ChatModelTelemetryContext[] = [];
        const model = makeStubModel(observed);
        const makeLever = (name: string): LeverPlugin => ({
            name,
            description: `${name} lever`,
            consumes: ["neighborhoods"],
            probeType: "translator",
            proposeHypotheses: async (
                _caseDescription: CaseDescription,
                _priorAttempts: AttemptRecord[],
                context: ProposeContext,
            ): Promise<Hypothesis[]> => {
                await context.createModel("propose").complete("prompt");
                await context.createModel("retry").complete("retry prompt");
                return [];
            },
            applyToSandbox: async () => ({ filesWritten: [] }),
        });
        registerLever(makeLever("a-lever"));
        registerLever(makeLever("b-lever"));

        await withChatModelTelemetryContext(
            { phase: "action", purpose: "action", scope: "foreground" },
            () =>
                generateHypotheses({
                    caseDesc: makeCaseDescription(),
                    priorAttempts: [],
                    ctx: makeProposeContext(model),
                }),
        );

        expect(observed).toHaveLength(4);
        for (const classification of observed) {
            expect(classification).toEqual({
                phase: "background",
                purpose: "optimization-hypothesis-generation",
                scope: "background",
                classificationSource: "explicit",
            });
        }
    });

    it("classifies case analysis as background case classification", async () => {
        const observed: ChatModelTelemetryContext[] = [];
        const neighborhood: Neighborhood = {
            id: "n1",
            kind: "same-schema",
            members: [
                { schemaName: "list", actionName: "addItems" },
                { schemaName: "list", actionName: "removeItems" },
            ],
            evidence: {},
            sources: ["corpus"],
        };
        const translationResults = {
            results: [],
        } as unknown as TranslationProbeFile;
        const provider = {
            tryGetActionConfig: () => undefined,
        } as unknown as ActionConfigProvider;

        await analyzeCase({
            neighborhood,
            translationResults,
            provider,
            createModel: () => makeStubModel(observed),
            schemaGuidelines: "guidelines",
            skipChecksumValidation: true,
        });

        expect(observed).toEqual([
            {
                phase: "background",
                purpose: "optimization-case-classification",
                scope: "background",
                classificationSource: "explicit",
            },
        ]);
    });

    it("classifies guideline distillation as background work", async () => {
        const observed: ChatModelTelemetryContext[] = [];
        const tempRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), "optimize-distill-test-"),
        );
        const evalPathA = path.join(tempRoot, "attempt-a");
        const evalPathB = path.join(tempRoot, "attempt-b");
        fs.mkdirSync(evalPathA);
        fs.mkdirSync(evalPathB);
        try {
            const patternsFile = path.join(tempRoot, "patterns.jsonl");
            const row = (id: string, evaluationPath: string) => ({
                runId: "r1",
                caseId: `c-${id}`,
                schemaName: "list",
                actionName: "addItems",
                neighborhoodId: `n-${id}`,
                failurePattern: "unclassified",
                failurePatternHeuristic: "unclassified",
                lever: "jsdoc",
                mechanism: "widen-identity",
                guidelineHook: "schema-shape-work-with-llm-intent",
                depth: 0,
                rescues: 3,
                regressions: 0,
                netDelta: 3,
                score: 3,
                isWinner: true,
                regressionPhrases: [],
                evaluationPath,
            });
            fs.writeFileSync(
                patternsFile,
                `${JSON.stringify(row("1", evalPathA))}\n${JSON.stringify(
                    row("2", evalPathB),
                )}\n`,
            );

            await distillGuidelineCandidates({
                patternsFile,
                minAttempts: 1,
                minPerGroup: 2,
                schemaGuidelines: "guidelines",
                createModel: () => makeStubModel(observed),
            });
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }

        expect(observed).toEqual([
            {
                phase: "background",
                purpose: "optimization-guideline-distillation",
                scope: "background",
                classificationSource: "explicit",
            },
        ]);
    });
});
