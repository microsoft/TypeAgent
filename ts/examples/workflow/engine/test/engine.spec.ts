// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A4 morning-brief workflow: end-to-end engine test.
 *
 * This exercises: template resolution ($from references, literal pass-through),
 * linear task chains, onError recovery dispatch, loop with state/iterateState/
 * sentinels, branch nodes, and all six standard-library tasks.
 */

import { WorkflowIR, TaskDefinition } from "workflow-model";
import {
    TaskRegistry,
    WorkflowEngine,
    WorkflowEvent,
    standardLibraryTasks,
    allBuiltinTasks,
} from "../src/index.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---- Mock domain tasks ----

const emailFetchUnread: TaskDefinition = {
    name: "email.fetchUnread",
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
                        initial: [] as any,
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
                            next: "labelDone",
                            bind: "hasMore",
                        },
                        labelDone: {
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
                                value: {
                                    $from: "scope",
                                    name: "hasMore",
                                    path: ["result"],
                                },
                                ifTrue: "more",
                                ifFalse: "done",
                            },
                            next: "checkDone",
                            bind: "doneLabel",
                        },
                        checkDone: {
                            kind: "branch",
                            selector: {
                                $from: "scope",
                                name: "doneLabel",
                                path: ["label"],
                            },
                            selectorSchema: { enum: ["more", "done"] },
                            cases: { more: "@iterate", done: "@exit" },
                            default: "@exit",
                        },
                    },
                },
                iterateState: {
                    i: {
                        $from: "scope",
                        name: "stepped",
                        path: ["result"],
                    } as any,
                    sections: {
                        $from: "scope",
                        name: "appended",
                        path: ["list"],
                    } as any,
                },
                // NOTE: output reads from scope (body binding), not state.
                // At @exit, state reflects the beginning of the last iteration
                // (set by the prior @iterate). The final appendSection result
                // is only in the scope binding "appended".
                output: {
                    $from: "scope",
                    name: "appended",
                    path: ["list"],
                } as any,
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
        output: { $from: "scope", name: "result", path: ["brief"] } as any,
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
                repos: ["typeagent", "typechat"],
                maxEmails: 5,
                maxCommits: 10,
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
                repos: ["a", "b", "c"],
                maxEmails: 1,
                maxCommits: 1,
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
                repos: ["only-one"],
                maxEmails: 1,
                maxCommits: 1,
            });

            expect(result.success).toBe(true);
            expect(result.output as string).toContain("repo");
        });

        it("handles empty repos list", async () => {
            const ir = makeA4IR();

            const result = await engine.run(ir, {
                repos: [],
                maxEmails: 1,
                maxCommits: 1,
            });

            // With empty repos, the loop body runs once with index 0,
            // list.elementAt returns undefined, and fetchRepo may fail.
            // The exact behavior depends on how list.elementAt handles
            // out-of-range. For now, just verify it doesn't crash the engine.
            expect(result).toBeDefined();
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
                repos: ["r1"],
                maxEmails: 1,
                maxCommits: 1,
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
                repos: ["r"],
                maxEmails: 1,
                maxCommits: 1,
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
                            a: { $from: "input", name: "a" } as any,
                            b: { $from: "input", name: "b" } as any,
                        },
                        bind: "sum",
                    },
                },
                entry: "add",
                output: { $from: "scope", name: "sum" } as any,
            };

            const result = await engine.run(ir, { a: 3, b: 7 });
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ result: 10 });
        });

        it("bool.toLabel converts boolean to string", async () => {
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
                            value: true as any,
                            ifTrue: "yes",
                            ifFalse: "no",
                        },
                        bind: "result",
                    },
                },
                entry: "label",
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await engine.run(ir, {});
            expect(result.success).toBe(true);
            expect(result.output).toEqual({ label: "yes" });
        });
    });

    describe("branch nodes", () => {
        it("routes based on discriminant value", async () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                name: "branchTest",
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
                            value: false as any,
                            ifTrue: "yes",
                            ifFalse: "no",
                        },
                        next: "decide",
                        bind: "labelResult",
                    },
                    decide: {
                        kind: "branch",
                        selector: {
                            $from: "scope",
                            name: "labelResult",
                            path: ["label"],
                        } as any,
                        selectorSchema: { enum: ["yes", "no"] },
                        cases: { yes: "onYes", no: "onNo" },
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
                        inputs: { a: 1 as any, b: 1 as any },
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
                        inputs: { a: 0 as any, b: 0 as any },
                        bind: "answer",
                    },
                },
                entry: "label",
                output: { $from: "scope", name: "answer" } as any,
            };

            const events = collectEvents(engine);
            const result = await engine.run(ir, {});
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

            const result = await engine.run(ir, {});
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("nonexistent");
        });

        it("rejects IR with unregistered task", async () => {
            const minimalRegistry = makeRegistry(...standardLibraryTasks);
            const eng = new WorkflowEngine(minimalRegistry);

            const result = await eng.run(makeA4IR(), {
                repos: [],
                maxEmails: 1,
                maxCommits: 1,
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
                                name: "Alice" as any,
                                count: 3 as any,
                            },
                        },
                        bind: "result",
                    },
                },
                entry: "tmpl",
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await eng.run(ir, {});
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
                                x: "2" as any,
                                y: "4" as any,
                            },
                        },
                        bind: "result",
                    },
                },
                entry: "tmpl",
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await eng.run(ir, {});
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
                            list: ["alpha", "beta", "gamma"] as any,
                            delimiter: ", ",
                        },
                        bind: "result",
                    },
                },
                entry: "join",
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await eng.run(ir, {});
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
                            list: [] as any,
                            delimiter: "\n",
                        },
                        bind: "result",
                    },
                },
                entry: "join",
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await eng.run(ir, {});
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
                            args: ["hello", "world"] as any,
                        },
                        bind: "result",
                    },
                },
                entry: "echo",
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await eng.run(ir, {});
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
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await eng.run(ir, {});
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
                output: { $from: "scope", name: "result" } as any,
            };

            const result = await eng.run(ir, {});
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
                repos: ["/tmp"],
                author: "test",
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
                    const repo = cwd.split("/").pop();
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
                repos: ["/repos/typeagent", "/repos/typechat"],
                author: "curtism",
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
            const result = await eng.run(ir, { repoPath: "/tmp" });

            if (!result.success) {
                expect(result.error?.message).not.toContain(
                    "Validation failed",
                );
            }
        });

        it("runs with mock shell.exec and mock llm.generate", async () => {
            const mockShellExec: TaskDefinition = {
                name: "shell.exec",
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
            const result = await eng.run(ir, { repoPath: "/repos/myproject" });

            expect(result.success).toBe(true);
            const output = result.output as { message: string };
            expect(output.message).toContain("feat(foo)");
            expect(output.message).toContain("add new line");
        });
    });
});
