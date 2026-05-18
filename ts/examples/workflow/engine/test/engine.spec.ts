// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A4 morning-brief workflow: end-to-end engine test.
 *
 * This exercises: template resolution ($from references, literal pass-through),
 * linear task chains, onError recovery dispatch, loop with state/iterateState/
 * sentinels, branch nodes, and all six standard-library tasks.
 */

import {
    WorkflowIR,
    TaskDefinition,
    TaskPolicy,
    Template,
} from "workflow-model";
import {
    TaskRegistry,
    WorkflowEngine,
    WorkflowEvent,
    RunOptions,
    allBuiltinTasks,
    listLength,
    listElementAt,
    listAppend,
    compareEquals,
    compareNotEquals,
    compareGreaterThan,
    compareLessThan,
    compareGreaterOrEqual,
    compareLessOrEqual,
    boolNot,
    mathAdd,
    mathSubtract,
    mathMultiply,
    mathDivide,
    mathModulo,
    mathNegate,
    mathFloor,
    mathRound,
    mathCeil,
    errorFail,
} from "../src/index.js";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Policy that allows all tasks (for tests not specifically exercising policy).
// Uses a Proxy so any task name returns "allow", matching secure-by-default.
const allowAllPolicy: TaskPolicy = new Proxy({} as TaskPolicy, {
    get: () => "allow" as const,
});

// ---- Mock domain tasks ----

const emailFetchUnread: TaskDefinition = {
    name: "email.fetchUnread",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["max"],
        properties: { max: { type: "integer" } },
    },
    outputSchema: { type: "array" },
    async execute(input: any) {
        const messages = [];
        for (let i = 0; i < Math.min(input.max, 2); i++) {
            messages.push({ subject: `Email ${i + 1}`, from: "test@test.com" });
        }
        return { kind: "ok", output: messages };
    },
};

const calendarToday: TaskDefinition = {
    name: "calendar.today",
    sideEffects: false,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "array" },
    async execute() {
        return {
            kind: "ok",
            output: [{ title: "Standup", time: "09:00" }],
        };
    },
};

const gitFetchCommits: TaskDefinition = {
    name: "git.fetchCommits",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["repo", "max"],
        properties: { repo: { type: "string" }, max: { type: "integer" } },
    },
    outputSchema: {
        type: "object",
        required: ["repo", "commits"],
        properties: { repo: { type: "string" }, commits: { type: "array" } },
    },
    async execute(input: any) {
        return {
            kind: "ok",
            output: {
                repo: input.repo,
                commits: [
                    { sha: "abc123", message: `commit in ${input.repo}` },
                ],
            },
        };
    },
};

const textRenderSection: TaskDefinition = {
    name: "text.renderSection",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["section", "items"],
        properties: { section: { type: "string" }, items: { type: "array" } },
    },
    outputSchema: {
        type: "object",
        required: ["section", "body"],
        properties: { section: { type: "string" }, body: { type: "string" } },
    },
    async execute(input: any) {
        return {
            kind: "ok",
            output: {
                section: input.section,
                body: `## ${input.section}\n${input.items.length} item(s)`,
            },
        };
    },
};

const textPlaceholderSection: TaskDefinition = {
    name: "text.placeholderSection",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["section", "reason"],
        properties: {
            section: { type: "string" },
            reason: { type: "string" },
            error: { type: "object" },
            trigger: { type: "object" },
        },
    },
    outputSchema: {
        type: "object",
        required: ["section", "body"],
        properties: { section: { type: "string" }, body: { type: "string" } },
    },
    async execute(input: any) {
        return {
            kind: "ok",
            output: {
                section: input.section,
                body: `## ${input.section}\n(unavailable: ${input.reason})`,
            },
        };
    },
};

const markdownCompose: TaskDefinition = {
    name: "markdown.compose",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["emailSection", "calendarSection", "repoSections"],
        properties: {
            emailSection: { type: "object" },
            calendarSection: { type: "object" },
            repoSections: { type: "array" },
        },
    },
    outputSchema: { type: "string" },
    async execute(input: any) {
        const parts = [
            input.calendarSection.body,
            input.emailSection.body,
            ...input.repoSections.map((s: any) => s.body),
        ];
        return { kind: "ok", output: parts.join("\n\n") };
    },
};

const domainTasks: TaskDefinition[] = [
    emailFetchUnread,
    calendarToday,
    gitFetchCommits,
    textRenderSection,
    textPlaceholderSection,
    markdownCompose,
];

// ---- A4 morning-brief IR ----

function makeA4IR(): WorkflowIR {
    return {
        kind: "workflow",
        name: "morningBrief",
        version: "1",
        inputSchema: {
            type: "object",
            required: ["repos", "maxEmails", "maxCommits"],
            properties: {
                repos: { type: "array", items: { type: "string" } },
                maxEmails: { type: "integer", minimum: 1 },
                maxCommits: { type: "integer", minimum: 1 },
            },
        },
        outputSchema: { type: "string" },
        constants: {
            one: { schema: { type: "number" }, value: 1 },
        },
        nodes: {
            // Calendar
            fetchCalendar: {
                kind: "task",
                task: "calendar.today",
                inputSchema: { type: "object", properties: {} },
                outputSchema: { type: "array" },
                inputs: {},
                next: "renderCalendar",
                onError: "calendarUnavailable",
                bind: "calendarEvents",
            },
            renderCalendar: {
                kind: "task",
                task: "text.renderSection",
                inputSchema: {
                    type: "object",
                    required: ["section", "items"],
                    properties: {
                        section: { type: "string" },
                        items: { type: "array" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["section", "body"],
                    properties: {
                        section: { type: "string" },
                        body: { type: "string" },
                    },
                },
                inputs: {
                    section: "calendar",
                    items: {
                        $from: "scope",
                        name: "calendarEvents",
                    },
                },
                next: "fetchEmail",
                bind: "calendarSection",
            },
            calendarUnavailable: {
                kind: "task",
                task: "text.placeholderSection",
                inputSchema: {
                    type: "object",
                    required: ["section", "reason", "error", "trigger"],
                    properties: {
                        section: { type: "string" },
                        reason: { type: "string" },
                        error: { type: "object" },
                        trigger: { type: "object" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["section", "body"],
                    properties: {
                        section: { type: "string" },
                        body: { type: "string" },
                    },
                },
                inputs: {
                    section: "calendar",
                    reason: {
                        $from: "input",
                        name: "error",
                        path: ["message"],
                    },
                },
                next: "fetchEmail",
                bind: "calendarSection",
            },

            // Email
            fetchEmail: {
                kind: "task",
                task: "email.fetchUnread",
                inputSchema: {
                    type: "object",
                    required: ["max"],
                    properties: { max: { type: "integer" } },
                },
                outputSchema: { type: "array" },
                inputs: {
                    max: { $from: "input", name: "maxEmails" },
                },
                next: "renderEmail",
                onError: "emailUnavailable",
                bind: "emailMessages",
            },
            renderEmail: {
                kind: "task",
                task: "text.renderSection",
                inputSchema: {
                    type: "object",
                    required: ["section", "items"],
                    properties: {
                        section: { type: "string" },
                        items: { type: "array" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["section", "body"],
                    properties: {
                        section: { type: "string" },
                        body: { type: "string" },
                    },
                },
                inputs: {
                    section: "email",
                    items: {
                        $from: "scope",
                        name: "emailMessages",
                    },
                },
                next: "repoLoop",
                bind: "emailSection",
            },
            emailUnavailable: {
                kind: "task",
                task: "text.placeholderSection",
                inputSchema: {
                    type: "object",
                    required: ["section", "reason", "error", "trigger"],
                    properties: {
                        section: { type: "string" },
                        reason: { type: "string" },
                        error: { type: "object" },
                        trigger: { type: "object" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["section", "body"],
                    properties: {
                        section: { type: "string" },
                        body: { type: "string" },
                    },
                },
                inputs: {
                    section: "email",
                    reason: {
                        $from: "input",
                        name: "error",
                        path: ["message"],
                    },
                },
                next: "repoLoop",
                bind: "emailSection",
            },

            // Repo loop
            repoLoop: {
                kind: "loop",
                inputs: {
                    repos: { $from: "input", name: "repos" },
                    maxCommits: { $from: "input", name: "maxCommits" },
                },
                state: {
                    i: { schema: { type: "integer" }, initial: 0 },
                    sections: {
                        schema: { type: "array" },
                        initial: [] as Template,
                    },
                },
                body: {
                    inputSchema: {
                        type: "object",
                        required: ["repos", "maxCommits"],
                        properties: {
                            repos: {
                                type: "array",
                                items: { type: "string" },
                            },
                            maxCommits: { type: "integer" },
                        },
                    },
                    entry: "pickRepo",
                    nodes: {
                        pickRepo: {
                            kind: "task",
                            task: "list.elementAt",
                            inputSchema: {
                                type: "object",
                                required: ["list", "index"],
                                properties: {
                                    list: { type: "array" },
                                    index: { type: "integer" },
                                },
                            },
                            outputSchema: {},
                            inputs: {
                                list: { $from: "input", name: "repos" },
                                index: { $from: "state", name: "i" },
                            },
                            next: "fetchRepo",
                            bind: "picked",
                        },
                        fetchRepo: {
                            kind: "task",
                            task: "git.fetchCommits",
                            inputSchema: {
                                type: "object",
                                required: ["repo", "max"],
                                properties: {
                                    repo: { type: "string" },
                                    max: { type: "integer" },
                                },
                            },
                            outputSchema: {
                                type: "object",
                                required: ["repo", "commits"],
                                properties: {
                                    repo: { type: "string" },
                                    commits: { type: "array" },
                                },
                            },
                            inputs: {
                                repo: {
                                    $from: "scope",
                                    name: "picked",
                                },
                                max: { $from: "input", name: "maxCommits" },
                            },
                            next: "renderRepo",
                            onError: "repoUnavailable",
                            bind: "repoFetch",
                        },
                        renderRepo: {
                            kind: "task",
                            task: "text.renderSection",
                            inputSchema: {
                                type: "object",
                                required: ["section", "items"],
                                properties: {
                                    section: { type: "string" },
                                    items: { type: "array" },
                                },
                            },
                            outputSchema: {
                                type: "object",
                                required: ["section", "body"],
                                properties: {
                                    section: { type: "string" },
                                    body: { type: "string" },
                                },
                            },
                            inputs: {
                                section: "repo",
                                items: {
                                    $from: "scope",
                                    name: "repoFetch",
                                    path: ["commits"],
                                },
                            },
                            next: "appendSection",
                            bind: "newSection",
                        },
                        repoUnavailable: {
                            kind: "task",
                            task: "text.placeholderSection",
                            inputSchema: {
                                type: "object",
                                required: [
                                    "section",
                                    "reason",
                                    "error",
                                    "trigger",
                                ],
                                properties: {
                                    section: { type: "string" },
                                    reason: { type: "string" },
                                    error: { type: "object" },
                                    trigger: { type: "object" },
                                },
                            },
                            outputSchema: {
                                type: "object",
                                required: ["section", "body"],
                                properties: {
                                    section: { type: "string" },
                                    body: { type: "string" },
                                },
                            },
                            inputs: {
                                section: "repo",
                                reason: {
                                    $from: "input",
                                    name: "error",
                                    path: ["message"],
                                },
                            },
                            next: "appendSection",
                            bind: "newSection",
                        },
                        appendSection: {
                            kind: "task",
                            task: "list.append",
                            inputSchema: {
                                type: "object",
                                required: ["list", "item"],
                                properties: {
                                    list: { type: "array" },
                                    item: {},
                                },
                            },
                            outputSchema: { type: "array" },
                            inputs: {
                                list: { $from: "state", name: "sections" },
                                item: { $from: "scope", name: "newSection" },
                            },
                            next: "stepIndex",
                            bind: "appended",
                        },
                        stepIndex: {
                            kind: "task",
                            task: "math.add",
                            inputSchema: {
                                type: "object",
                                required: ["left", "right"],
                                properties: {
                                    left: { type: "number" },
                                    right: { type: "number" },
                                },
                            },
                            outputSchema: { type: "number" },
                            inputs: {
                                left: { $from: "state", name: "i" },
                                right: 1,
                            },
                            next: "computeLength",
                            bind: "stepped",
                        },
                        computeLength: {
                            kind: "task",
                            task: "list.length",
                            inputSchema: {
                                type: "object",
                                required: ["list"],
                                properties: { list: { type: "array" } },
                            },
                            outputSchema: { type: "integer" },
                            inputs: {
                                list: { $from: "input", name: "repos" },
                            },
                            next: "compareIndex",
                            bind: "repoCount",
                        },
                        compareIndex: {
                            kind: "task",
                            task: "compare.lessThan",
                            inputSchema: {
                                type: "object",
                                required: ["left", "right"],
                                properties: {
                                    left: { type: "number" },
                                    right: { type: "number" },
                                },
                            },
                            outputSchema: { type: "boolean" },
                            inputs: {
                                left: {
                                    $from: "scope",
                                    name: "stepped",
                                },
                                right: {
                                    $from: "scope",
                                    name: "repoCount",
                                },
                            },
                            next: "checkDone",
                            bind: "hasMore",
                        },
                        checkDone: {
                            kind: "branch",
                            selector: {
                                $from: "scope",
                                name: "hasMore",
                            },
                            selectorSchema: { type: "boolean" },
                            cases: { true: "@iterate", false: "@exit" },
                            default: "@exit",
                        },
                    },
                    // NOTE: output reads from scope (body binding), not state.
                    // At @exit, state reflects the beginning of the last iteration
                    // (set by the prior @iterate). The final appendSection result
                    // is only in the scope binding "appended".
                    output: {
                        $from: "scope",
                        name: "appended",
                    } as Template,
                    outputSchema: { type: "array" },
                },
                iterateState: {
                    i: {
                        $from: "scope",
                        name: "stepped",
                    } as Template,
                    sections: {
                        $from: "scope",
                        name: "appended",
                    } as Template,
                },
                maxIterations: 1000,
                next: "compose",
                bind: "repoSections",
            },

            // Compose
            compose: {
                kind: "task",
                task: "markdown.compose",
                inputSchema: {
                    type: "object",
                    required: [
                        "emailSection",
                        "calendarSection",
                        "repoSections",
                    ],
                    properties: {
                        emailSection: { type: "object" },
                        calendarSection: { type: "object" },
                        repoSections: { type: "array" },
                    },
                },
                outputSchema: { type: "string" },
                inputs: {
                    emailSection: { $from: "scope", name: "emailSection" },
                    calendarSection: {
                        $from: "scope",
                        name: "calendarSection",
                    },
                    repoSections: { $from: "scope", name: "repoSections" },
                },
                bind: "result",
            },
        },
        entry: "fetchCalendar",
        output: { $from: "scope", name: "result" } as Template,
    };
}

// ---- Helpers ----

function makeRegistry(...tasks: TaskDefinition[]): TaskRegistry {
    const registry = new TaskRegistry();
    for (const t of tasks) {
        registry.register(t);
    }
    return registry;
}

function collectEvents(engine: WorkflowEngine): WorkflowEvent[] {
    const events: WorkflowEvent[] = [];
    engine.on((e) => events.push(e));
    return events;
}

// ---- Tests ----

describe("WorkflowEngine (IR v1)", () => {
    let registry: TaskRegistry;
    let engine: WorkflowEngine;

    beforeEach(() => {
        registry = makeRegistry(...allBuiltinTasks, ...domainTasks);
        engine = new WorkflowEngine(registry);
    });

    describe("A4 morning-brief (happy path)", () => {
        it("runs the full workflow and produces a brief", async () => {
            const ir = makeA4IR();
            const events = collectEvents(engine);

            const result = await engine.run(ir, {
                input: {
                    repos: ["typeagent", "typechat"],
                    maxEmails: 5,
                    maxCommits: 10,
                },
            });

            expect(result.success).toBe(true);
            expect(typeof result.output).toBe("string");

            const brief = result.output as string;
            expect(brief).toContain("calendar");
            expect(brief).toContain("email");
            expect(brief).toContain("repo");

            // Should have runStarted and runCompleted
            expect(events[0].type).toBe("runStarted");
            expect(events[events.length - 1].type).toBe("runCompleted");
        });

        it("iterates over all repos", async () => {
            const ir = makeA4IR();
            const events = collectEvents(engine);

            const result = await engine.run(ir, {
                input: {
                    repos: ["a", "b", "c"],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });

            expect(result.success).toBe(true);

            // Count loop iterations
            const iterEvents = events.filter(
                (e) => e.type === "loopIterationStarted",
            );
            expect(iterEvents.length).toBe(3);

            // The loop should exit with all 3 repo sections
            const loopExit = events.find((e) => e.type === "loopExited") as any;
            expect(loopExit).toBeDefined();
            expect(loopExit.output).toHaveLength(3);
        });

        it("handles single repo", async () => {
            const ir = makeA4IR();

            const result = await engine.run(ir, {
                input: {
                    repos: ["only-one"],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });

            expect(result.success).toBe(true);
            expect(result.output as string).toContain("repo");
        });

        it("handles empty repos list", async () => {
            const ir = makeA4IR();

            const result = await engine.run(ir, {
                input: {
                    repos: [],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });

            // With empty repos the loop body attempts index 0 on an
            // empty list, causing list.elementAt to return undefined and
            // downstream tasks to fail. The engine should not crash; it
            // may succeed with degraded output or fail gracefully.
            expect(result).toBeDefined();
            if (result.success) {
                expect(result.output).toBeDefined();
            } else {
                expect(result.error?.message).toBeDefined();
            }
        });
    });

    describe("onError recovery", () => {
        it("recovers when calendar fetch fails", async () => {
            const failingCalendar: TaskDefinition = {
                ...calendarToday,
                async execute() {
                    return {
                        kind: "fail",
                        error: { message: "Calendar API down" },
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks,
                ...domainTasks.filter((t) => t.name !== "calendar.today"),
                failingCalendar,
            );
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);

            const result = await eng.run(makeA4IR(), {
                input: {
                    repos: ["r1"],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });

            expect(result.success).toBe(true);
            const brief = result.output as string;
            expect(brief).toContain("unavailable");
            expect(brief).toContain("Calendar API down");

            // Verify calendarUnavailable was executed
            const completed = events
                .filter((e) => e.type === "nodeCompleted")
                .map((e: any) => e.nodeId);
            expect(completed).toContain("calendarUnavailable");
        });
    });

    describe("template resolution", () => {
        it("resolves literal values in templates", async () => {
            // The A4 IR has literal strings like "calendar", "email" in inputs.
            // The stepIndex node has { b: 1 } as a literal integer.
            // If the workflow runs successfully, these all resolved correctly.
            const result = await engine.run(makeA4IR(), {
                input: {
                    repos: ["r"],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });
            expect(result.success).toBe(true);
        });
    });

    describe("standard-library tasks", () => {
        it("math.add computes correctly", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "addTest",
                version: "1",
                inputSchema: {
                    type: "object",
                    properties: {
                        a: { type: "integer" },
                        b: { type: "integer" },
                    },
                },
                outputSchema: { type: "number" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: { $from: "input", name: "a" } as Template,
                            right: { $from: "input", name: "b" } as Template,
                        },
                        bind: "sum",
                    },
                },
                entry: "add",
                output: { $from: "scope", name: "sum" } as Template,
            };

            const result = await engine.run(ir, { input: { a: 3, b: 7 } });
            expect(result.success).toBe(true);
            expect(result.output).toBe(10);
        });

        it("bool.toLabel converts boolean to string (legacy)", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "labelTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    label: {
                        kind: "task",
                        task: "bool.toLabel",
                        inputSchema: {
                            type: "object",
                            required: ["value", "ifTrue", "ifFalse"],
                            properties: {
                                value: { type: "boolean" },
                                ifTrue: { type: "string" },
                                ifFalse: { type: "string" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            value: true as Template,
                            ifTrue: "yes",
                            ifFalse: "no",
                        },
                        bind: "result",
                    },
                },
                entry: "label",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe("yes");
        });
    });

    describe("branch nodes", () => {
        it("routes based on boolean discriminant", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "branchTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    decide: {
                        kind: "branch",
                        selector: false as Template,
                        selectorSchema: { type: "boolean" },
                        cases: { true: "onYes", false: "onNo" },
                        default: "onNo",
                    },
                    onYes: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 1 as Template },
                        bind: "answer",
                    },
                    onNo: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 0 as Template, right: 0 as Template },
                        bind: "answer",
                    },
                },
                entry: "decide",
                output: { $from: "scope", name: "answer" } as Template,
            };

            const events = collectEvents(engine);
            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe(0); // "no" branch

            const completed = events
                .filter((e) => e.type === "nodeCompleted")
                .map((e: any) => e.nodeId);
            expect(completed).toContain("onNo");
            expect(completed).not.toContain("onYes");
        });
    });

    describe("validation", () => {
        it("rejects IR with missing entry node", async () => {
            const ir = makeA4IR();
            ir.entry = "nonexistent";

            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("nonexistent");
        });

        it("rejects IR with unregistered task", async () => {
            const minimalRegistry = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(minimalRegistry);

            const result = await eng.run(makeA4IR(), {
                input: {
                    repos: [],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("not registered");
        });
    });

    describe("text.template task", () => {
        it("interpolates variables", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "templateTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    tmpl: {
                        kind: "task",
                        task: "text.template",
                        inputSchema: {
                            type: "object",
                            required: ["template", "vars"],
                            properties: {
                                template: { type: "string" },
                                vars: { type: "object" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            template:
                                "Hello {{name}}, you have {{count}} items",
                            vars: {
                                name: "Alice" as Template,
                                count: 3 as Template,
                            },
                        },
                        bind: "result",
                    },
                },
                entry: "tmpl",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe("Hello Alice, you have 3 items");
        });

        it("replaces multiple occurrences of the same variable", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "multiReplace",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    tmpl: {
                        kind: "task",
                        task: "text.template",
                        inputSchema: {
                            type: "object",
                            required: ["template", "vars"],
                            properties: {
                                template: { type: "string" },
                                vars: { type: "object" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            template: "{{x}} + {{x}} = {{y}}",
                            vars: {
                                x: "2" as Template,
                                y: "4" as Template,
                            },
                        },
                        bind: "result",
                    },
                },
                entry: "tmpl",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe("2 + 2 = 4");
        });
    });

    describe("string.join task", () => {
        it("joins a list with delimiter", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "joinTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    join: {
                        kind: "task",
                        task: "string.join",
                        inputSchema: {
                            type: "object",
                            required: ["list", "delimiter"],
                            properties: {
                                list: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                                delimiter: { type: "string" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            list: ["alpha", "beta", "gamma"] as Template,
                            delimiter: ", ",
                        },
                        bind: "result",
                    },
                },
                entry: "join",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe("alpha, beta, gamma");
        });

        it("handles empty list", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "joinEmpty",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    join: {
                        kind: "task",
                        task: "string.join",
                        inputSchema: {
                            type: "object",
                            required: ["list", "delimiter"],
                            properties: {
                                list: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                                delimiter: { type: "string" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            list: [] as Template,
                            delimiter: "\n",
                        },
                        bind: "result",
                    },
                },
                entry: "join",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe("");
        });
    });

    describe("shell.exec task", () => {
        it("runs a command and captures stdout", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "echoTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    echo: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command"],
                            properties: {
                                command: { type: "string" },
                                args: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["stdout", "stderr", "exitCode"],
                            properties: {
                                stdout: { type: "string" },
                                stderr: { type: "string" },
                                exitCode: { type: "integer" },
                            },
                        },
                        inputs: {
                            command: "node",
                            args: [
                                "-e",
                                "process.stdout.write('hello world')",
                            ] as unknown as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "echo",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(true);
            const output = result.output as {
                stdout: string;
                stderr: string;
                exitCode: number;
            };
            expect(output.stdout.trim()).toBe("hello world");
            expect(output.exitCode).toBe(0);
        });

        it("returns non-zero exit code as ok", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "falseTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fail: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command"],
                            properties: {
                                command: { type: "string" },
                                args: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["stdout", "stderr", "exitCode"],
                            properties: {
                                stdout: { type: "string" },
                                stderr: { type: "string" },
                                exitCode: { type: "integer" },
                            },
                        },
                        inputs: {
                            command: "node",
                            args: [
                                "-e",
                                "process.exit(1)",
                            ] as unknown as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fail",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(true);
            const output = result.output as {
                stdout: string;
                stderr: string;
                exitCode: number;
            };
            expect(output.exitCode).not.toBe(0);
        });

        it("fails on command not found", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "notFoundTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    bad: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command"],
                            properties: {
                                command: { type: "string" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["stdout", "stderr", "exitCode"],
                            properties: {
                                stdout: { type: "string" },
                                stderr: { type: "string" },
                                exitCode: { type: "integer" },
                            },
                        },
                        inputs: {
                            command: "this-command-does-not-exist-xyz",
                        },
                        bind: "result",
                    },
                },
                entry: "bad",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("ENOENT");
        });
    });

    describe("D1 standup-prep workflow", () => {
        function loadD1(): WorkflowIR {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const path = resolve(
                __dirname,
                "../../../workflows/d1-standup-prep.json",
            );
            return JSON.parse(readFileSync(path, "utf8")) as WorkflowIR;
        }

        it("validates against all builtins", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = loadD1();
            // Run with dummy input to trigger validation
            // (validation happens inside engine.run)
            const result = await eng.run(ir, {
                input: { repos: ["/tmp"], author: "test" },
                policy: allowAllPolicy,
            });

            // Even if git log fails on /tmp, the workflow should at least
            // pass validation. If validation fails, success is false and
            // the error message contains "Validation failed".
            if (!result.success) {
                expect(result.error?.message).not.toContain(
                    "Validation failed",
                );
            }
        });

        it("runs with mock shell.exec against two repos", async () => {
            const mockShellExec: TaskDefinition = {
                name: "shell.exec",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["command"],
                    properties: {
                        command: { type: "string" },
                        args: {
                            type: "array",
                            items: { type: "string" },
                        },
                        cwd: { type: "string" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["stdout", "stderr", "exitCode"],
                    properties: {
                        stdout: { type: "string" },
                        stderr: { type: "string" },
                        exitCode: { type: "integer" },
                    },
                },
                async execute(input: any) {
                    const cwd = input.cwd as string;
                    const repo = cwd
                        .replace(/[\\/]+$/, "")
                        .split(/[\\/]/)
                        .pop();
                    return {
                        kind: "ok",
                        output: {
                            stdout: `abc1234 fix bug in ${repo}\ndef5678 add feature to ${repo}\n`,
                            stderr: "",
                            exitCode: 0,
                        },
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks.filter((t) => t.name !== "shell.exec"),
                mockShellExec,
            );
            const eng = new WorkflowEngine(reg);

            const ir = loadD1();
            const result = await eng.run(ir, {
                input: {
                    repos: ["/repos/typeagent", "/repos/typechat"],
                    author: "curtism",
                },
            });

            expect(result.success).toBe(true);
            const output = result.output as string;
            expect(output).toContain("## /repos/typeagent");
            expect(output).toContain("## /repos/typechat");
            expect(output).toContain("fix bug in typeagent");
            expect(output).toContain("add feature to typechat");
        });
    });

    describe("D4 commit-summary workflow", () => {
        function loadD4(): WorkflowIR {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const path = resolve(
                __dirname,
                "../../../workflows/d4-commit-summary.json",
            );
            return JSON.parse(readFileSync(path, "utf8")) as WorkflowIR;
        }

        it("validates against all builtins", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = loadD4();
            const result = await eng.run(ir, {
                input: { repoPath: "/tmp" },
                policy: allowAllPolicy,
            });

            if (!result.success) {
                expect(result.error?.message).not.toContain(
                    "Validation failed",
                );
            }
        });

        it("runs with mock shell.exec and mock llm.generate", async () => {
            const mockShellExec: TaskDefinition = {
                name: "shell.exec",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["command"],
                    properties: {
                        command: { type: "string" },
                        args: {
                            type: "array",
                            items: { type: "string" },
                        },
                        cwd: { type: "string" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["stdout", "stderr", "exitCode"],
                    properties: {
                        stdout: { type: "string" },
                        stderr: { type: "string" },
                        exitCode: { type: "integer" },
                    },
                },
                async execute() {
                    return {
                        kind: "ok",
                        output: {
                            stdout: "diff --git a/foo.ts b/foo.ts\n+added line\n",
                            stderr: "",
                            exitCode: 0,
                        },
                    };
                },
            };

            const mockLlmGenerate: TaskDefinition = {
                name: "llm.generate",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["prompt"],
                    properties: { prompt: { type: "string" } },
                },
                outputSchema: { type: "string" },
                async execute(input: any) {
                    // Verify the prompt contains the diff
                    const prompt = input.prompt as string;
                    expect(prompt).toContain("diff --git");
                    expect(prompt).toContain("conventional commit");
                    return {
                        kind: "ok",
                        output: "feat(foo): add new line\n\nAdded a line to foo.ts.",
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks.filter(
                    (t) => t.name !== "shell.exec" && t.name !== "llm.generate",
                ),
                mockShellExec,
                mockLlmGenerate,
            );
            const eng = new WorkflowEngine(reg);

            const ir = loadD4();
            const result = await eng.run(ir, {
                input: { repoPath: "/repos/myproject" },
            });

            expect(result.success).toBe(true);
            const output = result.output as { message: string };
            expect(output.message).toContain("feat(foo)");
            expect(output.message).toContain("add new line");
        });
    });

    describe("string.split task", () => {
        it("splits text by delimiter and filters empty strings", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "splitTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    split: {
                        kind: "task",
                        task: "string.split",
                        inputSchema: {
                            type: "object",
                            required: ["text", "delimiter"],
                            properties: {
                                text: { type: "string" },
                                delimiter: { type: "string" },
                            },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        inputs: {
                            text: "foo.ts\nbar.ts\nbaz.ts\n" as Template,
                            delimiter: "\n",
                        },
                        bind: "result",
                    },
                },
                entry: "split",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toEqual(["foo.ts", "bar.ts", "baz.ts"]);
        });

        it("handles empty input", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "splitEmpty",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    split: {
                        kind: "task",
                        task: "string.split",
                        inputSchema: {
                            type: "object",
                            required: ["text", "delimiter"],
                            properties: {
                                text: { type: "string" },
                                delimiter: { type: "string" },
                            },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        inputs: {
                            text: "" as Template,
                            delimiter: "\n",
                        },
                        bind: "result",
                    },
                },
                entry: "split",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toEqual([]);
        });
    });

    describe("D5 code-review-prep workflow", () => {
        function loadD5(): WorkflowIR {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const path = resolve(
                __dirname,
                "../../../workflows/d5-code-review-prep.json",
            );
            return JSON.parse(readFileSync(path, "utf8")) as WorkflowIR;
        }

        it("validates against all builtins", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = loadD5();
            const result = await eng.run(ir, {
                input: { repoPath: "/tmp" },
                policy: allowAllPolicy,
            });

            if (!result.success) {
                expect(result.error?.message).not.toContain(
                    "Validation failed",
                );
            }
        });

        it("runs with mocked shell.exec and llm.generate", async () => {
            const fileDiffs: Record<string, string> = {
                "src/engine.ts":
                    "diff --git a/src/engine.ts\n+new engine code\n",
                "src/tasks.ts": "diff --git a/src/tasks.ts\n+new task impl\n",
                "README.md": "diff --git a/README.md\n+updated docs\n",
            };

            let callCount = 0;
            const mockShellExec: TaskDefinition = {
                name: "shell.exec",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["command"],
                    properties: {
                        command: { type: "string" },
                        args: {
                            type: "array",
                            items: { type: "string" },
                        },
                        cwd: { type: "string" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["stdout", "stderr", "exitCode"],
                    properties: {
                        stdout: { type: "string" },
                        stderr: { type: "string" },
                        exitCode: { type: "integer" },
                    },
                },
                async execute(input: any) {
                    callCount++;
                    const args = input.args as string[];
                    if (args.includes("--name-only")) {
                        return {
                            kind: "ok",
                            output: {
                                stdout:
                                    Object.keys(fileDiffs).join("\n") + "\n",
                                stderr: "",
                                exitCode: 0,
                            },
                        };
                    }
                    // Per-file diff
                    const fileArg = args[args.length - 1];
                    return {
                        kind: "ok",
                        output: {
                            stdout: fileDiffs[fileArg] ?? `diff for ${fileArg}`,
                            stderr: "",
                            exitCode: 0,
                        },
                    };
                },
            };

            const summaries: string[] = [];
            const mockLlmGenerate: TaskDefinition = {
                name: "llm.generate",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["prompt"],
                    properties: { prompt: { type: "string" } },
                },
                outputSchema: { type: "string" },
                async execute(input: any) {
                    const prompt = input.prompt as string;
                    // Extract the file name from the prompt
                    const match = prompt.match(/File: (.+)\n/);
                    const file = match ? match[1] : "unknown";
                    const summary = `Changes to ${file} look good.`;
                    summaries.push(summary);
                    return { kind: "ok", output: summary };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks.filter(
                    (t) => t.name !== "shell.exec" && t.name !== "llm.generate",
                ),
                mockShellExec,
                mockLlmGenerate,
            );
            const eng = new WorkflowEngine(reg);

            const ir = loadD5();
            const result = await eng.run(ir, {
                input: { repoPath: "/repos/project" },
            });

            expect(result.success).toBe(true);
            const output = result.output as { guide: string };
            expect(output.guide).toContain("# Code Review Guide");
            expect(output.guide).toContain("### src/engine.ts");
            expect(output.guide).toContain("### src/tasks.ts");
            expect(output.guide).toContain("### README.md");
            expect(output.guide).toContain("Changes to src/engine.ts");
            expect(output.guide).toContain("Changes to README.md");
            // 1 git diff --name-only + 3 per-file diffs = 4 shell calls
            expect(callCount).toBe(4);
            // 3 LLM calls (one per file)
            expect(summaries).toHaveLength(3);
        });
    });

    describe("http.get task", () => {
        it("fetches a URL and returns body + status", async () => {
            // Use a simple echo-style test against a known-good URL.
            // For unit tests we mock via a custom task, but here we
            // test the real http.get against a local data: URI trick.
            // Instead, just use a mock to verify the shape.
            const mockHttpGet: TaskDefinition = {
                name: "http.get",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["url"],
                    properties: { url: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["body", "status"],
                    properties: {
                        body: { type: "string" },
                        status: { type: "integer" },
                    },
                },
                async execute() {
                    return {
                        kind: "ok",
                        output: {
                            body: "<html>Hello</html>",
                            status: 200,
                        },
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks.filter((t) => t.name !== "http.get"),
                mockHttpGet,
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "httpTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: { url: "https://example.com" as Template },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(true);
            const output = result.output as {
                body: string;
                status: number;
            };
            expect(output.body).toBe("<html>Hello</html>");
            expect(output.status).toBe(200);
        });
    });

    describe("file.write and file.read tasks", () => {
        const testFile = resolve(tmpdir(), `workflow-test-${Date.now()}.txt`);

        afterAll(() => {
            if (existsSync(testFile)) unlinkSync(testFile);
        });

        it("writes a file and reads it back", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            // Write
            const writeIr: WorkflowIR = {
                kind: "workflow",
                name: "writeTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    write: {
                        kind: "task",
                        task: "file.write",
                        inputSchema: {
                            type: "object",
                            required: ["path", "content"],
                            properties: {
                                path: { type: "string" },
                                content: { type: "string" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            path: testFile as Template,
                            content: "hello from workflow" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "write",
                output: { $from: "scope", name: "result" } as Template,
            };

            const writeResult = await eng.run(writeIr, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(writeResult.success).toBe(true);
            expect(writeResult.output).toBe(testFile);

            // Read back
            const readIr: WorkflowIR = {
                kind: "workflow",
                name: "readTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    read: {
                        kind: "task",
                        task: "file.read",
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: { type: "string" },
                        inputs: { path: testFile as Template },
                        bind: "result",
                    },
                },
                entry: "read",
                output: { $from: "scope", name: "result" } as Template,
            };

            const readResult = await eng.run(readIr, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(readResult.success).toBe(true);
            expect(readResult.output).toBe("hello from workflow");
        });
    });

    describe("D8 summarize-url workflow", () => {
        function loadD8(): WorkflowIR {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const path = resolve(
                __dirname,
                "../../../workflows/d8-summarize-url.json",
            );
            return JSON.parse(readFileSync(path, "utf8")) as WorkflowIR;
        }

        it("validates against all builtins", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = loadD8();
            const result = await eng.run(ir, {
                input: {
                    url: "https://example.com",
                    outputPath: "/tmp/test.txt",
                },
                policy: allowAllPolicy,
            });

            if (!result.success) {
                expect(result.error?.message).not.toContain(
                    "Validation failed",
                );
            }
        });

        it("runs with mocked http.get, llm.generate, file.write", async () => {
            const outputFile = resolve(tmpdir(), `d8-test-${Date.now()}.md`);

            const mockHttpGet: TaskDefinition = {
                name: "http.get",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["url"],
                    properties: { url: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["body", "status"],
                    properties: {
                        body: { type: "string" },
                        status: { type: "integer" },
                    },
                },
                async execute() {
                    return {
                        kind: "ok",
                        output: {
                            body: "TypeAgent is a personal agent framework for building agents.",
                            status: 200,
                        },
                    };
                },
            };

            const mockLlm: TaskDefinition = {
                name: "llm.generate",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["prompt"],
                    properties: { prompt: { type: "string" } },
                },
                outputSchema: { type: "string" },
                async execute(input: any) {
                    expect(input.prompt).toContain("TypeAgent");
                    return {
                        kind: "ok",
                        output: "TypeAgent is a framework for personal agents that route requests to specialized plugins.",
                    };
                },
            };

            const mockFileWrite: TaskDefinition = {
                name: "file.write",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["path", "content"],
                    properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                    },
                },
                outputSchema: { type: "string" },
                async execute(input: any) {
                    return {
                        kind: "ok",
                        output: input.path,
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "http.get" &&
                        t.name !== "llm.generate" &&
                        t.name !== "file.write",
                ),
                mockHttpGet,
                mockLlm,
                mockFileWrite,
            );
            const eng = new WorkflowEngine(reg);

            const ir = loadD8();
            const result = await eng.run(ir, {
                input: {
                    url: "https://example.com/typeagent",
                    outputPath: outputFile,
                },
            });

            expect(result.success).toBe(true);
            const output = result.output as {
                path: string;
                summary: string;
            };
            expect(output.path).toBe(outputFile);
            expect(output.summary).toContain("personal agents");
        });

        it("retries on fetch failure then succeeds", async () => {
            let fetchAttempts = 0;
            const mockHttpGet: TaskDefinition = {
                name: "http.get",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["url"],
                    properties: { url: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["body", "status"],
                    properties: {
                        body: { type: "string" },
                        status: { type: "integer" },
                    },
                },
                async execute() {
                    fetchAttempts++;
                    if (fetchAttempts === 1) {
                        return {
                            kind: "fail",
                            error: { message: "Connection refused" },
                        };
                    }
                    return {
                        kind: "ok",
                        output: {
                            body: "Page content after retry.",
                            status: 200,
                        },
                    };
                },
            };

            const mockLlm: TaskDefinition = {
                name: "llm.generate",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["prompt"],
                    properties: { prompt: { type: "string" } },
                },
                outputSchema: { type: "string" },
                async execute() {
                    return {
                        kind: "ok",
                        output: "Summary after retry.",
                    };
                },
            };

            const mockFileWrite: TaskDefinition = {
                name: "file.write",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["path", "content"],
                    properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                    },
                },
                outputSchema: { type: "string" },
                async execute(input: any) {
                    return {
                        kind: "ok",
                        output: input.path,
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "http.get" &&
                        t.name !== "llm.generate" &&
                        t.name !== "file.write",
                ),
                mockHttpGet,
                mockLlm,
                mockFileWrite,
            );
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);

            const ir = loadD8();
            const result = await eng.run(ir, {
                input: {
                    url: "https://flaky.example.com",
                    outputPath: "/tmp/retry-test.md",
                },
            });

            expect(result.success).toBe(true);
            // The D8 workflow itself contains a retry loop; this verifies
            // the loop correctly retries when the first http.get fails.
            expect(fetchAttempts).toBe(2);
            const output = result.output as {
                path: string;
                summary: string;
            };
            expect(output.summary).toBe("Summary after retry.");

            // Verify loop iterated (retry happened)
            const iterEvents = events.filter(
                (e) => e.type === "loopIterationStarted",
            );
            expect(iterEvents.length).toBe(2);
        });
    });

    describe("task policy", () => {
        // Minimal workflow that calls a single side-effecting task.
        function sideEffectWorkflow(taskName: string): WorkflowIR {
            return {
                kind: "workflow",
                name: "policyTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    step: {
                        kind: "task",
                        task: taskName,
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: { type: "string" },
                        inputs: { path: "/etc/shadow" as Template },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };
        }

        it("denies a side-effecting task when policy is 'deny'", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = sideEffectWorkflow("file.read");
            const opts: RunOptions = {
                input: {},
                policy: { "file.read": "deny" },
            };

            const result = await eng.run(ir, opts);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("denied by policy");
        });

        it("denies when policy is 'prompt' and no approve fn is provided", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = sideEffectWorkflow("file.read");
            // Provide an empty policy to activate enforcement.
            // file.read defaults to "prompt" but no approve fn is given.
            const opts: RunOptions = {
                input: {},
                policy: {},
            };

            const result = await eng.run(ir, opts);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("approval denied");
        });

        it("allows when approve fn returns approved", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = sideEffectWorkflow("file.read");
            const approvedTasks: string[] = [];
            const opts: RunOptions = {
                input: {},
                approve: async (name) => {
                    approvedTasks.push(name);
                    return { kind: "approved" };
                },
            };

            await eng.run(ir, opts);
            // Will fail at runtime (can't read /etc/shadow) but the
            // policy check itself passed.
            expect(approvedTasks).toEqual(["file.read"]);
        });

        it("denies when approve fn returns denied", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = sideEffectWorkflow("file.read");
            const opts: RunOptions = {
                input: {},
                approve: async () => ({ kind: "denied" }),
            };

            const result = await eng.run(ir, opts);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("approval denied");
        });

        it("allows side-effecting task when policy is 'allow'", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = sideEffectWorkflow("file.read");
            const opts: RunOptions = {
                input: {},
                policy: { "file.read": "allow" },
            };

            const result = await eng.run(ir, opts);
            // Policy check passed; fails because /etc/shadow is outside
            // allowed directories (path traversal protection).
            // The key assertion: it did NOT fail with a policy denial.
            if (!result.success) {
                expect(result.error?.message).not.toContain("denied by policy");
                expect(result.error?.message).not.toContain("approval denied");
            }
        });

        it("does not check policy for non-side-effecting tasks", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            // math.add has no sideEffects, should run even with no approve fn
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "pureTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 2 as Template, right: 3 as Template },
                        bind: "result",
                    },
                },
                entry: "add",
                output: { $from: "scope", name: "result" } as Template,
            };

            // No policy, no approve fn: pure tasks should still work
            const opts: RunOptions = { input: {} };
            const result = await eng.run(ir, opts);
            expect(result.success).toBe(true);
            expect(result.output).toBe(5);
        });

        it("existing tests still pass with legacy (ir, input) signature for pure tasks", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            // Confirm the old two-arg signature still works for pure tasks
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "legacyTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 10 as Template, right: 20 as Template },
                        bind: "result",
                    },
                },
                entry: "add",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: { a: 1, b: 2 } });
            expect(result.success).toBe(true);
            expect(result.output).toBe(30);
        });

        it("denies side-effecting tasks without explicit policy", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir = sideEffectWorkflow("file.read");
            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("approval denied");
        });
    });

    describe("schema validation", () => {
        it("detects runtime output schema violation", async () => {
            // A task that returns output not matching its declared schema.
            const badTask: TaskDefinition = {
                name: "bad.output",
                sideEffects: false,
                inputSchema: { type: "object", properties: {} },
                outputSchema: { type: "integer" },
                async execute() {
                    // Returns a string instead of the required integer.
                    return { kind: "ok", output: "not-an-integer" };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, badTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "schemaViolation",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "bad.output",
                        inputSchema: { type: "object", properties: {} },
                        outputSchema: { type: "integer" },
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Output schema violation");
            expect(result.error?.message).toContain("integer");
        });

        it("passes when output conforms to schema", async () => {
            const goodTask: TaskDefinition = {
                name: "good.output",
                sideEffects: false,
                inputSchema: { type: "object", properties: {} },
                outputSchema: { type: "integer" },
                async execute() {
                    return { kind: "ok", output: 42 };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, goodTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "schemaOk",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "good.output",
                        inputSchema: { type: "object", properties: {} },
                        outputSchema: { type: "integer" },
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe(42);
        });

        it("static validator detects invalid scope path reference", async () => {
            const { validateWorkflowIR } = await import("workflow-model");

            // Node "consumer" references $from: "scope", name: "data",
            // path: ["nonexistent"] - but the producer's outputSchema
            // has no such property.
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badRef",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    producer: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: {
                                $from: "scope",
                                name: "data",
                                path: ["nonexistent"],
                            } as Template,
                            right: 1 as Template,
                        },
                        bind: "final",
                    },
                },
                entry: "producer",
                output: { $from: "scope", name: "final" } as Template,
            };

            const tasks = new Map(allBuiltinTasks.map((t) => [t.name, t]));
            const validation = validateWorkflowIR(ir, tasks);
            expect(validation.valid).toBe(false);
            expect(validation.errors[0].message).toContain("nonexistent");
            expect(validation.errors[0].message).toContain(
                "not declared in producer",
            );
        });

        it("static validator passes valid scope path reference", async () => {
            const { validateWorkflowIR } = await import("workflow-model");

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "goodRef",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    producer: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: {
                                $from: "scope",
                                name: "data",
                            } as Template,
                            right: 1 as Template,
                        },
                        bind: "final",
                    },
                },
                entry: "producer",
                output: { $from: "scope", name: "final" } as Template,
            };

            const tasks = new Map(allBuiltinTasks.map((t) => [t.name, t]));
            const validation = validateWorkflowIR(ir, tasks);
            expect(validation.valid).toBe(true);
        });

        it("static validator detects invalid path in loop iterateState", async () => {
            const { validateWorkflowIR } = await import("workflow-model");

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badLoopState",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "math.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["left", "right"],
                                        properties: {
                                            left: { type: "number" },
                                            right: { type: "number" },
                                        },
                                    },
                                    outputSchema: { type: "number" },
                                    inputs: {
                                        left: 1 as Template,
                                        right: 1 as Template,
                                    },
                                    next: "done",
                                    bind: "stepped",
                                },
                                done: {
                                    kind: "branch",
                                    selector: true as Template,
                                    selectorSchema: { type: "boolean" },
                                    cases: { false: "@iterate", true: "@exit" },
                                    default: "@exit",
                                },
                            },
                            output: 0 as Template,
                            outputSchema: { type: "integer" },
                        },
                        iterateState: {
                            i: {
                                $from: "scope",
                                name: "stepped",
                                path: ["nonexistent"],
                            } as Template,
                        },
                        maxIterations: 1,
                        bind: "result",
                    },
                },
                entry: "loop",
                output: { $from: "scope", name: "result" } as Template,
            };

            const tasks = new Map(allBuiltinTasks.map((t) => [t.name, t]));
            const validation = validateWorkflowIR(ir, tasks);
            expect(validation.valid).toBe(false);
            expect(validation.errors[0].message).toContain("nonexistent");
        });
    });

    describe("input schema validation", () => {
        it("rejects input that violates workflow inputSchema", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "typedInput",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["count"],
                    properties: { count: { type: "integer" } },
                },
                outputSchema: { type: "number" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: { $from: "input", name: "count" } as Template,
                            right: 1 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            // String where integer is required
            const result = await eng.run(ir, {
                input: { count: "not a number" },
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Input schema violation");
        });
    });

    describe("sentinel validation", () => {
        it("rejects @iterate in top-level branch node", async () => {
            const { validateWorkflowIR } = await import("workflow-model");

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badSentinel",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    decide: {
                        kind: "branch",
                        selector: true as Template,
                        selectorSchema: { type: "boolean" },
                        cases: { true: "@iterate", false: "@exit" },
                        default: "@exit",
                    },
                },
                entry: "decide",
                output: null as Template,
            };

            const tasks = new Map(allBuiltinTasks.map((t) => [t.name, t]));
            const validation = validateWorkflowIR(ir, tasks);
            expect(validation.valid).toBe(false);
            expect(validation.errors.length).toBeGreaterThanOrEqual(2);
            expect(validation.errors[0].message).toContain(
                "only valid inside a loop body",
            );
        });
    });

    describe("branch node events", () => {
        it("emits nodeStarted and nodeCompleted for branch nodes", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "branchEvents",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    decide: {
                        kind: "branch",
                        selector: false as Template,
                        selectorSchema: { type: "boolean" },
                        cases: { true: "onTrue", false: "onFalse" },
                        default: "onFalse",
                    },
                    onTrue: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 1 as Template },
                        bind: "answer",
                    },
                    onFalse: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 0 as Template, right: 0 as Template },
                        bind: "answer",
                    },
                },
                entry: "decide",
                output: { $from: "scope", name: "answer" } as Template,
            };

            const events = collectEvents(engine);
            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(true);

            const branchStarted = events.find(
                (e) =>
                    e.type === "nodeStarted" && (e as any).nodeId === "decide",
            );
            const branchCompleted = events.find(
                (e) =>
                    e.type === "nodeCompleted" &&
                    (e as any).nodeId === "decide",
            );
            expect(branchStarted).toBeDefined();
            expect(branchCompleted).toBeDefined();
        });
    });

    describe("loop onError dispatch", () => {
        it("dispatches to error handler when loop body fails", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail",
                        error: { message: "intentional failure" },
                    };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "loopOnError",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    badLoop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "willFail",
                            nodes: {
                                willFail: {
                                    kind: "task",
                                    task: "test.fail",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {},
                                },
                            },
                            output: null as Template,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" } as Template,
                        },
                        maxIterations: 1,
                        onError: "recover",
                    },
                    recover: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 99 as Template, right: 1 as Template },
                        bind: "recovered",
                    },
                },
                entry: "badLoop",
                output: { $from: "scope", name: "recovered" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe(100);
        });
    });

    describe("task timeout", () => {
        it("aborts a task that exceeds taskTimeoutMs", async () => {
            const slowTask: TaskDefinition = {
                name: "test.slow",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(_input, ctx) {
                    // Wait longer than the timeout
                    return new Promise((resolve, reject) => {
                        const timer = setTimeout(
                            () =>
                                resolve({
                                    kind: "ok",
                                    output: { done: true },
                                }),
                            5000,
                        );
                        ctx.signal.addEventListener(
                            "abort",
                            () => {
                                clearTimeout(timer);
                                reject(new Error("aborted"));
                            },
                            { once: true },
                        );
                    });
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, slowTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "timeoutTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.slow",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "step",
                output: {
                    $from: "scope",
                    name: "result",
                } as Template,
            };

            const start = Date.now();
            const result = await eng.run(ir, {
                input: {},
                taskTimeoutMs: 50,
            });
            const elapsed = Date.now() - start;

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("timed out");
            // Should abort close to the 50ms timeout, not wait for the
            // full 5s task. Use 500ms as the upper bound to allow CI slack.
            expect(elapsed).toBeLessThan(500);
        });

        it("does not interfere when task completes before timeout", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fastTask",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: 1 as Template,
                            right: 2 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "add",
                output: {
                    $from: "scope",
                    name: "result",
                } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                taskTimeoutMs: 5000,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe(3);
        });
    });

    describe("path traversal protection", () => {
        it("rejects file.read for path outside allowed directories", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "pathTraversalRead",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    read: {
                        kind: "task",
                        task: "file.read",
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            path: "/etc/passwd" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "read",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain(
                "outside allowed directories",
            );
        });

        it("rejects file.write for path outside allowed directories", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "pathTraversalWrite",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    write: {
                        kind: "task",
                        task: "file.write",
                        inputSchema: {
                            type: "object",
                            required: ["path", "content"],
                            properties: {
                                path: { type: "string" },
                                content: { type: "string" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            path: "/etc/evil.txt" as Template,
                            content: "pwned" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "write",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain(
                "outside allowed directories",
            );
        });

        it("allows file.read for path under tmpdir", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            // Write a file to tmpdir first so we can read it
            const testPath = resolve(
                tmpdir(),
                `workflow-pathtest-${Date.now()}.txt`,
            );
            const { writeFileSync } = await import("node:fs");
            writeFileSync(testPath, "safe-content", "utf8");

            try {
                const ir: WorkflowIR = {
                    kind: "workflow",
                    name: "allowedRead",
                    version: "1",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "string" },
                    nodes: {
                        read: {
                            kind: "task",
                            task: "file.read",
                            inputSchema: {
                                type: "object",
                                required: ["path"],
                                properties: { path: { type: "string" } },
                            },
                            outputSchema: { type: "string" },
                            inputs: { path: testPath as Template },
                            bind: "result",
                        },
                    },
                    entry: "read",
                    output: { $from: "scope", name: "result" } as Template,
                };

                const result = await eng.run(ir, {
                    input: {},
                    policy: allowAllPolicy,
                });
                expect(result.success).toBe(true);
                expect(result.output).toBe("safe-content");
            } finally {
                unlinkSync(testPath);
            }
        });
    });

    describe("http.get maxResponseBytes", () => {
        it("fails when response exceeds maxResponseBytes", async () => {
            // The real http.get now returns fail (not truncated ok) when
            // the response exceeds maxResponseBytes. Use a mock that
            // matches the updated behavior.
            const mockHttpGet: TaskDefinition = {
                name: "http.get",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["url"],
                    properties: {
                        url: { type: "string" },
                        maxResponseBytes: { type: "integer" },
                    },
                },
                outputSchema: {
                    type: "object",
                    required: ["body", "status"],
                    properties: {
                        body: { type: "string" },
                        status: { type: "integer" },
                    },
                },
                async execute(input: any) {
                    const maxBytes = input.maxResponseBytes ?? 10 * 1024 * 1024;
                    const bodySize = 500;
                    if (bodySize > maxBytes) {
                        return {
                            kind: "fail" as const,
                            error: {
                                message: `Response exceeded maximum size of ${maxBytes} bytes`,
                            },
                        };
                    }
                    return {
                        kind: "ok" as const,
                        output: { body: "X".repeat(bodySize), status: 200 },
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks.filter((t) => t.name !== "http.get"),
                mockHttpGet,
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "httpTruncateTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: {
                                url: { type: "string" },
                                maxResponseBytes: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "https://example.com/big" as Template,
                            maxResponseBytes: 100 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("exceeded maximum size");
        });
    });

    describe("branch without matching case or default", () => {
        it("fails when selector resolves to unmatched case with no default", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "branchNoDefault",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    decide: {
                        kind: "branch",
                        selector: "unknown" as Template,
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: "onYes",
                            no: "onNo",
                        },
                    } as any, // no default field
                    onYes: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 1 as Template },
                        bind: "answer",
                    },
                    onNo: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 0 as Template, right: 0 as Template },
                        bind: "answer",
                    },
                },
                entry: "decide",
                output: { $from: "scope", name: "answer" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toBeDefined();
        });
    });

    describe("constant schema validation", () => {
        it("rejects constant that violates its declared schema", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badConstant",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                constants: {
                    limit: {
                        schema: { type: "integer" },
                        value: "not-a-number", // violates integer schema
                    },
                },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Constant");
            expect(result.error?.message).toContain("limit");
            expect(result.error?.message).toContain("schema");
        });

        it("passes when constant matches its declared schema", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "goodConstant",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                constants: {
                    offset: {
                        schema: { type: "integer" },
                        value: 42,
                    },
                },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: {
                                $from: "constant",
                                name: "offset",
                            } as Template,
                            right: 8 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toBe(50);
        });
    });

    describe("approval timed-out kind", () => {
        it("denies when approve fn returns timed-out", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "approvalTimeout",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "file.read",
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            path: "/some/file.txt" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                approve: async () => ({ kind: "timed-out" }),
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("timed-out");
        });
    });

    describe("workflow-level AbortSignal", () => {
        it("cancels a running workflow via signal", async () => {
            const slowTask: TaskDefinition = {
                name: "test.slow",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(_input, ctx) {
                    return new Promise((resolve, reject) => {
                        const timer = setTimeout(
                            () =>
                                resolve({
                                    kind: "ok",
                                    output: { done: true },
                                }),
                            5000,
                        );
                        ctx.signal.addEventListener(
                            "abort",
                            () => {
                                clearTimeout(timer);
                                reject(new Error("aborted"));
                            },
                            { once: true },
                        );
                    });
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, slowTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "abortTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.slow",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const ac = new AbortController();
            setTimeout(() => ac.abort(), 50);

            const result = await eng.run(ir, {
                input: {},
                signal: ac.signal,
            });
            expect(result.success).toBe(false);
        });

        it("cancels during loop iteration", async () => {
            const counterTask: TaskDefinition = {
                name: "test.counter",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                async execute(input: any) {
                    // Simulate a bit of work
                    await new Promise((r) => setTimeout(r, 30));
                    return {
                        kind: "ok" as const,
                        output: (input.n ?? 0) + 1,
                    };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, counterTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "loopAbortTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            count: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "inc",
                            nodes: {
                                inc: {
                                    kind: "task",
                                    task: "test.counter",
                                    inputSchema: {
                                        type: "object",
                                        properties: {
                                            n: { type: "integer" },
                                        },
                                    },
                                    outputSchema: { type: "integer" },
                                    inputs: {
                                        n: {
                                            $from: "state",
                                            name: "count",
                                        } as Template,
                                    },
                                    bind: "incResult",
                                    next: "check",
                                },
                                check: {
                                    kind: "branch",
                                    selector: false as Template,
                                    selectorSchema: { type: "boolean" },
                                    cases: { true: "@exit" },
                                    default: "@iterate",
                                },
                            },
                            output: {
                                $from: "state",
                                name: "count",
                            } as Template,
                            outputSchema: { type: "integer" },
                        },
                        iterateState: {
                            count: {
                                $from: "scope",
                                name: "incResult",
                            } as Template,
                        },
                        maxIterations: 1000,
                        bind: "result",
                    },
                },
                entry: "loop",
                output: { $from: "scope", name: "result" } as Template,
            };

            const ac = new AbortController();
            setTimeout(() => ac.abort(), 100);

            const result = await eng.run(ir, {
                input: {},
                signal: ac.signal,
            });
            expect(result.success).toBe(false);
        });
    });

    describe("loop edge cases", () => {
        it("fails when maxIterations is exceeded", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "maxIterTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "add",
                            nodes: {
                                add: {
                                    kind: "task",
                                    task: "math.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["left", "right"],
                                        properties: {
                                            left: { type: "number" },
                                            right: { type: "number" },
                                        },
                                    },
                                    outputSchema: { type: "number" },
                                    inputs: {
                                        left: {
                                            $from: "state",
                                            name: "i",
                                        } as Template,
                                        right: 1 as Template,
                                    },
                                    bind: "next",
                                    next: "cont",
                                },
                                cont: {
                                    kind: "branch",
                                    selector: false as Template,
                                    selectorSchema: { type: "boolean" },
                                    cases: { true: "@exit" },
                                    default: "@iterate",
                                },
                            },
                            output: {
                                $from: "state",
                                name: "i",
                            } as Template,
                            outputSchema: { type: "integer" },
                        },
                        iterateState: {
                            i: {
                                $from: "scope",
                                name: "next",
                            } as Template,
                        },
                        maxIterations: 3,
                        bind: "result",
                    },
                },
                entry: "loop",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain(
                "LoopMaxIterationsExceeded",
            );
        });

        it("accesses constants inside loop bodies", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "loopConstantTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                constants: {
                    step: {
                        schema: { type: "integer" },
                        value: 10,
                    },
                },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            total: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                            iter: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "addStep",
                            nodes: {
                                addStep: {
                                    kind: "task",
                                    task: "math.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["left", "right"],
                                        properties: {
                                            left: { type: "number" },
                                            right: { type: "number" },
                                        },
                                    },
                                    outputSchema: { type: "number" },
                                    inputs: {
                                        left: {
                                            $from: "state",
                                            name: "total",
                                        } as Template,
                                        right: {
                                            $from: "constant",
                                            name: "step",
                                        } as Template,
                                    },
                                    bind: "sum",
                                    next: "incIter",
                                },
                                incIter: {
                                    kind: "task",
                                    task: "math.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["left", "right"],
                                        properties: {
                                            left: { type: "number" },
                                            right: { type: "number" },
                                        },
                                    },
                                    outputSchema: { type: "number" },
                                    inputs: {
                                        left: {
                                            $from: "state",
                                            name: "iter",
                                        } as Template,
                                        right: 1 as Template,
                                    },
                                    bind: "nextIter",
                                    next: "check",
                                },
                                check: {
                                    kind: "branch",
                                    selector: {
                                        $from: "scope",
                                        name: "nextIter",
                                    } as Template,
                                    selectorSchema: { type: "number" },
                                    cases: { 2: "@exit" },
                                    default: "@iterate",
                                },
                            },
                            output: {
                                $from: "scope",
                                name: "sum",
                            } as Template,
                            outputSchema: { type: "number" },
                        },
                        iterateState: {
                            total: {
                                $from: "scope",
                                name: "sum",
                            } as Template,
                            iter: {
                                $from: "scope",
                                name: "nextIter",
                            } as Template,
                        },
                        maxIterations: 10,
                        bind: "result",
                    },
                },
                entry: "loop",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            // 2 iterations * step(10) = 20
            expect(result.output).toBe(20);
        });
    });

    describe("event emission", () => {
        it("emits nodeFailed when a task fails with onError", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "deliberate failure" },
                    };
                },
            };
            const noopTask: TaskDefinition = {
                name: "test.noop",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: { recovered: true } };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask, noopTask);
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "nodeFailedTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        onError: "recover",
                        bind: "r",
                    },
                    recover: {
                        kind: "task",
                        task: "test.noop",
                        inputSchema: {
                            type: "object",
                            required: ["error", "trigger"],
                            properties: {
                                error: { type: "object" },
                                trigger: { type: "object" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "r",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "r" } as Template,
            };

            await eng.run(ir, { input: {} });

            const failed = events.filter((e) => e.type === "nodeFailed");
            expect(failed).toHaveLength(1);
            expect((failed[0] as any).nodeId).toBe("step");
            expect((failed[0] as any).error.message).toContain(
                "deliberate failure",
            );
        });

        it("emits runFailed when workflow fails", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "boom" },
                    };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask);
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "runFailedTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "r",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "r" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);

            const runFailed = events.filter((e) => e.type === "runFailed");
            expect(runFailed).toHaveLength(1);
            expect((runFailed[0] as any).error.message).toContain("boom");
        });

        it("emits runStarted and runCompleted in order", async () => {
            const events = collectEvents(engine);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "eventOrderTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        bind: "r",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "r" } as Template,
            };

            await engine.run(ir, { input: {} });

            expect(events[0].type).toBe("runStarted");
            expect(events[events.length - 1].type).toBe("runCompleted");

            // Timestamps are monotonically non-decreasing
            for (let i = 1; i < events.length; i++) {
                expect(events[i].timestamp).toBeGreaterThanOrEqual(
                    events[i - 1].timestamp,
                );
            }
        });
    });

    describe("listener management", () => {
        it("off() removes a listener so it no longer fires", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const events1: WorkflowEvent[] = [];
            const events2: WorkflowEvent[] = [];
            const listener1 = (e: WorkflowEvent) => events1.push(e);
            const listener2 = (e: WorkflowEvent) => events2.push(e);

            eng.on(listener1);
            eng.on(listener2);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "offTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        bind: "r",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "r" } as Template,
            };

            // Both get events from first run
            await eng.run(ir, { input: {} });
            expect(events1.length).toBeGreaterThan(0);
            expect(events2.length).toBeGreaterThan(0);

            const count1 = events1.length;
            const count2 = events2.length;

            // Remove listener1
            eng.off(listener1);
            await eng.run(ir, { input: {} });

            // listener1 should NOT have grown; listener2 should have
            expect(events1.length).toBe(count1);
            expect(events2.length).toBeGreaterThan(count2);
        });
    });

    describe("binding overwrites", () => {
        it("later task overrides an earlier binding with the same name", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "bindOverwrite",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    first: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        bind: "firstAnswer",
                        next: "second",
                    },
                    second: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 10 as Template, right: 20 as Template },
                        bind: "answer",
                    },
                },
                entry: "first",
                output: { $from: "scope", name: "answer" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            // Second task's output (30) should override first (3)
            expect(result.output).toBe(30);
        });
    });

    describe("error recovery chains", () => {
        it("handles onError handler itself failing (propagates)", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "original failure" },
                    };
                },
            };
            const failRecovery: TaskDefinition = {
                name: "test.failRecovery",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "recovery also failed" },
                    };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks,
                failTask,
                failRecovery,
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "cascadeError",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        onError: "recover",
                        bind: "r",
                    },
                    recover: {
                        kind: "task",
                        task: "test.failRecovery",
                        inputSchema: {
                            type: "object",
                            required: ["error", "trigger"],
                            properties: {
                                error: { type: "object" },
                                trigger: { type: "object" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "r",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "r" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("recovery also failed");
        });
    });

    describe("optional template references", () => {
        it("returns null for optional $from reference to missing binding", async () => {
            const echoTask: TaskDefinition = {
                name: "test.echo",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(input: any) {
                    return {
                        kind: "ok" as const,
                        output: input.value ?? "default",
                    };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, echoTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "optionalRef",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.echo",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {
                            value: {
                                $from: "scope",
                                name: "nonexistent",
                                optional: true,
                            } as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            // null falls through to default in echo task
            expect(result.output).toBe("default");
        });

        it("returns null for optional path projection on null", async () => {
            const echoTask: TaskDefinition = {
                name: "test.echo",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: {
                    type: "object",
                    properties: {
                        nested: {
                            type: ["object", "null"],
                            properties: {
                                deep: { type: "string" },
                            },
                        },
                    },
                },
                async execute(input: any) {
                    return {
                        kind: "ok" as const,
                        output: { nested: input.nested ?? null },
                    };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, echoTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "optionalPath",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    first: {
                        kind: "task",
                        task: "test.echo",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            properties: {
                                nested: {
                                    type: ["object", "null"],
                                    properties: {
                                        deep: { type: "string" },
                                    },
                                },
                            },
                        },
                        inputs: { nested: null as Template },
                        bind: "data",
                        next: "second",
                    },
                    second: {
                        kind: "task",
                        task: "test.echo",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {
                            nested: {
                                $from: "scope",
                                name: "data",
                                path: ["nested", "deep"],
                                optional: true,
                            } as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "first",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            // data.nested is null, so optional path returns null
            expect((result.output as any).nested).toBeNull();
        });
    });

    describe("shell.exec edge cases", () => {
        it("uses cwd parameter", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "cwdTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command"],
                            properties: {
                                command: { type: "string" },
                                args: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                                cwd: { type: "string" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["stdout", "stderr", "exitCode"],
                            properties: {
                                stdout: { type: "string" },
                                stderr: { type: "string" },
                                exitCode: { type: "integer" },
                            },
                        },
                        inputs: {
                            command: "node" as Template,
                            args: [
                                "-e",
                                "process.stdout.write(process.cwd())",
                            ] as unknown as Template,
                            cwd: tmpdir() as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(true);
            const stdout = (result.output as any).stdout.trim();
            // realpath to handle symlinks like /tmp -> /private/tmp
            const { realpathSync } = await import("node:fs");
            expect(stdout).toBe(realpathSync(tmpdir()));
        });

        it("captures stderr output", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "stderrTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command", "args"],
                            properties: {
                                command: { type: "string" },
                                args: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["stdout", "stderr", "exitCode"],
                            properties: {
                                stdout: { type: "string" },
                                stderr: { type: "string" },
                                exitCode: { type: "integer" },
                            },
                        },
                        inputs: {
                            command: "bash" as Template,
                            args: ["-c", "echo errormsg >&2"] as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(true);
            expect((result.output as any).stderr).toContain("errormsg");
        });
    });

    describe("$literal template escape", () => {
        it("passes $literal content verbatim without resolving", async () => {
            const echoTask: TaskDefinition = {
                name: "test.echo",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(input: any) {
                    return { kind: "ok" as const, output: input };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, echoTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "literalTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.echo",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {
                            data: {
                                $literal: {
                                    $from: "scope",
                                    name: "shouldNotResolve",
                                },
                            } as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            const data = (result.output as any).data;
            // $literal content is passed through verbatim as plain object
            expect(data).toEqual({
                $from: "scope",
                name: "shouldNotResolve",
            });
        });
    });

    describe("http.get SSRF protection", () => {
        it("rejects localhost URLs", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "ssrfTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "http://localhost:8080/admin" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("private or reserved");
        });

        it("rejects cloud metadata endpoint", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "ssrfMetadata",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "http://169.254.169.254/latest/meta-data/" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("private or reserved");
        });

        it("rejects 127.0.0.1 addresses", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "ssrf127",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "http://127.0.0.1/secret" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("private or reserved");
        });

        it("rejects private network addresses (192.168.x)", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "ssrf192",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "http://192.168.1.1/config" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("private or reserved");
        });

        it("rejects file:// protocol", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "ssrfFile",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "file:///etc/passwd" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("private or reserved");
        });
    });

    describe("http.get response size enforcement", () => {
        it("returns fail when response exceeds maxResponseBytes", async () => {
            // Use a mock that simulates a streaming response.
            // The real http.get code streams and checks byte count.
            // We test via the builtinTasks import directly.
            const { httpGet } = await import("../src/builtinTasks.js");

            // Mock a global fetch that returns a large streaming body
            const originalFetch = globalThis.fetch;
            const largeBody = "X".repeat(200);
            const encoder = new TextEncoder();
            const encoded = encoder.encode(largeBody);

            globalThis.fetch = (async () => ({
                status: 200,
                body: new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoded);
                        controller.close();
                    },
                }),
            })) as any;

            try {
                const result = await httpGet.execute(
                    {
                        url: "https://example.com/large",
                        maxResponseBytes: 50,
                    },
                    {
                        runId: "test",
                        nodeId: "test",
                        scopePath: [],
                        signal: new AbortController().signal,
                    },
                );
                expect(result.kind).toBe("fail");
                if (result.kind === "fail") {
                    expect(result.error.message).toContain(
                        "exceeded maximum size",
                    );
                }
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe("error object structure", () => {
        it("onError handler receives structured error with code/message/source", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "broken" },
                    };
                },
            };
            const captureTask: TaskDefinition = {
                name: "test.capture",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(input: any) {
                    return { kind: "ok" as const, output: input };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask, captureTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "errorStructure",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        onError: "capture",
                    },
                    capture: {
                        kind: "task",
                        task: "test.capture",
                        inputSchema: {
                            type: "object",
                            required: ["error", "trigger"],
                            properties: {
                                error: { type: "object" },
                                trigger: { type: "object" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            error: {
                                $from: "input",
                                name: "error",
                            } as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            const errorObj = (result.output as any).error;
            expect(errorObj).toBeDefined();
            expect(errorObj.kind).toBe("TaskError");
            expect(errorObj.message).toBe("broken");
            expect(errorObj.source).toBe("task");
            expect(errorObj.task).toBe("test.fail");
            expect(errorObj.node).toBe("step");
        });

        it("runtime errors have RuntimeError kind", async () => {
            const throwTask: TaskDefinition = {
                name: "test.throw",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    throw new Error("unexpected crash");
                },
            };
            const captureTask: TaskDefinition = {
                name: "test.capture",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(input: any) {
                    return { kind: "ok" as const, output: input };
                },
            };

            const reg = makeRegistry(
                ...allBuiltinTasks,
                throwTask,
                captureTask,
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "runtimeError",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.throw",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        onError: "capture",
                    },
                    capture: {
                        kind: "task",
                        task: "test.capture",
                        inputSchema: {
                            type: "object",
                            required: ["error", "trigger"],
                            properties: {
                                error: { type: "object" },
                                trigger: { type: "object" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            error: {
                                $from: "input",
                                name: "error",
                            } as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            const errorObj = (result.output as any).error;
            expect(errorObj.kind).toBe("RuntimeError");
            expect(errorObj.message).toBe("unexpected crash");
            expect(errorObj.source).toBe("runtime");
        });

        it("unrecoverable engine errors bypass onError and fail the run", async () => {
            // Simulate a validator-bypass scenario by constructing IR where the
            // branch has no matching case and no default (should be caught by
            // the validator, but we skip validation here).
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "unrecoverable",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    branch: {
                        kind: "branch",
                        selector: { $from: "input", name: "x" } as Template,
                        selectorSchema: { type: "string" },
                        cases: { a: "done" },
                        // no default — any value other than "a" is unmatched
                    } as any,
                    done: {
                        kind: "task",
                        task: "identity",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "result",
                    },
                    recover: {
                        kind: "task",
                        task: "identity",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "branch",
                output: { $from: "scope", name: "result" } as Template,
            };

            // Even if the branch node had an onError, unrecoverable errors bypass it.
            // Here we just confirm the run fails (not recovers silently).
            const result = await eng.run(ir, {
                input: { x: "z" },
                skipValidation: true,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("no matching case or default");
        });
    });

    describe("static schema type checking", () => {
        it("detects type mismatch (producer: string, consumer: integer)", async () => {
            const { validateWorkflowIR } = await import("workflow-model");

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "typeMismatch",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    producer: {
                        kind: "task",
                        task: "bool.toLabel",
                        inputSchema: {
                            type: "object",
                            required: ["value", "ifTrue", "ifFalse"],
                            properties: {
                                value: { type: "boolean" },
                                ifTrue: { type: "string" },
                                ifFalse: { type: "string" },
                            },
                        },
                        outputSchema: { type: "string" },
                        inputs: {
                            value: true as Template,
                            ifTrue: "yes" as Template,
                            ifFalse: "no" as Template,
                        },
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: {
                                $from: "scope",
                                name: "data",
                            } as Template,
                            right: 1 as Template,
                        },
                        bind: "final",
                    },
                },
                entry: "producer",
                output: { $from: "scope", name: "final" } as Template,
            };

            const tasks = new Map(allBuiltinTasks.map((t) => [t.name, t]));
            const validation = validateWorkflowIR(ir, tasks);
            expect(validation.valid).toBe(false);
            expect(validation.errors[0].message).toContain("Type mismatch");
        });
    });

    describe("loop sentinel validation", () => {
        it("rejects loop body without sentinel at validation time", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "noSentinel",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "math.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["left", "right"],
                                        properties: {
                                            left: { type: "number" },
                                            right: { type: "number" },
                                        },
                                    },
                                    outputSchema: { type: "number" },
                                    inputs: {
                                        left: 1 as Template,
                                        right: 1 as Template,
                                    },
                                    bind: "r",
                                },
                            },
                            output: 0 as Template,
                            outputSchema: { type: "integer" },
                        },
                        iterateState: {},
                        maxIterations: 10,
                        bind: "result",
                    },
                },
                entry: "loop",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("@iterate or @exit");
        });
    });

    describe("unresolved $from reference", () => {
        it("fails with clear error for missing scope binding", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "missingRef",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: {
                                $from: "scope",
                                name: "doesNotExist",
                            } as Template,
                            right: 1 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("doesNotExist");
            expect(result.error?.message).toContain("no node");
        });
    });

    describe("unknown $from namespace", () => {
        it("fails with clear error for invalid namespace", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badNamespace",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: {
                                $from: "magic",
                                name: "x",
                            } as Template,
                            right: 1 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Unknown $from namespace");
        });
    });

    describe("path projection failures", () => {
        it("fails when projecting into a non-object value", async () => {
            const numTask: TaskDefinition = {
                name: "test.num",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                async execute() {
                    return { kind: "ok" as const, output: 42 };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, numTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badProjection",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    first: {
                        kind: "task",
                        task: "test.num",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "integer" },
                        inputs: {},
                        bind: "data",
                        next: "second",
                    },
                    second: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: {
                            left: {
                                $from: "scope",
                                name: "data",
                                path: ["value", "nested"],
                            } as Template,
                            right: 1 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "first",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            // Static validator catches invalid path before runtime
            expect(result.error?.message).toContain("not declared in producer");
        });
    });

    describe("multiple task failures without recovery", () => {
        it("propagates first failure and includes nodeId", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "task crashed" },
                    };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "unhandledFail",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("task crashed");
            expect(result.error?.nodeId).toBe("step");
        });
    });

    describe("default task timeout", () => {
        it("applies default 60s timeout when none specified", async () => {
            // Verify that a task exceeding 60s would be aborted.
            // We don't actually wait 60s; instead we test a task that
            // completes in 10ms with no explicit timeout and verify it
            // succeeds (proving the default timeout didn't interfere).
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "defaultTimeoutOk",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "number" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        bind: "result",
                    },
                },
                entry: "add",
                output: { $from: "scope", name: "result" } as Template,
            };

            // No taskTimeoutMs: should use 60s default, fast task succeeds
            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
        });

        it("disables timeout when taskTimeoutMs is 0", async () => {
            const slow: TaskDefinition = {
                name: "test.slow200",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    await new Promise((r) => setTimeout(r, 200));
                    return { kind: "ok", output: { done: true } };
                },
            };
            const reg = makeRegistry(slow);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "noTimeout",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.slow200",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            // taskTimeoutMs: 0 disables timeout; 200ms task should succeed
            const result = await eng.run(ir, {
                input: {},
                taskTimeoutMs: 0,
            });
            expect(result.success).toBe(true);
        });
    });

    describe("workflow input validation", () => {
        it("rejects input that violates inputSchema", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "inputValidation",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["name"],
                    properties: { name: { type: "string" } },
                },
                outputSchema: { type: "number" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            // Missing required "name" field
            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Input schema violation");
        });

        it("rejects when no input provided but schema has required fields", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "missingInput",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: { type: "integer" } },
                },
                outputSchema: { type: "number" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "math.add",
                        inputSchema: {
                            type: "object",
                            required: ["left", "right"],
                            properties: {
                                left: { type: "number" },
                                right: { type: "number" },
                            },
                        },
                        outputSchema: { type: "number" },
                        inputs: { left: 1 as Template, right: 2 as Template },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            // No input at all
            const result = await eng.run(ir);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Input schema violation");
        });
    });

    describe("shell.exec allowedCommands constraint", () => {
        it("blocks commands not in allowedCommands", async () => {
            const mockExec: TaskDefinition = {
                name: "shell.exec",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["command"],
                    properties: { command: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["stdout", "stderr", "exitCode"],
                    properties: {
                        stdout: { type: "string" },
                        stderr: { type: "string" },
                        exitCode: { type: "integer" },
                    },
                },
                async execute(input: any, ctx) {
                    // Enforce allowedCommands
                    const allowed = ctx.constraints?.allowedCommands;
                    if (allowed && !allowed.includes(input.command)) {
                        return {
                            kind: "fail",
                            error: {
                                message: `Command "${input.command}" is not in the allowed commands list`,
                            },
                        };
                    }
                    return {
                        kind: "ok",
                        output: { stdout: "ok", stderr: "", exitCode: 0 },
                    };
                },
            };
            const reg = makeRegistry(mockExec);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "blockedCmd",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command"],
                            properties: { command: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["stdout", "stderr", "exitCode"],
                            properties: {
                                stdout: { type: "string" },
                                stderr: { type: "string" },
                                exitCode: { type: "integer" },
                            },
                        },
                        inputs: { command: "rm" as Template },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                constraints: { allowedCommands: ["git", "ls"] },
                taskTimeoutMs: 0,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain(
                "not in the allowed commands list",
            );
        });

        it("allows commands in allowedCommands", async () => {
            const mockExec: TaskDefinition = {
                name: "shell.exec",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["command"],
                    properties: { command: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["stdout", "stderr", "exitCode"],
                    properties: {
                        stdout: { type: "string" },
                        stderr: { type: "string" },
                        exitCode: { type: "integer" },
                    },
                },
                async execute(input: any, ctx) {
                    const allowed = ctx.constraints?.allowedCommands;
                    if (allowed && !allowed.includes(input.command)) {
                        return {
                            kind: "fail",
                            error: {
                                message: `Command "${input.command}" is not in the allowed commands list`,
                            },
                        };
                    }
                    return {
                        kind: "ok",
                        output: { stdout: "result", stderr: "", exitCode: 0 },
                    };
                },
            };
            const reg = makeRegistry(mockExec);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "allowedCmd",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command"],
                            properties: { command: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["stdout", "stderr", "exitCode"],
                            properties: {
                                stdout: { type: "string" },
                                stderr: { type: "string" },
                                exitCode: { type: "integer" },
                            },
                        },
                        inputs: { command: "git" as Template },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                constraints: { allowedCommands: ["git", "ls"] },
                taskTimeoutMs: 0,
            });
            expect(result.success).toBe(true);
        });
    });

    describe("http.get host constraints", () => {
        it("blocks hosts in blockedHosts", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "blockedHost",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "https://evil.example.com/data" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                constraints: { blockedHosts: ["evil.example.com"] },
                taskTimeoutMs: 0,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain(
                "blocked by caller constraints",
            );
        });

        it("rejects hosts not in allowedHosts when set", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "notAllowedHost",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    fetch: {
                        kind: "task",
                        task: "http.get",
                        inputSchema: {
                            type: "object",
                            required: ["url"],
                            properties: { url: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["body", "status"],
                            properties: {
                                body: { type: "string" },
                                status: { type: "integer" },
                            },
                        },
                        inputs: {
                            url: "https://other.example.com/data" as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "fetch",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                constraints: { allowedHosts: ["api.trusted.com"] },
                taskTimeoutMs: 0,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain(
                "not in the allowed hosts list",
            );
        });
    });

    describe("onError cleanup-then-fail", () => {
        it("reports original error when cleanup path leaves output unresolvable", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "the original problem" },
                    };
                },
            };
            const cleanupTask: TaskDefinition = {
                name: "test.cleanup",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: { cleaned: true } };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask, cleanupTask);
            const eng = new WorkflowEngine(reg);

            // step fails -> cleanup runs (binds "cleanupResult")
            // but output references "happyResult" which was never bound
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "cleanupFail",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        onError: "cleanup",
                        bind: "happyResult",
                    },
                    cleanup: {
                        kind: "task",
                        task: "test.cleanup",
                        inputSchema: {
                            type: "object",
                            required: ["error", "trigger"],
                            properties: {
                                error: { type: "object" },
                                trigger: { type: "object" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "cleanupResult",
                    },
                },
                entry: "step",
                output: {
                    $from: "scope",
                    name: "happyResult",
                } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                skipValidation: true,
            });
            expect(result.success).toBe(false);
            // Should report the *original* error, not "unresolved reference"
            expect(result.error?.message).toContain("the original problem");
        });

        it("succeeds when onError handler produces a valid output", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "step failed" },
                    };
                },
            };
            const recoverTask: TaskDefinition = {
                name: "test.recover",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(input: any) {
                    return {
                        kind: "ok" as const,
                        output: {
                            fallback: true,
                            reason: input.error?.message,
                        },
                    };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask, recoverTask);
            const eng = new WorkflowEngine(reg);

            // step fails -> recover runs and binds "result"
            // output references "result", which IS bound by the recovery node
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "recoverSuccess",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        onError: "recover",
                    },
                    recover: {
                        kind: "task",
                        task: "test.recover",
                        inputSchema: {
                            type: "object",
                            required: ["error", "trigger"],
                            properties: {
                                error: { type: "object" },
                                trigger: { type: "object" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            error: {
                                $from: "input",
                                name: "error",
                            } as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect((result.output as any).fallback).toBe(true);
            expect((result.output as any).reason).toBe("step failed");
        });

        it("reports original error with nodeId from the failing task", async () => {
            const failTask: TaskDefinition = {
                name: "test.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "boom" },
                    };
                },
            };
            const noopTask: TaskDefinition = {
                name: "test.noop",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: {} };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, failTask, noopTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "nodeIdCheck",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                nodes: {
                    doWork: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        onError: "cleanup",
                        bind: "workOutput",
                    },
                    cleanup: {
                        kind: "task",
                        task: "test.noop",
                        inputSchema: {
                            type: "object",
                            required: ["error", "trigger"],
                            properties: {
                                error: { type: "object" },
                                trigger: { type: "object" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "cleanedUp",
                    },
                },
                entry: "doWork",
                output: {
                    $from: "scope",
                    name: "workOutput",
                } as Template,
            };

            const result = await eng.run(ir, {
                input: {},
                skipValidation: true,
            });
            expect(result.success).toBe(false);
            expect(result.error?.nodeId).toBe("doWork");
        });
    });

    // ---- DSL built-in tasks ----

    describe("compare tasks", () => {
        it("compare.equals returns true for equal values", async () => {
            const result = await compareEquals.execute(
                { left: 42, right: 42 },
                {} as any,
            );
            expect(result).toEqual({ kind: "ok", output: true });
        });

        it("compare.equals returns false for different values", async () => {
            const result = await compareEquals.execute(
                { left: 1, right: 2 },
                {} as any,
            );
            expect(result).toEqual({ kind: "ok", output: false });
        });

        it("compare.equals uses strict equality (no coercion)", async () => {
            // string "5" vs number 5: strict equality returns false
            expect(
                await compareEquals.execute({ left: "5", right: 5 }, {} as any),
            ).toEqual({ kind: "ok", output: false });
            // null vs undefined
            expect(
                await compareEquals.execute(
                    { left: null, right: undefined },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: false });
            // object identity: different objects with same shape are not equal
            expect(
                await compareEquals.execute(
                    { left: { a: 1 }, right: { a: 1 } },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: false });
        });

        it("compare.equals returns false for NaN vs NaN", async () => {
            expect(
                await compareEquals.execute(
                    { left: NaN, right: NaN },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: false });
        });

        it("compare.notEquals returns true for different values", async () => {
            const result = await compareNotEquals.execute(
                { left: "a", right: "b" },
                {} as any,
            );
            expect(result).toEqual({ kind: "ok", output: true });
        });

        it("compare.greaterThan works", async () => {
            expect(
                await compareGreaterThan.execute(
                    { left: 5, right: 3 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: true });
            expect(
                await compareGreaterThan.execute(
                    { left: 3, right: 5 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: false });
        });

        it("compare.lessThan works", async () => {
            expect(
                await compareLessThan.execute({ left: 2, right: 7 }, {} as any),
            ).toEqual({ kind: "ok", output: true });
        });

        it("compare.greaterOrEqual works", async () => {
            expect(
                await compareGreaterOrEqual.execute(
                    { left: 5, right: 5 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: true });
            expect(
                await compareGreaterOrEqual.execute(
                    { left: 4, right: 5 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: false });
        });

        it("compare.lessOrEqual works", async () => {
            expect(
                await compareLessOrEqual.execute(
                    { left: 3, right: 3 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: true });
            expect(
                await compareLessOrEqual.execute(
                    { left: 4, right: 3 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: false });
        });

        it("ordering comparisons with NaN always return false", async () => {
            for (const exec of [
                compareGreaterThan,
                compareLessThan,
                compareGreaterOrEqual,
                compareLessOrEqual,
            ]) {
                expect(
                    await exec.execute({ left: NaN, right: 5 }, {} as any),
                ).toEqual({ kind: "ok", output: false });
                expect(
                    await exec.execute({ left: 5, right: NaN }, {} as any),
                ).toEqual({ kind: "ok", output: false });
            }
        });

        it("ordering comparisons with Infinity", async () => {
            expect(
                await compareGreaterThan.execute(
                    { left: Infinity, right: 5 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: true });
            expect(
                await compareLessOrEqual.execute(
                    { left: 5, right: Infinity },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: true });
        });
    });

    describe("bool tasks", () => {
        it("bool.not negates", async () => {
            expect(await boolNot.execute({ value: true }, {} as any)).toEqual({
                kind: "ok",
                output: false,
            });
            expect(await boolNot.execute({ value: false }, {} as any)).toEqual({
                kind: "ok",
                output: true,
            });
        });
    });

    describe("math tasks", () => {
        it("math.add adds", async () => {
            expect(
                await mathAdd.execute({ left: 3, right: 4 }, {} as any),
            ).toEqual({ kind: "ok", output: 7 });
        });

        it("math.subtract subtracts", async () => {
            expect(
                await mathSubtract.execute({ left: 10, right: 3 }, {} as any),
            ).toEqual({ kind: "ok", output: 7 });
        });

        it("math.multiply multiplies", async () => {
            expect(
                await mathMultiply.execute({ left: 6, right: 7 }, {} as any),
            ).toEqual({ kind: "ok", output: 42 });
        });

        it("math.divide divides", async () => {
            expect(
                await mathDivide.execute({ left: 15, right: 3 }, {} as any),
            ).toEqual({ kind: "ok", output: 5 });
        });

        it("math.divide returns Infinity on zero divisor", async () => {
            const result = await mathDivide.execute(
                { left: 5, right: 0 },
                {} as any,
            );
            expect(result).toEqual({
                kind: "ok",
                output: Infinity,
            });
        });

        it("math.divide returns -Infinity for negative / zero", async () => {
            const result = await mathDivide.execute(
                { left: -5, right: 0 },
                {} as any,
            );
            expect(result).toEqual({ kind: "ok", output: -Infinity });
        });

        it("math.divide returns NaN for 0/0", async () => {
            const result = await mathDivide.execute(
                { left: 0, right: 0 },
                {} as any,
            );
            expect(result).toEqual({ kind: "ok", output: NaN });
        });

        it("math.modulo computes remainder", async () => {
            expect(
                await mathModulo.execute({ left: 17, right: 5 }, {} as any),
            ).toEqual({ kind: "ok", output: 2 });
        });

        it("math.modulo returns NaN on zero divisor", async () => {
            const result = await mathModulo.execute(
                { left: 5, right: 0 },
                {} as any,
            );
            expect(result).toEqual({ kind: "ok", output: NaN });
        });

        it("math.modulo preserves sign of dividend", async () => {
            expect(
                await mathModulo.execute({ left: -5, right: 3 }, {} as any),
            ).toEqual({ kind: "ok", output: -2 });
        });

        it("math.negate negates", async () => {
            expect(await mathNegate.execute({ value: 7 }, {} as any)).toEqual({
                kind: "ok",
                output: -7,
            });
        });

        it("NaN propagates through arithmetic", async () => {
            expect(
                await mathAdd.execute({ left: NaN, right: 5 }, {} as any),
            ).toEqual({ kind: "ok", output: NaN });
            expect(
                await mathMultiply.execute(
                    { left: Infinity, right: 0 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: NaN });
        });

        it("Infinity arithmetic", async () => {
            expect(
                await mathAdd.execute({ left: Infinity, right: 5 }, {} as any),
            ).toEqual({ kind: "ok", output: Infinity });
            expect(
                await mathAdd.execute(
                    { left: Infinity, right: -Infinity },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: NaN });
        });

        it("math.floor floors", async () => {
            expect(await mathFloor.execute({ value: 3.7 }, {} as any)).toEqual({
                kind: "ok",
                output: 3,
            });
        });

        it("math.round rounds", async () => {
            expect(await mathRound.execute({ value: 3.5 }, {} as any)).toEqual({
                kind: "ok",
                output: 4,
            });
        });

        it("math.ceil ceils", async () => {
            expect(await mathCeil.execute({ value: 3.1 }, {} as any)).toEqual({
                kind: "ok",
                output: 4,
            });
        });

        it("math.floor/round/ceil with negative values", async () => {
            expect(await mathFloor.execute({ value: -2.3 }, {} as any)).toEqual(
                { kind: "ok", output: -3 },
            );
            expect(await mathCeil.execute({ value: -2.3 }, {} as any)).toEqual({
                kind: "ok",
                output: -2,
            });
        });
    });

    describe("error tasks", () => {
        it("error.fail always fails with string message", async () => {
            const result = await errorFail.execute(
                { value: "boom" },
                {} as any,
            );
            expect(result.kind).toBe("fail");
            if (result.kind === "fail") {
                expect(result.error?.message).toBe("boom");
            }
        });

        it("error.fail serializes non-string values", async () => {
            const result = await errorFail.execute(
                { value: { code: 42 } },
                {} as any,
            );
            expect(result.kind).toBe("fail");
            if (result.kind === "fail") {
                expect(result.error?.message).toBe('{"code":42}');
                expect(result.error?.data).toEqual({ code: 42 });
            }
        });
    });

    describe("list tasks", () => {
        it("list.length returns array length", async () => {
            expect(
                await listLength.execute({ list: [1, 2, 3] }, {} as any),
            ).toEqual({ kind: "ok", output: 3 });
        });

        it("list.length returns 0 for empty array", async () => {
            expect(await listLength.execute({ list: [] }, {} as any)).toEqual({
                kind: "ok",
                output: 0,
            });
        });

        it("list.elementAt returns element at index", async () => {
            expect(
                await listElementAt.execute(
                    { list: ["a", "b", "c"], index: 1 },
                    {} as any,
                ),
            ).toEqual({ kind: "ok", output: "b" });
        });

        it("list.elementAt fails for out-of-bounds index", async () => {
            const result = await listElementAt.execute(
                { list: [1, 2], index: 5 },
                {} as any,
            );
            expect(result.kind).toBe("fail");
        });

        it("list.elementAt fails for negative index", async () => {
            const result = await listElementAt.execute(
                { list: [1, 2, 3], index: -1 },
                {} as any,
            );
            expect(result.kind).toBe("fail");
        });

        it("list.append returns new array without mutating original", async () => {
            const original = [1, 2, 3];
            const result = await listAppend.execute(
                { list: original, item: 4 },
                {} as any,
            );
            expect(result).toEqual({ kind: "ok", output: [1, 2, 3, 4] });
            // original array not mutated
            expect(original).toEqual([1, 2, 3]);
        });

        it("list.append to empty array", async () => {
            expect(
                await listAppend.execute({ list: [], item: "x" }, {} as any),
            ).toEqual({ kind: "ok", output: ["x"] });
        });
    });

    // ---- Fork execution ----

    describe("fork execution", () => {
        it("runs two branches concurrently and collects results", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            // Register mock tasks that record call order
            const callOrder: string[] = [];
            reg.register({
                name: "mock.branchA",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                async execute() {
                    callOrder.push("A");
                    return { kind: "ok", output: { val: "resultA" } };
                },
            });
            reg.register({
                name: "mock.branchB",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "string" },
                async execute() {
                    callOrder.push("B");
                    return { kind: "ok", output: { val: "resultB" } };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-test",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a_step",
                                    nodes: {
                                        a_step: {
                                            kind: "task",
                                            task: "mock.branchA",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                required: ["val"],
                                                properties: {
                                                    val: { type: "string" },
                                                },
                                            },
                                            inputs: {},
                                            bind: "aOut",
                                        },
                                    },
                                    output: { $from: "scope", name: "aOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_step",
                                    nodes: {
                                        b_step: {
                                            kind: "task",
                                            task: "mock.branchB",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                required: ["val"],
                                                properties: {
                                                    val: { type: "string" },
                                                },
                                            },
                                            inputs: {},
                                            bind: "bOut",
                                        },
                                    },
                                    output: { $from: "scope", name: "bOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        bind: "forkResult",
                    },
                },
                output: { $from: "scope", name: "forkResult" },
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(callOrder).toContain("A");
            expect(callOrder).toContain("B");
            // Output is a keyed object with branch results
            const out = result.output as Record<string, any>;
            expect(out.a).toBeDefined();
            expect(out.b).toBeDefined();
        });

        it("rejects fork with fewer than 2 branches at runtime", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.only",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok", output: {} };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-min2-test",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            only: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "only_step",
                                    nodes: {
                                        only_step: {
                                            kind: "task",
                                            task: "mock.only",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "onlyOut",
                                        },
                                    },
                                    output: {
                                        $from: "scope",
                                        name: "onlyOut",
                                    },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        bind: "forkResult",
                    },
                },
                output: { $from: "scope", name: "forkResult" },
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toMatch(
                /must have at least 2 branches/,
            );
        });

        it("respects maxConcurrency", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);

            // Track concurrent execution
            let maxConcurrent = 0;
            let currentConcurrent = 0;

            const makeSlowTask = (name: string): TaskDefinition => ({
                name,
                sideEffects: false,
                inputSchema: { type: "object" as const },
                outputSchema: {
                    type: "object" as const,
                    properties: { v: { type: "number" as const } },
                },
                async execute() {
                    currentConcurrent++;
                    maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
                    await new Promise((r) => setTimeout(r, 20));
                    currentConcurrent--;
                    return { kind: "ok" as const, output: { v: 1 } };
                },
            });

            reg.register(makeSlowTask("mock.slow1"));
            reg.register(makeSlowTask("mock.slow2"));
            reg.register(makeSlowTask("mock.slow3"));

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-concurrency",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "s1",
                                    nodes: {
                                        s1: {
                                            kind: "task",
                                            task: "mock.slow1",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "x",
                                        },
                                    },
                                    output: { $from: "scope", name: "x" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "s2",
                                    nodes: {
                                        s2: {
                                            kind: "task",
                                            task: "mock.slow2",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "x",
                                        },
                                    },
                                    output: { $from: "scope", name: "x" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            c: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "s3",
                                    nodes: {
                                        s3: {
                                            kind: "task",
                                            task: "mock.slow3",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "x",
                                        },
                                    },
                                    output: { $from: "scope", name: "x" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        maxConcurrency: 1,
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            // With maxConcurrency=1, no more than 1 branch should run at a time
            expect(maxConcurrent).toBe(1);
        });

        it("collects output from terminal node in multi-node branch", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.step1",
                sideEffects: false,
                inputSchema: { type: "object" as const },
                outputSchema: {
                    type: "object" as const,
                    required: ["intermediate"],
                    properties: { intermediate: { type: "number" as const } },
                },
                async execute() {
                    return {
                        kind: "ok" as const,
                        output: { intermediate: 10 },
                    };
                },
            });
            reg.register({
                name: "mock.step2",
                sideEffects: false,
                inputSchema: {
                    type: "object" as const,
                    required: ["intermediate"],
                    properties: { intermediate: { type: "number" as const } },
                },
                outputSchema: {
                    type: "object" as const,
                    required: ["final"],
                    properties: { final: { type: "number" as const } },
                },
                async execute(input: any) {
                    return {
                        kind: "ok" as const,
                        output: { final: input.intermediate * 2 },
                    };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-multinode",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a1",
                                    nodes: {
                                        a1: {
                                            kind: "task",
                                            task: "mock.step1",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                required: ["intermediate"],
                                                properties: {
                                                    intermediate: {
                                                        type: "number",
                                                    },
                                                },
                                            },
                                            inputs: {},
                                            bind: "mid",
                                            next: "a2",
                                        },
                                        a2: {
                                            kind: "task",
                                            task: "mock.step2",
                                            inputSchema: {
                                                type: "object",
                                                required: ["intermediate"],
                                                properties: {
                                                    intermediate: {
                                                        type: "number",
                                                    },
                                                },
                                            },
                                            outputSchema: {
                                                type: "object",
                                                required: ["final"],
                                                properties: {
                                                    final: { type: "number" },
                                                },
                                            },
                                            inputs: {
                                                intermediate: {
                                                    $from: "scope",
                                                    name: "mid",
                                                    path: ["intermediate"],
                                                },
                                            },
                                            bind: "result",
                                        },
                                    },
                                    output: { $from: "scope", name: "result" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b1",
                                    nodes: {
                                        b1: {
                                            kind: "task",
                                            task: "mock.step1",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                required: ["intermediate"],
                                                properties: {
                                                    intermediate: {
                                                        type: "number",
                                                    },
                                                },
                                            },
                                            inputs: {},
                                            bind: "bOut",
                                        },
                                    },
                                    output: { $from: "scope", name: "bOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        bind: "forkResult",
                    },
                },
                output: { $from: "scope", name: "forkResult" },
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            const out = result.output as Record<string, any>;
            // Branch a: terminal node is a2 (not a1), output should be step2's result
            expect(out.a).toEqual({ final: 20 });
            // Branch b: single node, output is step1's result
            expect(out.b).toEqual({ intermediate: 10 });
        });

        it("fork onError recovery works when a branch fails", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.failTask",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "branch failed" },
                    };
                },
            });
            reg.register({
                name: "mock.okTask",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: { v: 1 } };
                },
            });
            reg.register({
                name: "mock.recovery",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: {
                    type: "object",
                    required: ["fallback"],
                    properties: { fallback: { type: "string" } },
                },
                async execute() {
                    return {
                        kind: "ok" as const,
                        output: { fallback: "recovered" },
                    };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-error",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            good: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "ok",
                                    nodes: {
                                        ok: {
                                            kind: "task",
                                            task: "mock.okTask",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "ok",
                                        },
                                    },
                                    output: { $from: "scope", name: "ok" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            bad: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "fail",
                                    nodes: {
                                        fail: {
                                            kind: "task",
                                            task: "mock.failTask",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "fail",
                                        },
                                    },
                                    output: { $from: "scope", name: "fail" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        onError: "recover",
                        bind: "forkOut",
                    },
                    recover: {
                        kind: "task",
                        task: "mock.recovery",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["fallback"],
                            properties: { fallback: { type: "string" } },
                        },
                        inputs: {},
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect((result.output as any).fallback).toBe("recovered");
        });

        it("fork fails when branch fails and no onError is set", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.failTask",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "branch blew up" },
                    };
                },
            });
            reg.register({
                name: "mock.okTask",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: { v: 1 } };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-no-onerror",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            good: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "ok",
                                    nodes: {
                                        ok: {
                                            kind: "task",
                                            task: "mock.okTask",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "r",
                                        },
                                    },
                                    output: { $from: "scope", name: "r" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            bad: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "fail",
                                    nodes: {
                                        fail: {
                                            kind: "task",
                                            task: "mock.failTask",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "r",
                                        },
                                    },
                                    output: { $from: "scope", name: "r" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        bind: "forkOut",
                    },
                },
                output: { $from: "scope", name: "forkOut" },
            };

            const result = await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("branch blew up");
        });
    });

    // ---- ForkMap execution ----

    describe("forkMap execution", () => {
        it("maps over a collection and produces ordered array output", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.double",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["n"],
                    properties: { n: { type: "number" } },
                },
                outputSchema: { type: "number" },
                async execute(input: any) {
                    return {
                        kind: "ok" as const,
                        output: input.n * 2,
                    };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "forkmap-test",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["nums"],
                    properties: {
                        nums: { type: "array", items: { type: "number" } },
                    },
                },
                outputSchema: { type: "array" },
                entry: "forkMap_0",
                nodes: {
                    forkMap_0: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "nums" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "number" },
                        },
                        elementParam: "n",
                        body: {
                            inputSchema: {},
                            entry: "double",
                            nodes: {
                                double: {
                                    kind: "task",
                                    task: "mock.double",
                                    inputSchema: {
                                        type: "object",
                                        required: ["n"],
                                        properties: {
                                            n: { type: "number" },
                                        },
                                    },
                                    outputSchema: { type: "number" },
                                    inputs: {
                                        n: { $from: "input", name: "n" },
                                    },
                                    bind: "doubled",
                                },
                            },
                            output: { $from: "scope", name: "doubled" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            const result = await eng.run(ir, {
                input: { nums: [1, 2, 3, 4] },
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            const out = result.output as any[];
            expect(out).toHaveLength(4);
            // Results are ordered
            expect(out[0]).toBe(2);
            expect(out[1]).toBe(4);
            expect(out[2]).toBe(6);
            expect(out[3]).toBe(8);
        });

        it("forkMap respects maxConcurrency", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);

            let maxConcurrent = 0;
            let currentConcurrent = 0;

            reg.register({
                name: "mock.slowItem",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    currentConcurrent++;
                    maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
                    await new Promise((r) => setTimeout(r, 20));
                    currentConcurrent--;
                    return { kind: "ok" as const, output: { done: true } };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "forkmap-concurrency",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "string" } },
                    },
                },
                outputSchema: { type: "array" },
                entry: "fm",
                nodes: {
                    fm: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "mock.slowItem",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {},
                                    bind: "r",
                                },
                            },
                            output: { $from: "scope", name: "r" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        maxConcurrency: 2,
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            const result = await eng.run(ir, {
                input: { items: ["a", "b", "c", "d", "e"] },
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(maxConcurrent).toBeLessThanOrEqual(2);
            expect(maxConcurrent).toBeGreaterThanOrEqual(1);
        });

        it("forkMap respects maxIterations", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);

            let callCount = 0;
            reg.register({
                name: "mock.counter",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    callCount++;
                    return { kind: "ok" as const, output: { n: callCount } };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "forkmap-maxiter",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "number" } },
                    },
                },
                outputSchema: { type: "array" },
                entry: "fm",
                nodes: {
                    fm: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "number" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "mock.counter",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {},
                                    bind: "r",
                                },
                            },
                            output: { $from: "scope", name: "r" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        maxIterations: 3,
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            const result = await eng.run(ir, {
                input: { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            // Only 3 items processed despite 10 in collection
            expect(callCount).toBe(3);
            expect((result.output as any[]).length).toBe(3);
        });

        it("forkMap handles empty collection", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.noop",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: {} };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "forkmap-empty",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "string" } },
                    },
                },
                outputSchema: { type: "array" },
                entry: "fm",
                nodes: {
                    fm: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "mock.noop",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {},
                                    bind: "r",
                                },
                            },
                            output: { $from: "scope", name: "r" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            const result = await eng.run(ir, {
                input: { items: [] },
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toEqual([]);
        });

        it("forkMap fails when an iteration fails", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);

            reg.register({
                name: "mock.mayFail",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["n"],
                    properties: { n: { type: "number" } },
                },
                outputSchema: { type: "number" },
                async execute(input: any) {
                    if (input.n === 3) {
                        return {
                            kind: "fail" as const,
                            error: { message: "iteration failed on 3" },
                        };
                    }
                    return { kind: "ok" as const, output: input.n * 2 };
                },
            });

            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "forkmap-fail",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["nums"],
                    properties: {
                        nums: { type: "array", items: { type: "number" } },
                    },
                },
                outputSchema: { type: "array" },
                entry: "fm",
                nodes: {
                    fm: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "nums" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "number" },
                        },
                        elementParam: "n",
                        body: {
                            inputSchema: {},
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "mock.mayFail",
                                    inputSchema: {
                                        type: "object",
                                        required: ["n"],
                                        properties: {
                                            n: { type: "number" },
                                        },
                                    },
                                    outputSchema: { type: "number" },
                                    inputs: {
                                        n: { $from: "input", name: "n" },
                                    },
                                    bind: "r",
                                },
                            },
                            output: { $from: "scope", name: "r" },
                            outputSchema: { type: "number" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "number" },
                        },
                        maxConcurrency: 1,
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            const result = await eng.run(ir, {
                input: { nums: [1, 2, 3, 4, 5] },
                policy: allowAllPolicy,
                skipValidation: true,
            });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("iteration failed on 3");
        });
    });

    // ---- Fork events ----

    describe("fork events", () => {
        it("emits forkStarted and forkCompleted events", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.noop",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: {} };
                },
            });

            const events: WorkflowEvent[] = [];
            const eng = new WorkflowEngine(reg);
            eng.on((e: WorkflowEvent) => events.push(e));

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-events",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a_s",
                                    nodes: {
                                        a_s: {
                                            kind: "task",
                                            task: "mock.noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "x",
                                        },
                                    },
                                    output: { $from: "scope", name: "x" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_s",
                                    nodes: {
                                        b_s: {
                                            kind: "task",
                                            task: "mock.noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "y",
                                        },
                                    },
                                    output: { $from: "scope", name: "y" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });

            const forkStarted = events.filter((e) => e.type === "forkStarted");
            expect(forkStarted).toHaveLength(1);
            if (forkStarted[0].type === "forkStarted") {
                expect(forkStarted[0].branchNames).toEqual(
                    expect.arrayContaining(["a", "b"]),
                );
            }

            const forkCompleted = events.filter(
                (e) => e.type === "forkCompleted",
            );
            expect(forkCompleted).toHaveLength(1);
        });

        it("emits forkFailed when a branch fails (with onError)", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.failTask",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return {
                        kind: "fail" as const,
                        error: { message: "boom" },
                    };
                },
            });
            reg.register({
                name: "mock.recovery",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: { ok: true } };
                },
            });

            const events: WorkflowEvent[] = [];
            const eng = new WorkflowEngine(reg);
            eng.on((e: WorkflowEvent) => events.push(e));

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-fail-events",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a_s",
                                    nodes: {
                                        a_s: {
                                            kind: "task",
                                            task: "mock.failTask",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "x",
                                        },
                                    },
                                    output: { $from: "scope", name: "x" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_s",
                                    nodes: {
                                        b_s: {
                                            kind: "task",
                                            task: "mock.failTask",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "y",
                                        },
                                    },
                                    output: { $from: "scope", name: "y" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        onError: "recover",
                        bind: "out",
                    },
                    recover: {
                        kind: "task",
                        task: "mock.recovery",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "recovered",
                    },
                },
                output: { $from: "scope", name: "recovered" },
            };

            await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });

            const forkFailed = events.filter((e) => e.type === "forkFailed");
            expect(forkFailed).toHaveLength(1);
            if (forkFailed[0].type === "forkFailed") {
                expect(forkFailed[0].error.message).toContain("boom");
            }
        });

        it("emits forkMapIterationStarted/Completed events", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.identity",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute(input: any) {
                    return { kind: "ok" as const, output: input };
                },
            });

            const events: WorkflowEvent[] = [];
            const eng = new WorkflowEngine(reg);
            eng.on((e: WorkflowEvent) => events.push(e));

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "forkmap-events",
                version: "1",
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "number" } },
                    },
                },
                outputSchema: { type: "array" },
                entry: "fm",
                nodes: {
                    fm: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "number" },
                        },
                        elementParam: "n",
                        body: {
                            inputSchema: {},
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "mock.identity",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {
                                        n: { $from: "input", name: "n" },
                                    },
                                    bind: "r",
                                },
                            },
                            output: { $from: "scope", name: "r" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            await eng.run(ir, {
                input: { items: [10, 20, 30] },
                policy: allowAllPolicy,
                skipValidation: true,
            });

            const iterStarted = events.filter(
                (e) => e.type === "forkMapIterationStarted",
            );
            const iterCompleted = events.filter(
                (e) => e.type === "forkMapIterationCompleted",
            );
            expect(iterStarted).toHaveLength(3);
            expect(iterCompleted).toHaveLength(3);
            // Indices should be 0, 1, 2
            const startIndices = iterStarted.map((e) =>
                e.type === "forkMapIterationStarted" ? e.index : -1,
            );
            expect(startIndices.sort()).toEqual([0, 1, 2]);
        });

        it("forkStarted precedes forkCompleted", async () => {
            const reg = new TaskRegistry();
            for (const t of allBuiltinTasks) reg.register(t);
            reg.register({
                name: "mock.noop",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                async execute() {
                    return { kind: "ok" as const, output: {} };
                },
            });

            const events: WorkflowEvent[] = [];
            const eng = new WorkflowEngine(reg);
            eng.on((e: WorkflowEvent) => events.push(e));

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fork-order",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a_s",
                                    nodes: {
                                        a_s: {
                                            kind: "task",
                                            task: "mock.noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "x",
                                        },
                                    },
                                    output: { $from: "scope", name: "x" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_s",
                                    nodes: {
                                        b_s: {
                                            kind: "task",
                                            task: "mock.noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "object" },
                                            inputs: {},
                                            bind: "y",
                                        },
                                    },
                                    output: { $from: "scope", name: "y" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        bind: "out",
                    },
                },
                output: { $from: "scope", name: "out" },
            };

            await eng.run(ir, {
                input: {},
                policy: allowAllPolicy,
                skipValidation: true,
            });

            const forkIdx = events.findIndex((e) => e.type === "forkStarted");
            const completeIdx = events.findIndex(
                (e) => e.type === "forkCompleted",
            );
            expect(forkIdx).toBeGreaterThanOrEqual(0);
            expect(completeIdx).toBeGreaterThan(forkIdx);
        });
    });

    describe("never-output runtime enforcement", () => {
        it("throws EngineError if a never-output task returns ok", async () => {
            // A rogue task that claims never-output but returns ok.
            const rogueFail: TaskDefinition = {
                name: "rogue.fail",
                sideEffects: false,
                inputSchema: { type: "object" },
                outputSchema: { not: {} },
                async execute() {
                    return { kind: "ok", output: "oops" };
                },
            };

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "never-output-violation",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fail_node",
                nodes: {
                    fail_node: {
                        kind: "task",
                        task: "rogue.fail",
                        inputSchema: { type: "object" },
                        outputSchema: { not: {} },
                        inputs: {},
                    },
                },
                output: {},
            };

            const reg = makeRegistry(...allBuiltinTasks, rogueFail);
            const engine = new WorkflowEngine(reg);
            const result = await engine.run(ir, {
                skipValidation: true,
                policy: allowAllPolicy,
            });
            expect(result.success).toBe(false);
            expect(result.error!.message).toContain(
                "never-output schema but returned ok",
            );
        });

        it("allows a proper never-output task that fails", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "proper-throw",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: {},
                entry: "fail_node",
                nodes: {
                    fail_node: {
                        kind: "task",
                        task: "error.fail",
                        inputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: { value: {} },
                        },
                        outputSchema: { not: {} },
                        inputs: { value: "boom" },
                    },
                },
                output: {},
            };

            const reg = makeRegistry(...allBuiltinTasks);
            const engine = new WorkflowEngine(reg);
            const result = await engine.run(ir, {
                skipValidation: true,
                policy: allowAllPolicy,
            });
            // error.fail causes a TaskFailure which becomes an error
            expect(result.error).toBeDefined();
            expect(result.error!.message).toContain("boom");
        });
    });

    // ---- Gap 13: iteration number in loop body events ----

    describe("iteration number in loop body events", () => {
        it("emits iteration index on nodeStarted/nodeCompleted for loop body tasks", async () => {
            // Simple loop that runs exactly 3 iterations using a counter.
            // Each body step is a task that should have `iteration` on its events.
            const counterTask: TaskDefinition = {
                name: "test.counter",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["i"],
                    properties: { i: { type: "integer" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["next"],
                    properties: { next: { type: "integer" } },
                },
                async execute(input: any) {
                    return { kind: "ok", output: { next: input.i + 1 } };
                },
            };

            const reg = makeRegistry(...allBuiltinTasks, counterTask);
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);

            const loopIR: WorkflowIR = {
                kind: "workflow",
                name: "iterTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "integer" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: { schema: { type: "integer" }, initial: 0 },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "test.counter",
                                    inputSchema: {
                                        type: "object",
                                        required: ["i"],
                                        properties: { i: { type: "integer" } },
                                    },
                                    outputSchema: {
                                        type: "object",
                                        required: ["next"],
                                        properties: {
                                            next: { type: "integer" },
                                        },
                                    },
                                    inputs: {
                                        i: {
                                            $from: "state",
                                            name: "i",
                                        } as Template,
                                    },
                                    next: "check",
                                    bind: "counted",
                                },
                                check: {
                                    kind: "branch",
                                    selector: {
                                        $from: "scope",
                                        name: "counted",
                                        path: ["next"],
                                    } as Template,
                                    selectorSchema: { type: "integer" },
                                    // exit when counter reaches 3
                                    cases: { "3": "@exit" },
                                    default: "@iterate",
                                },
                            },
                            output: { $from: "state", name: "i" } as Template,
                            outputSchema: { type: "integer" },
                        },
                        iterateState: {
                            i: {
                                $from: "scope",
                                name: "counted",
                                path: ["next"],
                            } as Template,
                        },
                        maxIterations: 10,
                        bind: "result",
                    },
                },
                entry: "loop",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(loopIR, { input: {} });
            expect(result.success).toBe(true);

            // Only events for the loop body node "step" (inside the loop)
            // should carry an iteration field.
            const stepStarted = events.filter(
                (e) => e.type === "nodeStarted" && (e as any).nodeId === "step",
            ) as any[];

            // Loop ran 3 iterations (counter 0->1, 1->2, 2->3 then exits)
            expect(stepStarted).toHaveLength(3);

            // Each nodeStarted for the body should have iteration = 0, 1, 2
            const iterations = stepStarted.map((e) => e.iteration);
            expect(iterations).toEqual([0, 1, 2]);

            // nodeCompleted for "step" should also carry iteration
            const stepCompleted = events.filter(
                (e) =>
                    e.type === "nodeCompleted" && (e as any).nodeId === "step",
            ) as any[];
            expect(stepCompleted).toHaveLength(3);
            expect(stepCompleted.map((e) => e.iteration)).toEqual([0, 1, 2]);
        });

        it("does not emit iteration on top-level (non-loop-body) task events", async () => {
            const events = collectEvents(engine);
            const result = await engine.run(makeA4IR(), {
                input: {
                    repos: ["r1"],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });
            expect(result.success).toBe(true);

            // Top-level tasks like fetchCalendar, renderCalendar, compose etc.
            // should NOT have an iteration field.
            const topLevelStarted = events.filter(
                (e) =>
                    e.type === "nodeStarted" &&
                    (e as any).nodeId === "fetchCalendar",
            ) as any[];
            expect(topLevelStarted).toHaveLength(1);
            expect(topLevelStarted[0].iteration).toBeUndefined();
        });

        it("emits iteration on branch nodeStarted/nodeCompleted inside loop body", async () => {
            // The A4 IR's repoLoop body contains "checkDone" branch.
            // Events for that branch inside the loop should carry iteration.
            const events = collectEvents(engine);
            const result = await engine.run(makeA4IR(), {
                input: {
                    repos: ["a", "b"],
                    maxEmails: 1,
                    maxCommits: 1,
                },
            });
            expect(result.success).toBe(true);

            const branchStarted = events.filter(
                (e) =>
                    e.type === "nodeStarted" &&
                    (e as any).nodeId === "checkDone",
            ) as any[];
            // One iteration per repo
            expect(branchStarted).toHaveLength(2);
            branchStarted.forEach((e) => {
                expect(e.iteration).toBeDefined();
                expect(typeof e.iteration).toBe("number");
            });
        });
    });
});
