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
    standardLibraryTasks,
    allBuiltinTasks,
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
    outputSchema: {
        type: "object",
        required: ["messages"],
        properties: { messages: { type: "array" } },
    },
    async execute(input: any) {
        const messages = [];
        for (let i = 0; i < Math.min(input.max, 2); i++) {
            messages.push({ subject: `Email ${i + 1}`, from: "test@test.com" });
        }
        return { kind: "ok", output: { messages } };
    },
};

const calendarToday: TaskDefinition = {
    name: "calendar.today",
    sideEffects: false,
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
        type: "object",
        required: ["events"],
        properties: { events: { type: "array" } },
    },
    async execute() {
        return {
            kind: "ok",
            output: { events: [{ title: "Standup", time: "09:00" }] },
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
    outputSchema: {
        type: "object",
        required: ["brief"],
        properties: { brief: { type: "string" } },
    },
    async execute(input: any) {
        const parts = [
            input.calendarSection.body,
            input.emailSection.body,
            ...input.repoSections.map((s: any) => s.body),
        ];
        return { kind: "ok", output: { brief: parts.join("\n\n") } };
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
        outputSchema: {
            type: "object",
            required: ["brief"],
            properties: { brief: { type: "string" } },
        },
        constants: {
            one: { schema: { type: "integer" }, value: 1 },
        },
        nodes: {
            // Calendar
            fetchCalendar: {
                kind: "task",
                task: "calendar.today",
                inputSchema: { type: "object", properties: {} },
                outputSchema: {
                    type: "object",
                    required: ["events"],
                    properties: { events: { type: "array" } },
                },
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
                        path: ["events"],
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
                    required: ["section", "reason"],
                    properties: {
                        section: { type: "string" },
                        reason: { type: "string" },
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
                outputSchema: {
                    type: "object",
                    required: ["messages"],
                    properties: { messages: { type: "array" } },
                },
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
                        path: ["messages"],
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
                    required: ["section", "reason"],
                    properties: {
                        section: { type: "string" },
                        reason: { type: "string" },
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
                state: {
                    i: { schema: { type: "integer" }, initial: 0 },
                    sections: {
                        schema: { type: "array" },
                        initial: [] as Template,
                    },
                },
                body: {
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
                            outputSchema: {
                                type: "object",
                                required: ["element"],
                                properties: { element: {} },
                            },
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
                                    path: ["element"],
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
                                required: ["section", "reason"],
                                properties: {
                                    section: { type: "string" },
                                    reason: { type: "string" },
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
                            outputSchema: {
                                type: "object",
                                required: ["list"],
                                properties: { list: { type: "array" } },
                            },
                            inputs: {
                                list: { $from: "state", name: "sections" },
                                item: { $from: "scope", name: "newSection" },
                            },
                            next: "stepIndex",
                            bind: "appended",
                        },
                        stepIndex: {
                            kind: "task",
                            task: "int.add",
                            inputSchema: {
                                type: "object",
                                required: ["a", "b"],
                                properties: {
                                    a: { type: "integer" },
                                    b: { type: "integer" },
                                },
                            },
                            outputSchema: {
                                type: "object",
                                required: ["result"],
                                properties: { result: { type: "integer" } },
                            },
                            inputs: {
                                a: { $from: "state", name: "i" },
                                b: 1,
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
                            outputSchema: {
                                type: "object",
                                required: ["length"],
                                properties: { length: { type: "integer" } },
                            },
                            inputs: {
                                list: { $from: "input", name: "repos" },
                            },
                            next: "compareIndex",
                            bind: "repoCount",
                        },
                        compareIndex: {
                            kind: "task",
                            task: "int.lessThan",
                            inputSchema: {
                                type: "object",
                                required: ["a", "b"],
                                properties: {
                                    a: { type: "integer" },
                                    b: { type: "integer" },
                                },
                            },
                            outputSchema: {
                                type: "object",
                                required: ["result"],
                                properties: { result: { type: "boolean" } },
                            },
                            inputs: {
                                a: {
                                    $from: "scope",
                                    name: "stepped",
                                    path: ["result"],
                                },
                                b: {
                                    $from: "scope",
                                    name: "repoCount",
                                    path: ["length"],
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
                                path: ["result"],
                            },
                            selectorSchema: { type: "boolean" },
                            cases: { true: "@iterate", false: "@exit" },
                            default: "@exit",
                        },
                    },
                },
                iterateState: {
                    i: {
                        $from: "scope",
                        name: "stepped",
                        path: ["result"],
                    } as Template,
                    sections: {
                        $from: "scope",
                        name: "appended",
                        path: ["list"],
                    } as Template,
                },
                // NOTE: output reads from scope (body binding), not state.
                // At @exit, state reflects the beginning of the last iteration
                // (set by the prior @iterate). The final appendSection result
                // is only in the scope binding "appended".
                output: {
                    $from: "scope",
                    name: "appended",
                    path: ["list"],
                } as Template,
                outputSchema: { type: "array" },
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
                outputSchema: {
                    type: "object",
                    required: ["brief"],
                    properties: { brief: { type: "string" } },
                },
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
        output: { $from: "scope", name: "result", path: ["brief"] } as Template,
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
        registry = makeRegistry(...standardLibraryTasks, ...domainTasks);
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
                ...standardLibraryTasks,
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
        it("int.add computes correctly", async () => {
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
                outputSchema: { type: "object" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: { $from: "input", name: "a" } as Template,
                            b: { $from: "input", name: "b" } as Template,
                        },
                        bind: "sum",
                    },
                },
                entry: "add",
                output: { $from: "scope", name: "sum" } as Template,
            };

            const result = await engine.run(ir, { input: { a: 3, b: 7 } });
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ result: 10 });
        });

        it("bool.toLabel converts boolean to string (legacy)", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "labelTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                        outputSchema: {
                            type: "object",
                            required: ["label"],
                            properties: { label: { type: "string" } },
                        },
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
            expect(result.output).toEqual({ label: "yes" });
        });
    });

    describe("branch nodes", () => {
        it("routes based on boolean discriminant", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "branchTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 1 as Template },
                        bind: "answer",
                    },
                    onNo: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 0 as Template, b: 0 as Template },
                        bind: "answer",
                    },
                },
                entry: "decide",
                output: { $from: "scope", name: "answer" } as Template,
            };

            const events = collectEvents(engine);
            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ result: 0 }); // "no" branch

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
            const minimalRegistry = makeRegistry(...standardLibraryTasks);
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
                outputSchema: { type: "object" },
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
                        outputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
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
            expect(result.output).toEqual({
                text: "Hello Alice, you have 3 items",
            });
        });

        it("replaces multiple occurrences of the same variable", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "multiReplace",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                        outputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
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
            expect(result.output).toEqual({ text: "2 + 2 = 4" });
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
                outputSchema: { type: "object" },
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
                        outputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
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
            expect(result.output).toEqual({ text: "alpha, beta, gamma" });
        });

        it("handles empty list", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "joinEmpty",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                        outputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
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
            expect(result.output).toEqual({ text: "" });
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
                outputSchema: { type: "object" },
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
                            command: "echo",
                            args: ["hello", "world"] as Template,
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
                outputSchema: { type: "object" },
                nodes: {
                    fail: {
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
                            command: "false",
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
                outputSchema: { type: "object" },
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
                ...standardLibraryTasks,
                mockShellExec,
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "shell.exec" &&
                        !standardLibraryTasks.some((s) => s.name === t.name),
                ),
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
                outputSchema: {
                    type: "object",
                    required: ["text"],
                    properties: { text: { type: "string" } },
                },
                async execute(input: any) {
                    // Verify the prompt contains the diff
                    const prompt = input.prompt as string;
                    expect(prompt).toContain("diff --git");
                    expect(prompt).toContain("conventional commit");
                    return {
                        kind: "ok",
                        output: {
                            text: "feat(foo): add new line\n\nAdded a line to foo.ts.",
                        },
                    };
                },
            };

            const reg = makeRegistry(
                ...standardLibraryTasks,
                mockShellExec,
                mockLlmGenerate,
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "shell.exec" &&
                        t.name !== "llm.generate" &&
                        !standardLibraryTasks.some((s) => s.name === t.name),
                ),
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
                outputSchema: { type: "object" },
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
                            type: "object",
                            required: ["list"],
                            properties: {
                                list: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                            },
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
            expect(result.output).toEqual({
                list: ["foo.ts", "bar.ts", "baz.ts"],
            });
        });

        it("handles empty input", async () => {
            const reg = makeRegistry(...allBuiltinTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "splitEmpty",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                            type: "object",
                            required: ["list"],
                            properties: {
                                list: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                            },
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
            expect(result.output).toEqual({ list: [] });
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
                outputSchema: {
                    type: "object",
                    required: ["text"],
                    properties: { text: { type: "string" } },
                },
                async execute(input: any) {
                    const prompt = input.prompt as string;
                    // Extract the file name from the prompt
                    const match = prompt.match(/File: (.+)\n/);
                    const file = match ? match[1] : "unknown";
                    const summary = `Changes to ${file} look good.`;
                    summaries.push(summary);
                    return { kind: "ok", output: { text: summary } };
                },
            };

            const reg = makeRegistry(
                ...standardLibraryTasks,
                mockShellExec,
                mockLlmGenerate,
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "shell.exec" &&
                        t.name !== "llm.generate" &&
                        !standardLibraryTasks.some((s) => s.name === t.name),
                ),
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
                ...standardLibraryTasks,
                mockHttpGet,
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "http.get" &&
                        !standardLibraryTasks.some((s) => s.name === t.name),
                ),
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "httpTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
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
                        outputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
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
            expect((writeResult.output as any).path).toBe(testFile);

            // Read back
            const readIr: WorkflowIR = {
                kind: "workflow",
                name: "readTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    read: {
                        kind: "task",
                        task: "file.read",
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["content"],
                            properties: {
                                content: { type: "string" },
                            },
                        },
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
            expect((readResult.output as any).content).toBe(
                "hello from workflow",
            );
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
                outputSchema: {
                    type: "object",
                    required: ["text"],
                    properties: { text: { type: "string" } },
                },
                async execute(input: any) {
                    expect(input.prompt).toContain("TypeAgent");
                    return {
                        kind: "ok",
                        output: {
                            text: "TypeAgent is a framework for personal agents that route requests to specialized plugins.",
                        },
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
                outputSchema: {
                    type: "object",
                    required: ["path"],
                    properties: { path: { type: "string" } },
                },
                async execute(input: any) {
                    return {
                        kind: "ok",
                        output: { path: input.path },
                    };
                },
            };

            const reg = makeRegistry(
                ...standardLibraryTasks,
                mockHttpGet,
                mockLlm,
                mockFileWrite,
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "http.get" &&
                        t.name !== "llm.generate" &&
                        t.name !== "file.write" &&
                        !standardLibraryTasks.some((s) => s.name === t.name),
                ),
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
                outputSchema: {
                    type: "object",
                    required: ["text"],
                    properties: { text: { type: "string" } },
                },
                async execute() {
                    return {
                        kind: "ok",
                        output: { text: "Summary after retry." },
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
                outputSchema: {
                    type: "object",
                    required: ["path"],
                    properties: { path: { type: "string" } },
                },
                async execute(input: any) {
                    return {
                        kind: "ok",
                        output: { path: input.path },
                    };
                },
            };

            const reg = makeRegistry(
                ...standardLibraryTasks,
                mockHttpGet,
                mockLlm,
                mockFileWrite,
                ...allBuiltinTasks.filter(
                    (t) =>
                        t.name !== "http.get" &&
                        t.name !== "llm.generate" &&
                        t.name !== "file.write" &&
                        !standardLibraryTasks.some((s) => s.name === t.name),
                ),
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
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: taskName,
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["content"],
                            properties: {
                                content: { type: "string" },
                            },
                        },
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

            // int.add has no sideEffects, should run even with no approve fn
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "pureTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: {
                                result: { type: "integer" },
                            },
                        },
                        inputs: { a: 2 as Template, b: 3 as Template },
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
            expect((result.output as any).result).toBe(5);
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
                outputSchema: { type: "object" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: {
                                result: { type: "integer" },
                            },
                        },
                        inputs: { a: 10 as Template, b: 20 as Template },
                        bind: "result",
                    },
                },
                entry: "add",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: { a: 1, b: 2 } });
            expect(result.success).toBe(true);
            expect((result.output as any).result).toBe(30);
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
                outputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: { type: "integer" } },
                },
                async execute() {
                    // Returns a string instead of the required integer.
                    return { kind: "ok", output: { value: "not-an-integer" } };
                },
            };

            const reg = makeRegistry(...standardLibraryTasks, badTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "schemaViolation",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "bad.output",
                        inputSchema: { type: "object", properties: {} },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: { value: { type: "integer" } },
                        },
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
                outputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: { type: "integer" } },
                },
                async execute() {
                    return { kind: "ok", output: { value: 42 } };
                },
            };

            const reg = makeRegistry(...standardLibraryTasks, goodTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "schemaOk",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "good.output",
                        inputSchema: { type: "object", properties: {} },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: { value: { type: "integer" } },
                        },
                        inputs: {},
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect((result.output as any).value).toBe(42);
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
                outputSchema: { type: "object" },
                nodes: {
                    producer: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 2 as Template },
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: {
                                $from: "scope",
                                name: "data",
                                path: ["nonexistent"],
                            } as Template,
                            b: 1 as Template,
                        },
                        bind: "final",
                    },
                },
                entry: "producer",
                output: { $from: "scope", name: "final" } as Template,
            };

            const tasks = new Map(standardLibraryTasks.map((t) => [t.name, t]));
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
                outputSchema: { type: "object" },
                nodes: {
                    producer: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 2 as Template },
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: {
                                $from: "scope",
                                name: "data",
                                path: ["result"],
                            } as Template,
                            b: 1 as Template,
                        },
                        bind: "final",
                    },
                },
                entry: "producer",
                output: { $from: "scope", name: "final" } as Template,
            };

            const tasks = new Map(standardLibraryTasks.map((t) => [t.name, t]));
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
                outputSchema: { type: "object" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        inputSchema: { type: "object" },
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "int.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["a", "b"],
                                        properties: {
                                            a: { type: "integer" },
                                            b: { type: "integer" },
                                        },
                                    },
                                    outputSchema: {
                                        type: "object",
                                        required: ["result"],
                                        properties: {
                                            result: { type: "integer" },
                                        },
                                    },
                                    inputs: {
                                        a: 1 as Template,
                                        b: 1 as Template,
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
                        },
                        iterateState: {
                            i: {
                                $from: "scope",
                                name: "stepped",
                                path: ["nonexistent"],
                            } as Template,
                        },
                        output: 0 as Template,
                        outputSchema: { type: "integer" },
                        maxIterations: 1,
                        bind: "result",
                    },
                },
                entry: "loop",
                output: { $from: "scope", name: "result" } as Template,
            };

            const tasks = new Map(standardLibraryTasks.map((t) => [t.name, t]));
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
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: { $from: "input", name: "count" } as Template,
                            b: 1 as Template,
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
                outputSchema: { type: "object" },
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

            const tasks = new Map(standardLibraryTasks.map((t) => [t.name, t]));
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
                outputSchema: { type: "object" },
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
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 1 as Template },
                        bind: "answer",
                    },
                    onFalse: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 0 as Template, b: 0 as Template },
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

            const reg = makeRegistry(...standardLibraryTasks, failTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "loopOnError",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    badLoop: {
                        kind: "loop",
                        inputs: {},
                        inputSchema: { type: "object" },
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
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
                        },
                        iterateState: {},
                        output: null as Template,
                        outputSchema: { type: "null" },
                        maxIterations: 1,
                        onError: "recover",
                    },
                    recover: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 99 as Template, b: 1 as Template },
                        bind: "recovered",
                    },
                },
                entry: "badLoop",
                output: { $from: "scope", name: "recovered" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect((result.output as any).result).toBe(100);
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

            const reg = makeRegistry(...standardLibraryTasks, slowTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "timeoutTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.slow",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
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
            const reg = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "fastTask",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    add: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: 1 as Template,
                            b: 2 as Template,
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
            expect((result.output as any).result).toBe(3);
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
                outputSchema: { type: "object" },
                nodes: {
                    read: {
                        kind: "task",
                        task: "file.read",
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["content"],
                            properties: {
                                content: { type: "string" },
                            },
                        },
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
                outputSchema: { type: "object" },
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
                        outputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
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
                    outputSchema: { type: "object" },
                    nodes: {
                        read: {
                            kind: "task",
                            task: "file.read",
                            inputSchema: {
                                type: "object",
                                required: ["path"],
                                properties: { path: { type: "string" } },
                            },
                            outputSchema: {
                                type: "object",
                                required: ["content"],
                                properties: {
                                    content: { type: "string" },
                                },
                            },
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
                expect((result.output as any).content).toBe("safe-content");
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

            const reg = makeRegistry(...standardLibraryTasks, mockHttpGet);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "httpTruncateTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
            const reg = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "branchNoDefault",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 1 as Template },
                        bind: "answer",
                    },
                    onNo: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 0 as Template, b: 0 as Template },
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
            const reg = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badConstant",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                constants: {
                    limit: {
                        schema: { type: "integer" },
                        value: "not-a-number", // violates integer schema
                    },
                },
                nodes: {
                    step: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 2 as Template },
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
            expect(result.error?.message).toContain("schema violation");
        });

        it("passes when constant matches its declared schema", async () => {
            const reg = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "goodConstant",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                constants: {
                    offset: {
                        schema: { type: "integer" },
                        value: 42,
                    },
                },
                nodes: {
                    step: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: {
                                $from: "constant",
                                name: "offset",
                            } as Template,
                            b: 8 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            expect((result.output as any).result).toBe(50);
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
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "file.read",
                        inputSchema: {
                            type: "object",
                            required: ["path"],
                            properties: { path: { type: "string" } },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["content"],
                            properties: {
                                content: { type: "string" },
                            },
                        },
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

            const reg = makeRegistry(...standardLibraryTasks, slowTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "abortTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.slow",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
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
                outputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: { type: "integer" } },
                },
                async execute(input: any) {
                    // Simulate a bit of work
                    await new Promise((r) => setTimeout(r, 30));
                    return {
                        kind: "ok" as const,
                        output: { value: (input.n ?? 0) + 1 },
                    };
                },
            };

            const reg = makeRegistry(...standardLibraryTasks, counterTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "loopAbortTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        inputSchema: { type: "object" },
                        state: {
                            count: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
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
                                    outputSchema: {
                                        type: "object",
                                        required: ["value"],
                                        properties: {
                                            value: { type: "integer" },
                                        },
                                    },
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
                        },
                        iterateState: {
                            count: {
                                $from: "scope",
                                name: "incResult",
                                path: ["value"],
                            } as Template,
                        },
                        output: {
                            $from: "state",
                            name: "count",
                        } as Template,
                        outputSchema: { type: "integer" },
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
            const reg = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "maxIterTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        inputSchema: { type: "object" },
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            entry: "add",
                            nodes: {
                                add: {
                                    kind: "task",
                                    task: "int.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["a", "b"],
                                        properties: {
                                            a: { type: "integer" },
                                            b: { type: "integer" },
                                        },
                                    },
                                    outputSchema: {
                                        type: "object",
                                        required: ["result"],
                                        properties: {
                                            result: { type: "integer" },
                                        },
                                    },
                                    inputs: {
                                        a: {
                                            $from: "state",
                                            name: "i",
                                        } as Template,
                                        b: 1 as Template,
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
                        },
                        iterateState: {
                            i: {
                                $from: "scope",
                                name: "next",
                                path: ["result"],
                            } as Template,
                        },
                        output: {
                            $from: "state",
                            name: "i",
                        } as Template,
                        outputSchema: { type: "integer" },
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
            const reg = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "loopConstantTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                        inputSchema: { type: "object" },
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
                            entry: "addStep",
                            nodes: {
                                addStep: {
                                    kind: "task",
                                    task: "int.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["a", "b"],
                                        properties: {
                                            a: { type: "integer" },
                                            b: { type: "integer" },
                                        },
                                    },
                                    outputSchema: {
                                        type: "object",
                                        required: ["result"],
                                        properties: {
                                            result: { type: "integer" },
                                        },
                                    },
                                    inputs: {
                                        a: {
                                            $from: "state",
                                            name: "total",
                                        } as Template,
                                        b: {
                                            $from: "constant",
                                            name: "step",
                                        } as Template,
                                    },
                                    bind: "sum",
                                    next: "incIter",
                                },
                                incIter: {
                                    kind: "task",
                                    task: "int.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["a", "b"],
                                        properties: {
                                            a: { type: "integer" },
                                            b: { type: "integer" },
                                        },
                                    },
                                    outputSchema: {
                                        type: "object",
                                        required: ["result"],
                                        properties: {
                                            result: { type: "integer" },
                                        },
                                    },
                                    inputs: {
                                        a: {
                                            $from: "state",
                                            name: "iter",
                                        } as Template,
                                        b: 1 as Template,
                                    },
                                    bind: "nextIter",
                                    next: "check",
                                },
                                check: {
                                    kind: "branch",
                                    selector: {
                                        $from: "scope",
                                        name: "nextIter",
                                        path: ["result"],
                                    } as Template,
                                    selectorSchema: { type: "integer" },
                                    cases: { 2: "@exit" },
                                    default: "@iterate",
                                },
                            },
                        },
                        iterateState: {
                            total: {
                                $from: "scope",
                                name: "sum",
                                path: ["result"],
                            } as Template,
                            iter: {
                                $from: "scope",
                                name: "nextIter",
                                path: ["result"],
                            } as Template,
                        },
                        output: {
                            $from: "scope",
                            name: "sum",
                            path: ["result"],
                        } as Template,
                        outputSchema: { type: "integer" },
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

            const reg = makeRegistry(
                ...standardLibraryTasks,
                failTask,
                noopTask,
            );
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "nodeFailedTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "recover",
                        bind: "r",
                    },
                    recover: {
                        kind: "task",
                        task: "test.noop",
                        inputSchema: { type: "object" },
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

            const reg = makeRegistry(...standardLibraryTasks, failTask);
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "runFailedTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 2 as Template },
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
            const reg = makeRegistry(...standardLibraryTasks);
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
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 2 as Template },
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
            const reg = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "bindOverwrite",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    first: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 1 as Template, b: 2 as Template },
                        bind: "answer",
                        next: "second",
                    },
                    second: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: { a: 10 as Template, b: 20 as Template },
                        bind: "answer",
                    },
                },
                entry: "first",
                output: { $from: "scope", name: "answer" } as Template,
            };

            const result = await eng.run(ir, { input: {} });
            expect(result.success).toBe(true);
            // Second task's output (30) should override first (3)
            expect((result.output as any).result).toBe(30);
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
                ...standardLibraryTasks,
                failTask,
                failRecovery,
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "cascadeError",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "recover",
                        bind: "r",
                    },
                    recover: {
                        kind: "task",
                        task: "test.failRecovery",
                        inputSchema: { type: "object" },
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
                        output: { value: input.value ?? "default" },
                    };
                },
            };

            const reg = makeRegistry(...standardLibraryTasks, echoTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "optionalRef",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.echo",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
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
            expect((result.output as any).value).toBe("default");
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

            const reg = makeRegistry(...standardLibraryTasks, echoTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "optionalPath",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "shell.exec",
                        inputSchema: {
                            type: "object",
                            required: ["command"],
                            properties: {
                                command: { type: "string" },
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
                            command: "pwd" as Template,
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
                outputSchema: { type: "object" },
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

            const reg = makeRegistry(...standardLibraryTasks, echoTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "literalTest",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.echo",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
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
                outputSchema: { type: "object" },
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

            const reg = makeRegistry(
                ...standardLibraryTasks,
                failTask,
                captureTask,
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "errorStructure",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "capture",
                    },
                    capture: {
                        kind: "task",
                        task: "test.capture",
                        inputSchema: { type: "object" },
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
            expect(errorObj.code).toBe("TASK_ERROR");
            expect(errorObj.message).toBe("broken");
            expect(errorObj.source).toBe("task");
            expect(errorObj.task).toBe("test.fail");
            expect(errorObj.node).toBe("step");
        });

        it("runtime errors have RUNTIME_ERROR code", async () => {
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
                ...standardLibraryTasks,
                throwTask,
                captureTask,
            );
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "runtimeError",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.throw",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "capture",
                    },
                    capture: {
                        kind: "task",
                        task: "test.capture",
                        inputSchema: { type: "object" },
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
            expect(errorObj.code).toBe("RUNTIME_ERROR");
            expect(errorObj.message).toBe("unexpected crash");
            expect(errorObj.source).toBe("runtime");
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
                outputSchema: { type: "object" },
                nodes: {
                    producer: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["label"],
                            properties: { label: { type: "string" } },
                        },
                        inputs: { a: 1 as Template, b: 2 as Template },
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: {
                                $from: "scope",
                                name: "data",
                                path: ["label"],
                            } as Template,
                            b: 1 as Template,
                        },
                        bind: "final",
                    },
                },
                entry: "producer",
                output: { $from: "scope", name: "final" } as Template,
            };

            const tasks = new Map(standardLibraryTasks.map((t) => [t.name, t]));
            const validation = validateWorkflowIR(ir, tasks);
            expect(validation.valid).toBe(false);
            expect(validation.errors[0].message).toContain("type mismatch");
        });
    });

    describe("loop sentinel validation", () => {
        it("rejects loop body without sentinel at validation time", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "noSentinel",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        inputSchema: { type: "object" },
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0 as Template,
                            },
                        },
                        body: {
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "int.add",
                                    inputSchema: {
                                        type: "object",
                                        required: ["a", "b"],
                                        properties: {
                                            a: { type: "integer" },
                                            b: { type: "integer" },
                                        },
                                    },
                                    outputSchema: {
                                        type: "object",
                                        required: ["result"],
                                        properties: {
                                            result: { type: "integer" },
                                        },
                                    },
                                    inputs: {
                                        a: 1 as Template,
                                        b: 1 as Template,
                                    },
                                    bind: "r",
                                },
                            },
                        },
                        iterateState: {},
                        output: 0 as Template,
                        outputSchema: { type: "integer" },
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
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: {
                                $from: "scope",
                                name: "doesNotExist",
                            } as Template,
                            b: 1 as Template,
                        },
                        bind: "result",
                    },
                },
                entry: "step",
                output: { $from: "scope", name: "result" } as Template,
            };

            const result = await engine.run(ir, { input: {} });
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("unresolved");
            expect(result.error?.message).toContain("doesNotExist");
        });
    });

    describe("unknown $from namespace", () => {
        it("fails with clear error for invalid namespace", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badNamespace",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: {
                                $from: "magic",
                                name: "x",
                            } as Template,
                            b: 1 as Template,
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
                outputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: { type: "integer" } },
                },
                async execute() {
                    return { kind: "ok" as const, output: { value: 42 } };
                },
            };

            const reg = makeRegistry(...standardLibraryTasks, numTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "badProjection",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    first: {
                        kind: "task",
                        task: "test.num",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: { value: { type: "integer" } },
                        },
                        inputs: {},
                        bind: "data",
                        next: "second",
                    },
                    second: {
                        kind: "task",
                        task: "int.add",
                        inputSchema: {
                            type: "object",
                            required: ["a", "b"],
                            properties: {
                                a: { type: "integer" },
                                b: { type: "integer" },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "integer" } },
                        },
                        inputs: {
                            a: {
                                $from: "scope",
                                name: "data",
                                path: ["value", "nested"],
                            } as Template,
                            b: 1 as Template,
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

            const reg = makeRegistry(...standardLibraryTasks, failTask);
            const eng = new WorkflowEngine(reg);

            const ir: WorkflowIR = {
                kind: "workflow",
                name: "unhandledFail",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    step: {
                        kind: "task",
                        task: "test.fail",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
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
});
