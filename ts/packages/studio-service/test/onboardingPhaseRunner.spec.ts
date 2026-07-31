// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { OnboardingState } from "@typeagent/core/onboardingBridge";
import {
    buildDiscoveryUtterance,
    createOnboardingPhaseRunner,
    DISCOVERY_SOURCE_ACTIONS,
    extractDiscoverySource,
    type OnboardingArtifactReader,
    type OnboardingDispatch,
    type OnboardingDispatchOutcome,
    type OnboardingDispatchStep,
    type OnboardingPhaseOutputs,
} from "../src/onboarding/phaseRunner.js";

function makeSession(over: Partial<OnboardingState> = {}): OnboardingState {
    return {
        sessionId: "onb-test",
        agentName: "thermostat",
        description: "Control a thermostat. Docs at https://example.com/api",
        phases: {},
        currentPhase: "Discovery",
        ...over,
    };
}

/** Records every dispatched step and replies from a scripted table. */
function recordingDispatch(
    script: (step: OnboardingDispatchStep) => OnboardingDispatchOutcome,
): { dispatch: OnboardingDispatch; steps: OnboardingDispatchStep[] } {
    const steps: OnboardingDispatchStep[] = [];
    const dispatch: OnboardingDispatch = async (step) => {
        steps.push(step);
        return script(step);
    };
    return { dispatch, steps };
}

const noArtifacts: OnboardingArtifactReader = async () => undefined;

/**
 * An artifact reader that returns a `discovery/api-surface.json` with `count`
 * discovered actions (and undefined for any other artifact). Models the on-disk
 * source of truth Discovery now uses to detect success.
 */
function apiSurface(count = 1): OnboardingArtifactReader {
    return async (_name, dir, file) =>
        dir === "discovery" && file === "api-surface.json"
            ? JSON.stringify({
                  actions: Array.from({ length: count }, (_v, i) => ({
                      name: `action${i}`,
                  })),
              })
            : undefined;
}

/** Reply that reports the requested action as executed (deterministic phases). */
function echoAction(step: OnboardingDispatchStep): OnboardingDispatchOutcome {
    if (step.kind === "action") {
        return { actions: [{ actionName: step.actionName }] };
    }
    return { actions: [] };
}

describe("createOnboardingPhaseRunner", () => {
    it("embeds the exact agent name in the Discovery utterance", () => {
        expect(buildDiscoveryUtterance("thermostat", "control heat")).toContain(
            '"thermostat"',
        );
        expect(buildDiscoveryUtterance("thermostat", "control heat")).toContain(
            "control heat",
        );
    });

    it("Discovery starts onboarding, translates the description, then approves the surface", async () => {
        const { dispatch, steps } = recordingDispatch((step) => {
            if (step.kind === "utterance") {
                return { actions: [{ actionName: "crawlDocUrl" }] };
            }
            return echoAction(step);
        });
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: async () => '{"actions":["setTemp"]}',
            now: () => 1000,
        });

        const out = (await run(
            makeSession(),
            "Discovery",
            undefined,
        )) as OnboardingPhaseOutputs;

        // First step creates the integration workspace (idempotent), seeded with
        // the description; then the NL utterance; then approveApiSurface.
        expect(steps[0]).toEqual({
            kind: "action",
            actionName: "startOnboarding",
            parameters: {
                integrationName: "thermostat",
                description: makeSession().description,
            },
        });
        expect(steps[1]).toEqual({
            kind: "utterance",
            text: buildDiscoveryUtterance(
                "thermostat",
                makeSession().description,
            ),
        });
        expect(steps[2]).toEqual({
            kind: "action",
            actionName: "approveApiSurface",
            parameters: { integrationName: "thermostat" },
        });
        expect(out.actions).toEqual([
            "startOnboarding",
            "crawlDocUrl",
            "approveApiSurface",
        ]);
        expect(out.integrationName).toBe("thermostat");
        expect(out.artifactFile).toBe("api-surface.json");
        expect(out.artifact).toEqual({ actions: ["setTemp"] });
        expect(out.generatedAt).toBe(1000);
    });

    it("routes an OpenAPI spec URL straight to parseOpenApiSpec, skipping NL", async () => {
        // A structured spec is deterministically parseable and must NOT be routed
        // through the nondeterministic NL step, which biases to crawlDocUrl and
        // never resolves the spec's base URL (leaving the scaffolder unable to
        // emit a real REST handler).
        const { dispatch, steps } = recordingDispatch(echoAction);
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: apiSurface(3),
            now: () => 2000,
        });

        const out = (await run(
            makeSession({
                agentName: "petstore",
                description:
                    "Pet store API. Parse the OpenAPI spec at https://petstore.swagger.io/v2/swagger.json",
            }),
            "Discovery",
            undefined,
        )) as OnboardingPhaseOutputs;

        // startOnboarding, then parseOpenApiSpec dispatched DIRECTLY (no
        // utterance), then approveApiSurface.
        expect(steps.some((s) => s.kind === "utterance")).toBe(false);
        expect(steps[1]).toEqual({
            kind: "action",
            actionName: "parseOpenApiSpec",
            parameters: {
                integrationName: "petstore",
                specSource: "https://petstore.swagger.io/v2/swagger.json",
            },
        });
        expect(out.actions).toEqual([
            "startOnboarding",
            "parseOpenApiSpec",
            "approveApiSurface",
        ]);
    });

    it("throws when the deterministic parseOpenApiSpec route errors", async () => {
        const { dispatch } = recordingDispatch((step) =>
            step.kind === "action" && step.actionName === "parseOpenApiSpec"
                ? { actions: [], error: "bad spec" }
                : echoAction(step),
        );
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        await expect(
            run(
                makeSession({
                    description: "Spec at https://api.example.com/openapi.json",
                }),
                "Discovery",
                undefined,
            ),
        ).rejects.toThrow(/parseOpenApiSpec failed: bad spec/);
    });

    it("reports the translated source action name in the Discovery outputs", async () => {
        for (const src of DISCOVERY_SOURCE_ACTIONS) {
            const { dispatch } = recordingDispatch((step) =>
                step.kind === "utterance"
                    ? { actions: [{ actionName: src }] }
                    : echoAction(step),
            );
            const run = createOnboardingPhaseRunner({
                dispatch,
                readArtifact: apiSurface(),
            });
            const out = (await run(
                makeSession(),
                "Discovery",
                undefined,
            )) as OnboardingPhaseOutputs;
            expect(out.actions).toContain(src);
        }
    });

    it("Discovery succeeds on the artifact even when the dispatcher reports no actions", async () => {
        // In the service's silent/headless mode the dispatcher reports no
        // executed actions even when the crawl ran; Discovery must still succeed
        // by reading discovery/api-surface.json (the source of truth) and must
        // name the typed actions it dispatched.
        const { dispatch } = recordingDispatch(() => ({ actions: [] }));
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: apiSurface(3),
            now: () => 42,
        });
        const out = (await run(
            makeSession(),
            "Discovery",
            undefined,
        )) as OnboardingPhaseOutputs;
        expect(out.actions).toEqual(["startOnboarding", "approveApiSurface"]);
        expect(out.artifactFile).toBe("api-surface.json");
        expect(out.artifact).toMatchObject({ actions: expect.any(Array) });
        expect(out.generatedAt).toBe(42);
    });

    it("throws an actionable error when Discovery finds no API source", async () => {
        const { dispatch } = recordingDispatch(() => ({ actions: [] }));
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        await expect(
            run(
                makeSession({ description: "just some free text, no source" }),
                "Discovery",
                undefined,
            ),
        ).rejects.toThrow(/could not find an API source/i);
    });

    it("throws when api-surface.json exists but has zero actions", async () => {
        const { dispatch } = recordingDispatch((step) =>
            step.kind === "utterance"
                ? { actions: [{ actionName: "crawlDocUrl" }] }
                : echoAction(step),
        );
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: apiSurface(0),
        });
        await expect(
            run(makeSession(), "Discovery", undefined),
        ).rejects.toThrow(/could not find an API source/i);
    });

    it("falls back to a deterministic crawl when NL yields no source", async () => {
        // NL translation reports nothing (the LLM re-picked startOnboarding);
        // Discovery must recover by extracting the URL from the description and
        // dispatching crawlDocUrl directly.
        const { dispatch, steps } = recordingDispatch((step) =>
            step.kind === "utterance" ? { actions: [] } : echoAction(step),
        );
        // api-surface.json only materializes AFTER the fallback crawl runs.
        const readArtifact: OnboardingArtifactReader = async (
            _n,
            dir,
            file,
        ) => {
            if (dir !== "discovery" || file !== "api-surface.json") {
                return undefined;
            }
            const crawled = steps.some(
                (s) => s.kind === "action" && s.actionName === "crawlDocUrl",
            );
            return crawled
                ? JSON.stringify({ actions: [{ name: "x" }] })
                : undefined;
        };
        const run = createOnboardingPhaseRunner({ dispatch, readArtifact });
        const out = (await run(
            makeSession({ description: "Docs at https://example.com/api" }),
            "Discovery",
            undefined,
        )) as OnboardingPhaseOutputs;
        expect(
            steps.map((s) =>
                s.kind === "action" ? s.actionName : "utterance",
            ),
        ).toEqual([
            "startOnboarding",
            "utterance",
            "crawlDocUrl",
            "approveApiSurface",
        ]);
        expect(out.actions).toEqual([
            "startOnboarding",
            "crawlDocUrl",
            "approveApiSurface",
        ]);
    });

    it("throws when the fallback crawl still yields no actions", async () => {
        const { dispatch } = recordingDispatch((step) =>
            step.kind === "utterance" ? { actions: [] } : echoAction(step),
        );
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        await expect(
            run(
                makeSession({ description: "Docs at https://example.com/api" }),
                "Discovery",
                undefined,
            ),
        ).rejects.toThrow(/could not find an API source/i);
    });

    it("surfaces a translation error from Discovery", async () => {
        const { dispatch } = recordingDispatch((step) =>
            step.kind === "utterance"
                ? { actions: [], error: "no api key" }
                : echoAction(step),
        );
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        await expect(
            run(makeSession(), "Discovery", undefined),
        ).rejects.toThrow(/Discovery translation failed: no api key/);
    });

    it("surfaces a startOnboarding failure from Discovery", async () => {
        const { dispatch } = recordingDispatch((step) =>
            step.kind === "action" && step.actionName === "startOnboarding"
                ? { actions: [], error: "disk full" }
                : echoAction(step),
        );
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        await expect(
            run(makeSession(), "Discovery", undefined),
        ).rejects.toThrow(/startOnboarding failed: disk full/);
    });

    it("runs the deterministic action sequence for each downstream phase", async () => {
        const cases: Array<
            [
                Parameters<ReturnType<typeof createOnboardingPhaseRunner>>[1],
                string[],
            ]
        > = [
            ["PhraseGen", ["generatePhrases", "approvePhrases"]],
            ["SchemaGen", ["generateSchema", "approveSchema"]],
            [
                "GrammarGen",
                ["generateGrammar", "compileGrammar", "approveGrammar"],
            ],
            ["Scaffolder", ["scaffoldAgent"]],
            ["Testing", ["generateTests", "runTests"]],
            ["Packaging", ["packageAgent", "validatePackage"]],
        ];
        for (const [phase, expected] of cases) {
            const { dispatch, steps } = recordingDispatch(echoAction);
            const run = createOnboardingPhaseRunner({
                dispatch,
                readArtifact: noArtifacts,
            });
            const out = (await run(
                makeSession({ currentPhase: phase }),
                phase,
                undefined,
            )) as OnboardingPhaseOutputs;
            expect(out.actions).toEqual(expected);
            // Every step targets the session's agent name.
            for (const step of steps) {
                expect(step).toMatchObject({
                    kind: "action",
                    parameters: { integrationName: "thermostat" },
                });
            }
        }
    });

    it("does not translate for downstream phases (no utterance dispatched)", async () => {
        const { dispatch, steps } = recordingDispatch(echoAction);
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        await run(
            makeSession({ currentPhase: "SchemaGen" }),
            "SchemaGen",
            undefined,
        );
        expect(steps.every((s) => s.kind === "action")).toBe(true);
    });

    it("halts a phase when an action reports an error", async () => {
        const { dispatch } = recordingDispatch((step) =>
            step.kind === "action" && step.actionName === "approveSchema"
                ? { actions: [], error: "schema invalid" }
                : echoAction(step),
        );
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        await expect(
            run(
                makeSession({ currentPhase: "SchemaGen" }),
                "SchemaGen",
                undefined,
            ),
        ).rejects.toThrow(/approveSchema failed: schema invalid/);
    });

    it("reads a non-JSON artifact back as raw text", async () => {
        const reads: Array<[string, string, string]> = [];
        const readArtifact: OnboardingArtifactReader = async (
            name,
            dir,
            file,
        ) => {
            reads.push([name, dir, file]);
            return "export type ThermostatActions = never;";
        };
        const { dispatch } = recordingDispatch(echoAction);
        const run = createOnboardingPhaseRunner({ dispatch, readArtifact });
        const out = (await run(
            makeSession({ currentPhase: "SchemaGen" }),
            "SchemaGen",
            undefined,
        )) as OnboardingPhaseOutputs;
        expect(reads).toEqual([["thermostat", "schemaGen", "schema.ts"]]);
        expect(out.artifactFile).toBe("schema.ts");
        expect(out.artifact).toBe("export type ThermostatActions = never;");
    });

    it("omits the artifact when none is on disk", async () => {
        const { dispatch } = recordingDispatch(echoAction);
        const run = createOnboardingPhaseRunner({
            dispatch,
            readArtifact: noArtifacts,
        });
        const out = (await run(
            makeSession({ currentPhase: "Scaffolder" }),
            "Scaffolder",
            undefined,
        )) as OnboardingPhaseOutputs;
        expect(out.artifact).toBeUndefined();
        expect(out.artifactFile).toBeUndefined();
    });
});

describe("extractDiscoverySource", () => {
    it("maps a documentation URL to crawlDocUrl", () => {
        expect(
            extractDiscoverySource(
                "weather",
                "Weather agent. See https://open-meteo.com/en/docs for details.",
            ),
        ).toEqual({
            kind: "action",
            actionName: "crawlDocUrl",
            parameters: {
                integrationName: "weather",
                url: "https://open-meteo.com/en/docs",
            },
        });
    });

    it("maps an OpenAPI/Swagger spec URL to parseOpenApiSpec", () => {
        expect(
            extractDiscoverySource(
                "petstore",
                "Spec at https://petstore.swagger.io/v2/swagger.json",
            ),
        ).toEqual({
            kind: "action",
            actionName: "parseOpenApiSpec",
            parameters: {
                integrationName: "petstore",
                specSource: "https://petstore.swagger.io/v2/swagger.json",
            },
        });
    });

    it("maps a CLI --help mention to crawlCliHelp", () => {
        expect(
            extractDiscoverySource("gh", "A wrapper over the gh --help output"),
        ).toEqual({
            kind: "action",
            actionName: "crawlCliHelp",
            parameters: { integrationName: "gh", command: "gh" },
        });
    });

    it("trims trailing sentence punctuation from a URL", () => {
        expect(
            extractDiscoverySource(
                "w",
                "docs live at https://example.com/api.",
            ),
        ).toMatchObject({
            parameters: { url: "https://example.com/api" },
        });
    });

    it("returns undefined when the description has no source", () => {
        expect(
            extractDiscoverySource("x", "just some prose with no api source"),
        ).toBeUndefined();
    });
});
