// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 6 — Testing handler.
// Generates phrase→action test cases from the approved phrase set,
// runs them against the dispatcher using createDispatcher (same pattern
// as evalHarness.ts), and uses an LLM to propose repairs for failures.

import {
    ActionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { TestingActions } from "./testingSchema.js";
import {
    loadState,
    updatePhase,
    writeArtifactJson,
    readArtifactJson,
    readArtifact,
} from "../lib/workspace.js";
import { getTestingModel } from "../lib/llm.js";
import { PhraseSet } from "../phraseGen/phraseGenHandler.js";
import { createDispatcher } from "agent-dispatcher";
import {
    createNpmAppAgentProvider,
    getFsStorageProvider,
} from "dispatcher-node-providers";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import type {
    ClientIO,
    IAgentMessage,
    RequestId,
    CommandResult,
} from "@typeagent/dispatcher-types";
import type {
    DisplayAppendMode,
    DisplayContent,
    MessageContent,
} from "@typeagent/agent-sdk";

export type TestCase = {
    phrase: string;
    expectedActionName: string;
    // Expected parameter values (partial match is acceptable)
    expectedParameters?: Record<string, unknown>;
};

export type TestResult = {
    phrase: string;
    expectedActionName: string;
    actualActionName?: string;
    passed: boolean;
    error?: string;
};

export type TestRun = {
    integrationName: string;
    ranAt: string;
    total: number;
    passed: number;
    failed: number;
    results: TestResult[];
};

export type ProposedRepair = {
    integrationName: string;
    proposedAt: string;
    // Suggested changes to the schema file
    schemaChanges?: string;
    // Suggested changes to the grammar file
    grammarChanges?: string;
    // Explanation of what was wrong and why these changes fix it
    rationale: string;
    applied?: boolean;
    appliedAt?: string;
};

export async function executeTestingAction(
    action: TypeAgentAction<TestingActions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "generateTests":
            return handleGenerateTests(action.parameters.integrationName);

        case "runTests":
            return handleRunTests(
                action.parameters.integrationName,
                context, // passed through for future session context use
                action.parameters.forActions,
                action.parameters.limit,
            );

        case "getTestResults":
            return handleGetTestResults(
                action.parameters.integrationName,
                action.parameters.filter,
            );

        case "proposeRepair":
            return handleProposeRepair(
                action.parameters.integrationName,
                action.parameters.forActions,
            );

        case "approveRepair":
            return handleApproveRepair(action.parameters.integrationName);
    }
}

async function handleGenerateTests(
    integrationName: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.scaffolder.status !== "approved") {
        return {
            error: `Scaffolder phase must be approved first. Run scaffoldAgent.`,
        };
    }

    const phraseSet = await readArtifactJson<PhraseSet>(
        integrationName,
        "phraseGen",
        "phrases.json",
    );
    if (!phraseSet) {
        return { error: `No phrases found for "${integrationName}".` };
    }

    await updatePhase(integrationName, "testing", { status: "in-progress" });

    // Convert phrase set to test cases
    const testCases: TestCase[] = [];
    for (const [actionName, phrases] of Object.entries(phraseSet.phrases)) {
        for (const phrase of phrases) {
            testCases.push({
                phrase,
                expectedActionName: actionName,
            });
        }
    }

    await writeArtifactJson(
        integrationName,
        "testing",
        "test-cases.json",
        testCases,
    );

    return createActionResultFromMarkdownDisplay(
        `## Test cases generated: ${integrationName}\n\n` +
            `**Total test cases:** ${testCases.length}\n` +
            `**Actions covered:** ${Object.keys(phraseSet.phrases).length}\n\n` +
            `Use \`runTests\` to execute them against the dispatcher.`,
    );
}

async function handleRunTests(
    integrationName: string,
    _context: ActionContext<unknown>,
    forActions?: string[],
    limit?: number,
): Promise<ActionResult> {
    const testCases = await readArtifactJson<TestCase[]>(
        integrationName,
        "testing",
        "test-cases.json",
    );
    if (!testCases || testCases.length === 0) {
        return {
            error: `No test cases found for "${integrationName}". Run generateTests first.`,
        };
    }

    let toRun = forActions
        ? testCases.filter((tc) => forActions.includes(tc.expectedActionName))
        : testCases;
    if (limit) toRun = toRun.slice(0, limit);

    // Create a dispatcher and run each phrase through it.
    // The scaffolded agent must be registered in config.json before running tests.
    // Use `packageAgent --register` (phase 7) or add manually and restart TypeAgent.
    let dispatcherSession:
        | Awaited<ReturnType<typeof createTestDispatcher>>
        | undefined;
    try {
        dispatcherSession = await createTestDispatcher(integrationName);
    } catch (err: any) {
        return {
            error:
                `Failed to create dispatcher: ${err?.message ?? err}\n\n` +
                `Make sure the "${integrationName}" agent is registered in config.json ` +
                `and TypeAgent has been restarted. Run \`packageAgent --register\` first.`,
        };
    }

    const results: TestResult[] = [];
    for (const tc of toRun) {
        const result = await runSingleTest(
            tc,
            integrationName,
            dispatcherSession.dispatcher,
        );
        results.push(result);
    }

    await dispatcherSession.dispatcher.close();

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    const testRun: TestRun = {
        integrationName,
        ranAt: new Date().toISOString(),
        total: results.length,
        passed,
        failed,
        results,
    };

    await writeArtifactJson(
        integrationName,
        "testing",
        "results.json",
        testRun,
    );

    const passRate = Math.round((passed / results.length) * 100);

    const failingSummary = results
        .filter((r) => !r.passed)
        .slice(0, 10)
        .map(
            (r) =>
                `- ❌ "${r.phrase}" → expected \`${r.expectedActionName}\`, got \`${r.actualActionName ?? "error"}\`${r.error ? ` (${r.error})` : ""}`,
        )
        .join("\n");

    return createActionResultFromMarkdownDisplay(
        `## Test results: ${integrationName}\n\n` +
            `**Pass rate:** ${passRate}% (${passed}/${results.length})\n\n` +
            (failed > 0
                ? `**Failing tests (first 10):**\n${failingSummary}\n\n` +
                  `Use \`proposeRepair\` to get LLM-suggested schema/grammar fixes.`
                : `All tests passed! Use \`approveRepair\` to finalize or proceed to packaging.`),
    );
}

async function handleGetTestResults(
    integrationName: string,
    filter?: "passing" | "failing",
): Promise<ActionResult> {
    const testRun = await readArtifactJson<TestRun>(
        integrationName,
        "testing",
        "results.json",
    );
    if (!testRun) {
        return {
            error: `No test results found for "${integrationName}". Run runTests first.`,
        };
    }

    const results = filter
        ? testRun.results.filter((r) =>
              filter === "passing" ? r.passed : !r.passed,
          )
        : testRun.results;

    const lines = [
        `## Test results: ${integrationName}`,
        ``,
        `**Run at:** ${testRun.ranAt}`,
        `**Total:** ${testRun.total} | **Passed:** ${testRun.passed} | **Failed:** ${testRun.failed}`,
        ``,
        `| Result | Phrase | Expected | Actual |`,
        `|---|---|---|---|`,
        ...results
            .slice(0, 50)
            .map(
                (r) =>
                    `| ${r.passed ? "✅" : "❌"} | "${r.phrase}" | \`${r.expectedActionName}\` | \`${r.actualActionName ?? r.error ?? "—"}\` |`,
            ),
    ];
    if (results.length > 50) {
        lines.push(``, `_...and ${results.length - 50} more_`);
    }

    return createActionResultFromMarkdownDisplay(lines.join("\n"));
}

async function handleProposeRepair(
    integrationName: string,
    forActions?: string[],
): Promise<ActionResult> {
    const testRun = await readArtifactJson<TestRun>(
        integrationName,
        "testing",
        "results.json",
    );
    if (!testRun) {
        return { error: `No test results found. Run runTests first.` };
    }

    const failing = testRun.results.filter((r) => !r.passed);
    if (failing.length === 0) {
        return createActionResultFromTextDisplay(
            "All tests are passing — no repairs needed.",
        );
    }

    const schemaTs = await readArtifact(
        integrationName,
        "schemaGen",
        "schema.ts",
    );
    const grammarAgr = await readArtifact(
        integrationName,
        "grammarGen",
        "schema.agr",
    );

    const filteredFailing = forActions
        ? failing.filter((r) => forActions.includes(r.expectedActionName))
        : failing;

    const model = getTestingModel();
    const prompt = buildRepairPrompt(
        integrationName,
        filteredFailing,
        schemaTs ?? "",
        grammarAgr ?? "",
    );

    const result = await model.complete(prompt);
    if (!result.success) {
        return { error: `Repair proposal failed: ${result.message}` };
    }

    // Try to parse as JSON first (when using json_object response format)
    let responseText = result.data;
    let schemaFromJson: string | undefined;
    let grammarFromJson: string | undefined;
    try {
        const parsed = JSON.parse(result.data);
        responseText = parsed.explanation || result.data;
        schemaFromJson = parsed.schema;
        grammarFromJson = parsed.grammar;
    } catch {
        // Not JSON, fall through to regex extraction
    }

    const repair: ProposedRepair = {
        integrationName,
        proposedAt: new Date().toISOString(),
        rationale: responseText,
    };

    // Extract suggested schema and grammar changes from the response
    const schemaMatch = schemaFromJson
        ? null
        : result.data.match(/```typescript([\s\S]*?)```/);
    const grammarMatch = grammarFromJson
        ? null
        : result.data.match(/```(?:agr)?([\s\S]*?)```/);
    if (schemaFromJson) repair.schemaChanges = schemaFromJson.trim();
    else if (schemaMatch) repair.schemaChanges = schemaMatch[1].trim();
    if (grammarFromJson) repair.grammarChanges = grammarFromJson.trim();
    else if (grammarMatch) repair.grammarChanges = grammarMatch[1].trim();

    await writeArtifactJson(
        integrationName,
        "testing",
        "proposed-repair.json",
        repair,
    );

    return createActionResultFromMarkdownDisplay(
        `## Proposed repair: ${integrationName}\n\n` +
            `**Failing tests addressed:** ${filteredFailing.length}\n\n` +
            result.data.slice(0, 3000) +
            (result.data.length > 3000 ? "\n\n_...truncated_" : "") +
            `\n\nReview the proposed changes, then use \`approveRepair\` to apply them.`,
    );
}

async function handleApproveRepair(
    integrationName: string,
): Promise<ActionResult> {
    const repair = await readArtifactJson<ProposedRepair>(
        integrationName,
        "testing",
        "proposed-repair.json",
    );
    if (!repair) {
        return { error: `No proposed repair found. Run proposeRepair first.` };
    }
    if (repair.applied) {
        return createActionResultFromTextDisplay("Repair was already applied.");
    }

    // Apply schema changes if present
    if (repair.schemaChanges) {
        const version = Date.now();
        const existing = await readArtifact(
            integrationName,
            "schemaGen",
            "schema.ts",
        );
        if (existing) {
            await writeArtifactJson(
                integrationName,
                "testing",
                `schema.backup.v${version}.ts`,
                existing,
            );
        }
        const { writeArtifact } = await import("../lib/workspace.js");
        await writeArtifact(
            integrationName,
            "schemaGen",
            "schema.ts",
            repair.schemaChanges,
        );
    }

    // Apply grammar changes if present
    if (repair.grammarChanges) {
        const version = Date.now();
        const existing = await readArtifact(
            integrationName,
            "grammarGen",
            "schema.agr",
        );
        if (existing) {
            await writeArtifactJson(
                integrationName,
                "testing",
                `grammar.backup.v${version}.agr`,
                existing,
            );
        }
        const { writeArtifact } = await import("../lib/workspace.js");
        await writeArtifact(
            integrationName,
            "grammarGen",
            "schema.agr",
            repair.grammarChanges,
        );
    }

    repair.applied = true;
    repair.appliedAt = new Date().toISOString();
    await writeArtifactJson(
        integrationName,
        "testing",
        "proposed-repair.json",
        repair,
    );

    await updatePhase(integrationName, "testing", { status: "approved" });

    return createActionResultFromMarkdownDisplay(
        `## Repair applied: ${integrationName}\n\n` +
            (repair.schemaChanges ? "- Schema updated\n" : "") +
            (repair.grammarChanges ? "- Grammar updated\n" : "") +
            `\nRe-run \`runTests\` to verify fixes, or \`packageAgent\` to proceed.`,
    );
}

// ─── Dispatcher helpers ───────────────────────────────────────────────────────

// Minimal ClientIO that silently captures display output into a buffer.
// Mirrors the createCapturingClientIO pattern from evalHarness.ts.
function createCapturingClientIO(buffer: string[]): ClientIO {
    const noop = (() => {}) as (...args: any[]) => any;

    function contentToText(content: DisplayContent): string {
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
            if (content.length === 0) return "";
            if (typeof content[0] === "string")
                return (content as string[]).join("\n");
            return (content as string[][]).map((r) => r.join(" | ")).join("\n");
        }
        // TypedDisplayContent
        const msg = (content as any).content as MessageContent;
        if (typeof msg === "string") return msg;
        if (Array.isArray(msg)) return (msg as string[]).join("\n");
        return String(msg);
    }

    return {
        clear: noop,
        exit: () => process.exit(0),
        setUserRequest: noop,
        setDisplayInfo: noop,
        setDisplay(message: IAgentMessage) {
            const text = contentToText(message.message);
            if (text) buffer.push(text);
        },
        appendDisplay(message: IAgentMessage, _mode: DisplayAppendMode) {
            const text = contentToText(message.message);
            if (text) buffer.push(text);
        },
        appendDiagnosticData: noop,
        setDynamicDisplay: noop,
        question: async (
            _requestId: RequestId | undefined,
            _msg: string,
            _choices: string[],
            defaultId?: number,
        ) => defaultId ?? 0,
        proposeAction: async () => undefined,
        notify: noop,
        openLocalView: async () => {},
        closeLocalView: async () => {},
        requestChoice: noop,
        requestInteraction: noop,
        interactionResolved: noop,
        interactionCancelled: noop,
        takeAction: noop,
    } satisfies ClientIO;
}

// Build an agent provider for the scaffolded agent under test.
// Uses path-based resolution so we don't need a direct npm dependency on
// the generated agent (which would create a circular dependency via
// default-agent-provider).
const AGENTS_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../../packages/agents",
);

function getTestAgentProvider(integrationName: string) {
    const packageName = `${integrationName}-agent`;
    const agentDir = path.resolve(AGENTS_DIR, integrationName);
    const configs: Record<string, { name: string; path: string }> = {
        [integrationName]: { name: packageName, path: agentDir },
    };
    // requirePath is only used when info.path is NOT set; with an absolute
    // path the provider resolves the agent directory directly.
    return createNpmAppAgentProvider(configs, import.meta.url);
}

async function createTestDispatcher(integrationName: string) {
    const instanceDir = getInstanceDir();
    const appAgentProviders = [getTestAgentProvider(integrationName)];
    const buffer: string[] = [];
    const clientIO = createCapturingClientIO(buffer);

    // Use a temp directory for the test dispatcher so it starts with a
    // fresh cache on every run — stale wildcard entries from prior runs
    // can override newly-added grammar rules.
    const tmpDir = path.join(instanceDir, "onboarding-test-tmp-" + Date.now());

    const dispatcher = await createDispatcher("onboarding-test-runner", {
        appAgentProviders,
        agents: {
            schemas: [integrationName],
            actions: [integrationName],
            commands: ["dispatcher", integrationName],
        },
        explainer: { enabled: false },
        // Cache must be enabled for grammar matching to work.
        cache: { enabled: true },
        collectCommandResult: true,
        persistDir: tmpDir,
        storageProvider: getFsStorageProvider(),
        clientIO,
        dblogging: false,
    });

    return { dispatcher, buffer };
}

async function runSingleTest(
    tc: TestCase,
    integrationName: string,
    dispatcher: Awaited<ReturnType<typeof createTestDispatcher>>["dispatcher"],
): Promise<TestResult> {
    // Send the phrase directly — the dispatcher grammar-matches it to the
    // agent's action schema.  Do NOT use the "@agent" prefix because that
    // enters the command-handler path and requires executeCommand().
    const command = tc.phrase;

    let result: CommandResult | undefined;
    try {
        result = await dispatcher.processCommand(command);
    } catch (err: any) {
        return {
            phrase: tc.phrase,
            expectedActionName: tc.expectedActionName,
            passed: false,
            error: err?.message ?? String(err),
        };
    }

    if (result?.lastError) {
        // If an action was dispatched, check the action name first — the test
        // validates phrase→action routing, not execution of the stub handler.
        const actualActionName = result?.actions?.[0]?.actionName;
        if (actualActionName !== undefined) {
            const passed = actualActionName === tc.expectedActionName;
            return {
                phrase: tc.phrase,
                expectedActionName: tc.expectedActionName,
                actualActionName,
                passed,
                ...(passed
                    ? undefined
                    : {
                          error: `Expected "${tc.expectedActionName}", got "${actualActionName}"`,
                      }),
            };
        }
        return {
            phrase: tc.phrase,
            expectedActionName: tc.expectedActionName,
            passed: false,
            error: result.lastError,
        };
    }

    // Check the first dispatched action's name against expected
    const actualActionName = result?.actions?.[0]?.actionName;
    const passed = actualActionName === tc.expectedActionName;

    return {
        phrase: tc.phrase,
        expectedActionName: tc.expectedActionName,
        ...(actualActionName !== undefined ? { actualActionName } : undefined),
        passed,
        ...(passed
            ? undefined
            : {
                  error: `Expected "${tc.expectedActionName}", got "${actualActionName ?? "no action"}"`,
              }),
    };
}

function buildRepairPrompt(
    integrationName: string,
    failing: TestResult[],
    schemaTs: string,
    grammarAgr: string,
): { role: "system" | "user"; content: string }[] {
    const failuresSummary = failing
        .slice(0, 20)
        .map(
            (r) =>
                `Phrase: "${r.phrase}"\nExpected: ${r.expectedActionName}\nGot: ${r.actualActionName ?? r.error ?? "no match"}`,
        )
        .join("\n\n");

    return [
        {
            role: "system",
            content:
                "You are a TypeAgent grammar and schema expert. Analyze failing phrase-to-action test cases " +
                "and propose specific fixes to the TypeScript schema and/or .agr grammar file. " +
                "Explain what is wrong and why your changes will fix it. " +
                "Respond in JSON format. Return a JSON object with optional `schema` and `grammar` keys containing the updated file contents as strings, and an `explanation` key describing the fixes.",
        },
        {
            role: "user",
            content:
                `Fix the TypeAgent schema and grammar for "${integrationName}" to make these failing tests pass.\n\n` +
                `Failing tests (${failing.length} total, showing first 20):\n\n${failuresSummary}\n\n` +
                `Current schema:\n\`\`\`typescript\n${schemaTs.slice(0, 3000)}\n\`\`\`\n\n` +
                `Current grammar:\n\`\`\`agr\n${grammarAgr.slice(0, 3000)}\n\`\`\``,
        },
    ];
}
