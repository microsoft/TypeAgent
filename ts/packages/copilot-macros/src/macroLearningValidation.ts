// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";
import type {
    CopilotToolMacro,
    MacroExecutionRecipe,
    MacroLearningBuild,
    MacroInput,
    MacroStep,
    RecordedToolCall,
    RecordedInteractionTrace,
    ValueExpression,
} from "./contracts.js";
import {
    resolveMacroExpression,
    validateMacroInputs,
} from "./deterministicReplay.js";
import { validateMacro } from "./macroDefinition.js";
import { redactTraceValue } from "./redaction.js";

export function learningValuesEqual(left: unknown, right: unknown): boolean {
    // Runtime adapters can return JSON objects from a different JavaScript realm.
    return isDeepStrictEqual(
        JSON.parse(JSON.stringify(left)),
        JSON.parse(JSON.stringify(right)),
    );
}

function assertJsonContainer(value: object): void {
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
        const indices = Object.keys(value);
        if (
            indices.length !== value.length ||
            keys.length !== value.length + 1 ||
            indices.some((key, index) => key !== String(index))
        ) {
            throw new Error("Learning values must be dense JSON arrays.");
        }
    } else {
        const prototype = Object.getPrototypeOf(value);
        if (
            (prototype !== null && Object.getPrototypeOf(prototype) !== null) ||
            keys.length !== Object.keys(value).length
        ) {
            throw new Error("Learning values must be plain JSON objects.");
        }
    }
    if (
        Object.values(Object.getOwnPropertyDescriptors(value)).some(
            (descriptor) =>
                !Object.prototype.hasOwnProperty.call(descriptor, "value"),
        )
    ) {
        throw new Error("Learning JSON values cannot contain accessors.");
    }
}

export function assertLearningJson(value: unknown): void {
    let nodes = 0;
    const visit = (entry: unknown, depth: number): void => {
        if (++nodes > 20_000 || depth > 30) {
            throw new Error("Learning value exceeds structural limits.");
        }
        if (entry === null || typeof entry === "boolean") return;
        if (typeof entry === "string") {
            if (entry.includes("[REDACTED]")) {
                throw new Error(
                    "Secret-bearing evidence is not eligible for learning.",
                );
            }
            return;
        }
        if (typeof entry === "number" && Number.isFinite(entry)) return;
        if (typeof entry !== "object") {
            throw new Error("Learning values must be finite JSON values.");
        }
        assertJsonContainer(entry);
        for (const [key, child] of Object.entries(entry)) {
            if (["__proto__", "constructor", "prototype"].includes(key)) {
                throw new Error("Unsafe learning value key.");
            }
            visit(child, depth + 1);
        }
    };
    visit(value, 0);
    if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) {
        throw new Error("Learning value exceeds the 256 KiB limit.");
    }
}

export function assertLearningValue(value: unknown): void {
    assertLearningJson(value);
    if (!learningValuesEqual(value, redactTraceValue(value))) {
        throw new Error(
            "Secret-bearing evidence is not eligible for learning.",
        );
    }
}

export function assertLearningTrace(trace: RecordedInteractionTrace): void {
    assertLearningValue(trace);
    if (
        trace.schemaVersion !== 1 ||
        !trace.cwd ||
        !trace.sessionId ||
        !trace.prompt.trim() ||
        !trace.response.trim() ||
        !Number.isFinite(Date.parse(trace.startedAt)) ||
        !Number.isFinite(Date.parse(trace.completedAt)) ||
        Date.parse(trace.completedAt) < Date.parse(trace.startedAt) ||
        !Array.isArray(trace.toolCalls) ||
        trace.toolCalls.length === 0 ||
        trace.toolCalls.length > 100 ||
        new Set(trace.toolCalls.map((call) => call.toolCallId)).size !==
            trace.toolCalls.length ||
        trace.toolCalls.some(
            (call) =>
                !call.toolCallId ||
                !call.name ||
                call.status !== "completed" ||
                call.arguments === undefined ||
                call.result === undefined,
        )
    ) {
        throw new Error(
            "Learning requires a complete successful recorded trace.",
        );
    }
}

export function assertLearningRecipe(
    recipe: MacroExecutionRecipe,
    trace: RecordedInteractionTrace,
    traceId: string,
): void {
    assertLearningValue(recipe);
    if (
        recipe.schemaVersion !== 1 ||
        recipe.traceId !== traceId ||
        recipe.request !== trace.prompt ||
        typeof recipe.description !== "string" ||
        !recipe.description.trim() ||
        !Array.isArray(recipe.uncertainties) ||
        recipe.uncertainties.some((item) => typeof item !== "string") ||
        !learningValuesEqual(
            recipe.toolCallIds,
            trace.toolCalls.map((call) => call.toolCallId),
        )
    ) {
        throw new Error(
            "Recipe provenance does not match the exact recorded interaction.",
        );
    }
    if (recipe.uncertainties.length !== 0) {
        throw new Error(
            "Recipe contains unresolved execution or output uncertainties.",
        );
    }
}

const valueTypes = new Set([
    "null",
    "array",
    "object",
    "string",
    "number",
    "boolean",
]);

function assertPath(
    path: unknown,
    allowEmpty: boolean,
): asserts path is string[] {
    if (
        !Array.isArray(path) ||
        (!allowEmpty && path.length === 0) ||
        path.some(
            (part) =>
                typeof part !== "string" ||
                ["__proto__", "constructor", "prototype"].includes(part),
        )
    ) {
        throw new Error("Invalid learning expression path.");
    }
}

function inspectExpression(
    expression: ValueExpression,
    inputs: Set<string>,
    nested = false,
): void {
    if (!expression || typeof expression !== "object") {
        throw new Error("Invalid learning expression.");
    }
    switch (expression.kind) {
        case "literal":
            assertLearningValue(expression.value);
            return;
        case "input":
            if (typeof expression.name !== "string")
                throw new Error("Invalid input reference.");
            inputs.add(expression.name);
            return;
        case "stepResult":
            if (typeof expression.stepId !== "string")
                throw new Error("Invalid result reference.");
            if (expression.path !== undefined)
                assertPath(expression.path, true);
            return;
        case "template": {
            if (
                nested ||
                !Array.isArray(expression.bindings) ||
                expression.bindings.length > 100
            ) {
                throw new Error("Invalid template bindings.");
            }
            const paths: string[][] = [];
            for (const binding of expression.bindings) {
                assertPath(binding.path, false);
                if (
                    paths.some((prior) => {
                        const length = Math.min(
                            prior.length,
                            binding.path.length,
                        );
                        return prior
                            .slice(0, length)
                            .every(
                                (part, index) => part === binding.path[index],
                            );
                    })
                )
                    throw new Error(
                        "Overlapping template bindings are unsupported.",
                    );
                paths.push(binding.path);
                inspectExpression(binding.expression, inputs, true);
            }
            return;
        }
        default:
            throw new Error("Unsupported learning expression kind.");
    }
}

export function assertLearningRequests(
    requests: unknown,
    canonicalRequest?: string,
): asserts requests is string[] {
    if (
        !Array.isArray(requests) ||
        requests.length < 4 ||
        requests.length > 6 ||
        requests.some(
            (request) =>
                typeof request !== "string" ||
                !request.trim() ||
                request.length > 8_000,
        )
    ) {
        throw new Error(
            "Learning requests require the original request and 3-5 bounded variants.",
        );
    }
    const normalized = requests.map((request: string) =>
        request.trim().replace(/\s+/g, " ").toLowerCase(),
    );
    if (
        new Set(normalized).size !== requests.length ||
        (canonicalRequest !== undefined && !requests.includes(canonicalRequest))
    ) {
        throw new Error(
            "Learning requests must include the exact original request and distinct variants.",
        );
    }
}

function assertBuildShape(
    build: MacroLearningBuild,
    trace: RecordedInteractionTrace,
): void {
    if (
        typeof build.name !== "string" ||
        !build.name.trim() ||
        typeof build.description !== "string" ||
        !build.description.trim() ||
        !Array.isArray(build.inputs) ||
        build.inputs.length > 100 ||
        !Array.isArray(build.steps) ||
        build.steps.length !== trace.toolCalls.length ||
        !build.exampleInputs ||
        typeof build.exampleInputs !== "object" ||
        Array.isArray(build.exampleInputs) ||
        (build.unsupportedOutputs !== undefined &&
            (!Array.isArray(build.unsupportedOutputs) ||
                build.unsupportedOutputs.length !== 0))
    ) {
        throw new Error(
            "Unsupported or incomplete generalized macro/output contract.",
        );
    }
    assertLearningRequests(build.requests, trace.prompt);
    assertLearningValue({
        ...build,
        inputs: build.inputs.map(({ secret: _secret, ...input }) => input),
    });
}

function inspectLearningInputs(inputs: MacroInput[]): Set<string> {
    const inputNames = new Set<string>();
    for (const input of inputs) {
        if (
            !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.name) ||
            inputNames.has(input.name) ||
            typeof input.description !== "string" ||
            typeof input.required !== "boolean" ||
            input.secret !== false ||
            !valueTypes.has(input.valueType ?? "")
        ) {
            throw new Error("Invalid or secret learning input.");
        }
        inputNames.add(input.name);
    }
    return inputNames;
}

function assertSourceStep(step: MacroStep, call: RecordedToolCall): void {
    if (
        !/^[a-zA-Z0-9_-]+$/.test(step.id) ||
        step.sourceToolCallId !== call.toolCallId ||
        step.toolName !== call.name ||
        step.mcpServerName !== call.mcpServerName ||
        !["replayable", "agentRequired"].includes(step.executionClass)
    ) {
        throw new Error("Invented, reordered, or changed source tool step.");
    }
}

function assertResultGuards(step: MacroStep, result: unknown): void {
    if (
        !Array.isArray(step.postconditions) ||
        step.postconditions.length === 0 ||
        step.postconditions.length > 51
    ) {
        throw new Error(
            "Learning steps require bounded recorded result guards.",
        );
    }
    if (
        !step.postconditions.some(
            (condition) => condition.kind === "resultType",
        )
    ) {
        throw new Error("Learning steps require a recorded result type guard.");
    }
    for (const condition of step.postconditions) {
        if (condition.kind === "resultType") {
            const type =
                result === null
                    ? "null"
                    : Array.isArray(result)
                      ? "array"
                      : typeof result;
            if (condition.valueType !== type)
                throw new Error("Result type guard contradicts evidence.");
        } else if (condition.kind === "resultPathExists") {
            assertPath(condition.path, false);
            let value = result;
            for (const part of condition.path) {
                if (
                    value === null ||
                    typeof value !== "object" ||
                    !Object.prototype.hasOwnProperty.call(value, part)
                ) {
                    throw new Error("Invented recorded result path.");
                }
                value = (value as Record<string, unknown>)[part];
            }
        } else throw new Error("Unsupported result guard.");
    }
}

export function assertLearningBuild(
    build: MacroLearningBuild,
    macro: CopilotToolMacro,
    trace: RecordedInteractionTrace,
): void {
    assertBuildShape(build, trace);
    assertLearningProcedure(build, macro, trace);
}

export function assertLearningProcedure(
    build: Pick<MacroLearningBuild, "inputs" | "steps" | "exampleInputs">,
    macro: CopilotToolMacro,
    trace: RecordedInteractionTrace,
): void {
    if (
        !Array.isArray(build.inputs) ||
        build.inputs.length > 100 ||
        !Array.isArray(build.steps) ||
        build.steps.length !== trace.toolCalls.length ||
        !build.exampleInputs ||
        typeof build.exampleInputs !== "object" ||
        Array.isArray(build.exampleInputs)
    ) {
        throw new Error("Incomplete evidenced learning procedure.");
    }
    assertLearningValue({
        ...build,
        inputs: build.inputs.map(({ secret: _secret, ...input }) => input),
    });
    const inputNames = inspectLearningInputs(build.inputs);
    const usedInputs = new Set<string>();
    const results = new Map<string, unknown>();
    for (const [index, step] of build.steps.entries()) {
        const call = trace.toolCalls[index];
        assertSourceStep(step, call);
        inspectExpression(step.arguments, usedInputs);
        const resolved = resolveMacroExpression(
            step.arguments,
            build.exampleInputs,
            results,
        );
        if (!learningValuesEqual(resolved, call.arguments)) {
            throw new Error(
                "Example inputs do not reconstruct exact recorded arguments.",
            );
        }
        const result =
            call.modelResult !== undefined ? call.modelResult : call.result;
        assertResultGuards(step, result);
        results.set(step.id, result);
    }
    if (
        inputNames.size !== usedInputs.size ||
        [...inputNames].some((name) => !usedInputs.has(name)) ||
        Object.keys(build.exampleInputs).length !== inputNames.size ||
        Object.keys(build.exampleInputs).some((name) => !inputNames.has(name))
    ) {
        throw new Error("Unused or invented example inputs.");
    }
    validateMacroInputs(macro, build.exampleInputs);
    const report = validateMacro(macro, trace);
    if (!report.valid)
        throw new Error("Generalized macro structural validation failed.");
}

export function assertLearningGrammar(rules: string[]): void {
    assertLearningValue(rules);
    if (
        !Array.isArray(rules) ||
        rules.length === 0 ||
        rules.length > 6 ||
        rules.some(
            (rule) =>
                typeof rule !== "string" ||
                !rule.trim() ||
                rule.length > 32_000,
        )
    ) {
        throw new Error(
            "Grammar generation returned empty or unbounded rules.",
        );
    }
}
