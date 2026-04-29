// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    HookInput,
    Options,
    PermissionResult,
    PermissionUpdate,
    PostToolUseHookInput,
    query,
} from "@anthropic-ai/claude-agent-sdk";
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { printAssistant, printUser } from "./claudePrint.js";
import {
    AGENT_PLAN_JSON_SCHEMA,
    buildPlanningPrompt,
    PLANNING_USER_PROMPT,
} from "./prompts/planPrompt.js";
import {
    checkCircularDependencies,
    flattenPlan,
    matchConstraint,
    validatePlan,
} from "./planValidator.js";
import { AgentPlan } from "./specSchema.js";
import { SYSTEM_PROMPT } from "./prompts/systemPrompt.js";

/*
- Create a sample CSS file with an existing theme (hardcoded colors)
- Write a prompt that gives the LLM the task + the CSS file contents and asks it to emit a JSON intent spec (what file, what block, what properties must change)
- Write a second prompt that acts as the agent — give it the task + CSS contents + the intent spec, ask it to output a tool call trace (just a JSON log of what it read/wrote and the new file content)
- Write a checker that takes the spec + before CSS + after CSS and validates each predicate (file changed, theme block exists, all color values differ)
- Run a happy path test, then break it intentionally (agent only changes some colors, writes wrong file, etc.) and confirm the checker catches each failure
- Log pass/fail per predicate so you can see exactly which part of the spec was violated, not just a binary result

*/

const TEST_DIR_PATH = "F:\\dev\\fawnRuns";
const SRC_PATH = "./testProject";
interface TestAgent {
    systemPrompt: string;
    currentPlanStep: number;
    completedPlanSteps: Set<number>;

    plan: (inputPrompt: string, workingDirectory: string) => Promise<AgentPlan>;
    run: (inputPrompt: string) => Promise<boolean>;
}

type ClaudeQueryParams = {
    prompt: string;
    options: Options;
};

type ClaudeCanUseToolOptions = {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
};

function createTestAgent(): TestAgent {
    const systemPrompt = SYSTEM_PROMPT; // TODO helper to build system prompt
    let currentPlanStep = 0;
    const completedPlanSteps = new Set<number>();
    const bindingsMap = new Map<string, unknown>(); // unknown here being raw tool output TODO add type for this

    return {
        systemPrompt,
        currentPlanStep,
        completedPlanSteps,
        run,
        plan,
    };

    function createWorkingDirectory(
        testDirPath: string,
        srcPath: string,
    ): string {
        const runId = randomBytes(3).toString("hex");
        const runPath = path.join(testDirPath, runId);

        mkdirSync(runPath, { recursive: true });
        cpSync(srcPath, runPath, { recursive: true });

        return runPath;
    }

    async function plan(
        inputPrompt: string,
        workingDirectory: string,
    ): Promise<AgentPlan> {
        const claudeInitPackageValidation: ClaudeQueryParams = {
            prompt: PLANNING_USER_PROMPT,
            options: {
                cwd: workingDirectory,
                tools: [],
                outputFormat: {
                    type: "json_schema",
                    schema: AGENT_PLAN_JSON_SCHEMA,
                },
                systemPrompt: buildPlanningPrompt(
                    inputPrompt,
                    workingDirectory,
                ),
                maxTurns: 1,
            },
        };

        let generatedPlan: AgentPlan | undefined = undefined;
        for await (const message of query(claudeInitPackageValidation)) {
            if (message.type === "assistant") {
                message.message.content.forEach((value) => {
                    if (value.type === "tool_use") {
                        generatedPlan = value.input as AgentPlan;
                    }
                });
            }
        }

        if (!generatedPlan) {
            throw Error("Failed to generate plan");
        }

        // Check if plan is valid
        const result = validatePlan(generatedPlan);
        if (!result.valid) {
            console.warn("Warnings:", result.warnings);
            throw Error("Validation errors:" + result.errors);
        } else {
            console.log("Plan is valid!");
        }

        // Check for circular dependencies
        const cycles = checkCircularDependencies(generatedPlan);
        if (cycles.length > 0) {
            console.error("Circular dependencies:", cycles);
        }

        return generatedPlan;
    }

    async function run(inputPrompt: string): Promise<boolean> {
        const workingDirectory = createWorkingDirectory(
            TEST_DIR_PATH,
            SRC_PATH,
        );

        const abortController = new AbortController();
        let abortReason: string | undefined = undefined;

        const runPlan = await plan(inputPrompt, workingDirectory);
        // runPlan.bindings.forEach((binding) => {
        //     console.log(binding);
        // })
        // runPlan.steps.forEach((step) => {
        //     console.log(step);
        // })
        const flattenedPlan = flattenPlan(runPlan);
        console.log(flattenedPlan);

        const canUseTool = async (
            toolName: string,
            input: Record<string, unknown>,
            options?: ClaudeCanUseToolOptions,
        ): Promise<PermissionResult> => {
            const expectedStep = flattenedPlan[currentPlanStep];

            if (toolName !== expectedStep.tool) {
                console.log(
                    `Tool ${toolName} does not match plan tool ${expectedStep.tool} for step ${currentPlanStep}`,
                );
                const abortReason = `Tool ${toolName} does not match plan tool ${expectedStep.tool} for step ${currentPlanStep}`;
                abortController.abort(abortReason);
            }

            Object.keys(expectedStep.inputSpec).forEach((key) => {
                const inputConstraint = expectedStep.inputSpec[key];
                const result = matchConstraint(
                    input[key],
                    inputConstraint,
                    bindingsMap,
                );
                if (!result.valid) {
                    console.log(`Invalid input constraint: ${result.reason}`);
                    abortReason = `Invalid input constraint: ${result.reason}`;
                    abortController.abort(abortReason);
                }
            });

            expectedStep.dependsOn.forEach((dependency) => {
                if (!completedPlanSteps.has(dependency)) {
                    console.log(
                        `Dependency on step ${dependency} missing from completed`,
                    );
                    abortReason = `Dependency on step ${dependency} missing from completed`;
                    abortController.abort(abortReason);
                }
            });

            return {
                updatedInput: input,
                behavior: "allow",
            };
        };

        const postToolUse = async (input: HookInput) => {
            input = input as PostToolUseHookInput; // annoying that anthropic isn't typing properly

            const expectedStep = flattenedPlan[currentPlanStep];

            if (expectedStep.effect.type === "produces") {
                bindingsMap.set(expectedStep.effect.bind, input.tool_response);
            }

            console.log(`Step Completed: ${currentPlanStep}`);
            completedPlanSteps.add(expectedStep.index);
            currentPlanStep++;

            return { continue: true };
        };

        const claudeInitPackage: ClaudeQueryParams = {
            prompt: inputPrompt,
            options: {
                cwd: workingDirectory,
                tools: {
                    type: "preset",
                    preset: "claude_code",
                },
                disallowedTools: [],
                canUseTool,
                hooks: {
                    PostToolUse: [
                        {
                            hooks: [postToolUse],
                        },
                    ],
                },
                systemPrompt,
                permissionMode: "default",
                allowDangerouslySkipPermissions: true,
                abortController: abortController,
                maxTurns: 50,
            },
        };

        // Full Process:
        // 1. CC asked to create a plan and output it in the form of the schema defined (the logical language)
        //    the logical language should be complete enough that the LLM can form any plan it needs to out
        //    of it's predicates
        // 2. Plan is validated to ensure it is a sound plan (ie the validator compiles the plan without any errors)
        //    Also the steps are not circular but follow a linear progression, no interdependent steps
        // 3. CC begins executing the plan
        // 4. After each tool call, CC updates the plan with where it is and what it just did. If what
        //    it just did doesn't match plan fail and retry that step of plan. otherwise re validate
        //    and continue execution
        // 5. After each tool call the input to the tool and output are persisted in the ledger for that
        //    plan
        // 6. If we want to retrace any part of the plan up to that point, we can go through the ledger
        //    step by step

        console.log("Running agent...");

        for await (const message of query(claudeInitPackage)) {
            //  if (abortController.signal.aborted) {
            //     console.log(`❌ Aborted: ${abortReason}`);
            //     break;
            // }
            switch (message.type) {
                case "assistant": {
                    printAssistant(message);
                    break;
                }
                case "system": {
                    console.log(`System: ${message.subtype}`);
                    break;
                }
                case "auth_status": {
                    console.log(`Auth Status: ${message.output}`);
                    break;
                }
                case "result": {
                    console.log(`Result: ${(message as any).result}`);
                    break;
                }
                case "stream_event": {
                    console.log(`Stream Event: ${message.event}`);
                    break;
                }
                case "tool_progress": {
                    console.log(`Tool Progress: ${message}`);
                    break;
                }
                case "user": {
                    printUser(message);
                    break;
                }
                default: {
                    break;
                }
            }
        }

        return true;
    }
}

const testAgent = createTestAgent();
testAgent.run("update the colors of the css file to a custom theme");
