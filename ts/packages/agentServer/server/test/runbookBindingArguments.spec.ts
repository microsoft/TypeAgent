// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { validateRunbookBindingArguments } from "../src/runbookBindingArguments.js";
import { createRunbookBindingCatalog } from "../src/runbookBindingCatalog.js";
import { createRunbookBindingValidator } from "../src/runbookBindingValidator.js";
import {
    validateMacroInputs,
    type CopilotToolMacro,
} from "@typeagent/copilot-macros";
import type { RunbookBindingReadiness } from "@typeagent/agent-server-protocol";
import {
    validateRunbookBinding,
    runbookArgumentLimits,
} from "@typeagent/memory-service/agent-edition-validation";

const schema = {
    type: "object",
    properties: {
        target: { type: "string", minLength: 3 },
        count: { type: "integer", minimum: 1 },
    },
    required: ["target", "count"],
    additionalProperties: false,
};

describe("non-executing catalog argument validation", () => {
    test("rejects array subclasses without executing custom mapping code", () => {
        let calls = 0;
        class CustomArray extends Array<unknown> {
            public map<U>(
                _callback: (
                    value: unknown,
                    index: number,
                    array: unknown[],
                ) => U,
            ): U[] {
                calls++;
                return [];
            }
        }
        const values = new CustomArray();
        values.push("literal");
        expect(
            validateRunbookBindingArguments({ type: "object" }, { values })
                .valid,
        ).toBe(false);
        expect(calls).toBe(0);
    });
    test("literal escapes validate actual JSON without interpreting or replacing nested marker objects", () => {
        const literalSchema = {
            type: "object",
            properties: {
                body: {
                    type: "object",
                    properties: {
                        $input: { type: "string" },
                        $literal: { type: "number" },
                    },
                    required: ["$input", "$literal"],
                    additionalProperties: false,
                },
            },
            required: ["body"],
            additionalProperties: false,
        };
        const args = {
            body: { $literal: { $input: "not-a-reference", $literal: 3 } },
        };
        const original = structuredClone(args);
        expect(validateRunbookBindingArguments(literalSchema, args)).toEqual({
            valid: true,
        });
        expect(args).toEqual(original);
        expect(
            validateRunbookBindingArguments(literalSchema, {
                body: { $literal: { $input: 3, $literal: 3 } },
            }).valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(
                {
                    type: "object",
                    properties: { $input: { type: "string" } },
                    required: ["$input"],
                },
                { $input: "literal-root-parameter-name" },
            ).valid,
        ).toBe(true);
    });

    test("does not use defaults or examples as fake values for symbolic schema proof", () => {
        const target = {
            type: "object",
            properties: {
                count: { type: "number", minimum: 0 },
            },
            required: ["count"],
        };
        const inputSchema = {
            properties: {
                count: { type: "number", default: 1, examples: [1] },
            },
            required: ["count"],
        };
        expect(
            validateRunbookBindingArguments(
                target,
                { count: { $input: "count" } },
                inputSchema,
            ),
        ).toMatchObject({ valid: false, code: "unavailable" });
        expect(
            validateRunbookBindingArguments(
                target,
                { count: { $input: "count" } },
                {
                    ...inputSchema,
                    properties: { count: { type: "number", enum: [0, 1] } },
                },
            ),
        ).toEqual({ valid: true });
    });

    test("static container proof checks required siblings, additional properties and array size", () => {
        const target = {
            type: "object",
            properties: {
                names: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 2,
                },
                count: { type: "integer", minimum: 1 },
            },
            required: ["names", "count"],
            additionalProperties: false,
        };
        const inputs = {
            properties: { name: { type: "string" } },
            required: ["name"],
        };
        const names = [{ $input: "name" }, "literal"];
        expect(
            validateRunbookBindingArguments(target, { names, count: 1 }, inputs)
                .valid,
        ).toBe(true);
        expect(
            validateRunbookBindingArguments(target, { names }, inputs).valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(target, { names, count: 0 }, inputs)
                .valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(
                target,
                { names, count: 1, extra: true },
                inputs,
            ).valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(
                target,
                { names: names.slice(0, 1), count: 1 },
                inputs,
            ).valid,
        ).toBe(false);
    });

    test("uses exact shared string, encoded byte, node and depth boundaries", () => {
        const generic = { type: "object" };
        const limit = runbookArgumentLimits.maxStringLength;
        expect(
            validateRunbookBindingArguments(generic, {
                text: "x".repeat(limit),
            }).valid,
        ).toBe(true);
        expect(
            validateRunbookBindingArguments(generic, {
                text: "x".repeat(limit + 1),
            }).valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(generic, {
                a: "x".repeat(limit),
                b: "x".repeat(limit),
            }).valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(generic, {
                values: Array(runbookArgumentLimits.maxNodes - 2).fill(true),
            }).valid,
        ).toBe(true);
        expect(
            validateRunbookBindingArguments(generic, {
                values: Array(runbookArgumentLimits.maxNodes - 1).fill(true),
            }).valid,
        ).toBe(false);
        let nested: unknown = 0;
        for (let index = 1; index < runbookArgumentLimits.maxDepth; index++)
            nested = { nested };
        expect(validateRunbookBindingArguments(generic, { nested }).valid).toBe(
            true,
        );
        expect(
            validateRunbookBindingArguments(generic, { nested: { nested } })
                .valid,
        ).toBe(false);
    });

    test("identity-only readiness and altered or duplicate argument proofs cannot bless arguments", async () => {
        const binding = {
            kind: "macro" as const,
            accepted: true,
            targetId: "approved",
            version: 1,
            fingerprint: "f",
            arguments: { count: 1 },
        };
        for (const mode of ["absent", "altered", "duplicate"]) {
            const validate = createRunbookBindingValidator({
                checkBindingTargets: async ({ bindings }) => {
                    const proof = {
                        binding: bindings[0],
                        bindingIndex: 0,
                        argumentsValidated: true as const,
                    };
                    return {
                        valid: true,
                        issues: [],
                        ...(mode === "absent"
                            ? {}
                            : {
                                  argumentChecks:
                                      mode === "duplicate"
                                          ? [proof, proof]
                                          : [
                                                {
                                                    ...proof,
                                                    binding: {
                                                        ...proof.binding,
                                                        arguments: { count: 2 },
                                                    },
                                                },
                                            ],
                              }),
                    };
                },
            });
            const [result] = await validate([binding], { inputs: [] });
            expect(result.status).toBe("unavailable");
            expect(result.argumentsValidated).not.toBe(true);
            expect(result.binding).toBe(binding);
        }
    });

    test.each(["recover", "_recover", '["server","recover"]', "[invalid"])(
        "preserves exact native MCP catalog identity %s without aliases or tuple inference",
        async (toolName) => {
            const nativeId = JSON.stringify(["server", toolName]);
            const catalog = createRunbookBindingCatalog(
                {
                    getApprovedMacros: async () => [],
                    listMacros: async () => [],
                },
                async () => [
                    {
                        serverConfigId: "server",
                        name: "actual",
                        trust: "trusted",
                        enabled: true,
                        available: true,
                        entries: [
                            {
                                id: nativeId,
                                serverConfigId: "server",
                                name: toolName,
                                fingerprint: "f",
                                inputSchema: { type: "object", properties: {} },
                            },
                        ],
                    },
                ],
            );
            const binding = {
                kind: "mcp" as const,
                accepted: true,
                serverId: "server",
                targetId: toolName,
                version: "f",
                fingerprint: "f",
            };
            expect(() => validateRunbookBinding(binding)).not.toThrow();
            const validate = createRunbookBindingValidator(catalog);
            const [result] = await validate([binding]);
            expect(result.status).toBe("accepted");
            expect(result.binding).toBe(binding);
            const target = (await catalog.listBindingTargets()).targets[0];
            expect(target.id).toBe(nativeId);
            expect(
                await validate([{ ...binding, serverId: "different" }]),
            ).toMatchObject([{ status: "unavailable" }]);
        },
    );

    test.each([
        '[ "server","recover"]',
        '["different","recover"]',
        '["server",1]',
        '["server","recover","extra"]',
        "[invalid",
    ])(
        "rejects proof that echoes a raw native name %s instead of the reconstructed public tuple",
        async (id) => {
            const binding = {
                kind: "mcp" as const,
                accepted: true,
                serverId: "server",
                targetId: id,
                version: "f",
                fingerprint: "f",
                arguments: { count: 1 },
            };
            const validate = createRunbookBindingValidator({
                checkBindingTargets: async ({ bindings }) => ({
                    valid: true,
                    issues: [],
                    argumentChecks: [
                        {
                            binding: { ...bindings[0], id },
                            bindingIndex: 0,
                            argumentsValidated: true,
                        },
                    ],
                }),
            });
            const [result] = await validate([binding], { inputs: [] });
            expect(result.status).not.toBe("accepted");
            expect(result.argumentsValidated).not.toBe(true);
            expect(result.binding).toBe(binding);
        },
    );

    test("excludes native identities the canonical schema cannot represent instead of inventing IDs", async () => {
        const unsupportedName = "x".repeat(4097);
        const catalog = createRunbookBindingCatalog(
            {
                getApprovedMacros: async () => [],
                listMacros: async () => [],
            },
            async () => [
                {
                    serverConfigId: "server",
                    name: "actual",
                    trust: "trusted",
                    enabled: true,
                    available: true,
                    entries: [
                        {
                            id: JSON.stringify(["server", unsupportedName]),
                            serverConfigId: "server",
                            name: unsupportedName,
                            fingerprint: "f",
                            inputSchema: { type: "object", properties: {} },
                        },
                    ],
                },
            ],
        );
        const result = await catalog.listBindingTargets();
        expect(result.targets).toEqual([]);
        expect(
            result.notices.some((notice) =>
                notice.includes("canonical binding schema"),
            ),
        ).toBe(true);
    });

    test("reports configured permission denial as unavailable even without schema drift", async () => {
        let denied = false;
        const catalog = createRunbookBindingCatalog(
            {
                getApprovedMacros: async () => [],
                listMacros: async () => [],
            },
            async () => [
                {
                    serverConfigId: "server",
                    name: "actual",
                    trust: "trusted",
                    enabled: true,
                    available: true,
                    entries: [
                        {
                            id: '["server","recover"]',
                            serverConfigId: "server",
                            name: "recover",
                            fingerprint: "same-schema",
                            inputSchema: { type: "object", properties: {} },
                            permission: {
                                configuredDecision: denied ? "deny" : "allow",
                                promptWithoutSessionGrant: false,
                            },
                        },
                    ],
                },
            ],
        );
        const target = (await catalog.listBindingTargets()).targets[0];
        expect(target.permission.configuredDecision).toBe("allow");
        denied = true;
        const current = await catalog.listBindingTargets();
        expect(current.targets).toEqual([]);
        expect(
            current.notices.some((notice) =>
                notice.includes("configured permission denies"),
            ),
        ).toBe(true);
        expect(
            await catalog.checkBindingTargets({ bindings: [target] }),
        ).toMatchObject({
            valid: false,
            issues: [{ code: "unavailable" }],
        });
    });

    test("rejects every group member when readiness lacks unambiguous per-target results", async () => {
        const bindings = [
            {
                kind: "macro" as const,
                accepted: true,
                targetId: "first",
                version: 1,
                fingerprint: "f",
            },
            {
                kind: "macro" as const,
                accepted: true,
                targetId: "second",
                version: 1,
                fingerprint: "f",
            },
        ];
        const failures: RunbookBindingReadiness[] = [
            { valid: false, issues: [] },
            {
                valid: false,
                issues: [
                    {
                        binding: {
                            kind: "macro",
                            id: "unknown",
                            version: "1",
                            fingerprint: "f",
                        },
                        message: "Unmapped",
                    },
                ],
            },
            {
                valid: false,
                issues: [
                    {
                        binding: {
                            kind: "macro",
                            id: "first",
                            version: "1",
                            fingerprint: "f",
                        },
                        bindingIndex: 99,
                        message: "Invalid index",
                    },
                ],
            },
            {
                valid: true,
                issues: [
                    {
                        binding: {
                            kind: "macro",
                            id: "first",
                            version: "1",
                            fingerprint: "f",
                        },
                        message: "Contradictory",
                    },
                ],
            },
        ];
        for (const failure of failures) {
            const validate = createRunbookBindingValidator({
                checkBindingTargets: async () => failure,
            });
            const results = await validate(bindings);
            expect(results.map((result) => result.status)).toEqual([
                "rejected",
                "rejected",
            ]);
            expect(results.map((result) => result.binding)).toEqual(bindings);
        }
    });

    test("verifies actual catalog server metadata in addition to the compound tool identity", async () => {
        const catalog = createRunbookBindingCatalog(
            {
                getApprovedMacros: async () => [],
                listMacros: async () => [],
            },
            async () => [
                {
                    serverConfigId: "server",
                    name: "actual",
                    trust: "trusted",
                    enabled: true,
                    available: true,
                    entries: [
                        {
                            id: '["server","recover"]',
                            serverConfigId: "different",
                            name: "recover",
                            fingerprint: "f",
                            inputSchema: { type: "object", properties: {} },
                        },
                    ],
                },
            ],
        );
        const validate = createRunbookBindingValidator(catalog);
        expect(
            await validate([
                {
                    kind: "mcp",
                    accepted: true,
                    serverId: "server",
                    targetId: "recover",
                    version: "f",
                    fingerprint: "f",
                },
            ]),
        ).toMatchObject([
            {
                status: "unavailable",
                reason: expect.stringContaining("actual current catalog"),
            },
        ]);
    });

    test("uses actual approved macro input declarations and step-required references", async () => {
        const macro: CopilotToolMacro = {
            schemaVersion: 1,
            macroId: "approved",
            version: 3,
            name: "Recovery",
            description: "Recovery",
            state: "approved",
            executionClass: "replayable",
            inputs: [
                {
                    name: "count",
                    description: "Count",
                    required: false,
                    secret: false,
                    valueType: "number",
                },
            ],
            steps: [
                {
                    id: "s",
                    toolName: "recover",
                    arguments: { kind: "input", name: "count" },
                    executionClass: "replayable",
                    sourceToolCallId: "call",
                },
            ],
            sourceTraceId: "trace",
            createdAt: "2026-10-02",
            warnings: [],
        };
        const catalog = createRunbookBindingCatalog({
            getApprovedMacros: async () => [macro],
            listMacros: async () => [
                {
                    macroId: macro.macroId,
                    version: macro.version,
                    name: macro.name,
                    description: macro.description,
                    state: macro.state,
                    executionClass: macro.executionClass,
                    stepCount: 1,
                    updatedAt: macro.createdAt,
                },
            ],
        });
        const target = (await catalog.listBindingTargets()).targets[0];
        expect(target.inputSchema.required).toEqual(["count"]);
        expect(() => validateMacroInputs(macro, {})).toThrow("missing");
        expect(
            (await catalog.checkBindingTargets({ bindings: [target] })).valid,
        ).toBe(false);
        expect(() => validateMacroInputs(macro, { count: 3 })).not.toThrow();
        expect(
            (
                await catalog.checkBindingTargets({
                    bindings: [{ ...target, arguments: { count: 3 } }],
                })
            ).valid,
        ).toBe(true);
        expect(
            (
                await catalog.checkBindingTargets({
                    bindings: [{ ...target, arguments: { count: "3" } }],
                })
            ).valid,
        ).toBe(false);
    });

    test("validates concrete arguments against the real JSON Schema constraints", () => {
        expect(
            validateRunbookBindingArguments(schema, {
                target: "service",
                count: 2,
            }).valid,
        ).toBe(true);
        expect(
            validateRunbookBindingArguments(schema, { target: "x", count: 0 })
                .valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(schema, {
                target: "service",
                count: 1,
                extra: true,
            }).valid,
        ).toBe(false);
        expect(validateRunbookBindingArguments(schema, undefined).valid).toBe(
            false,
        );
    });

    test("proves bounded enums against all target constraints without evaluating symbolic templates", () => {
        const arguments_ = {
            target: { $input: "service" },
            count: { $input: "retries" },
        };
        const inputs = {
            type: "object",
            properties: {
                service: { type: "string", enum: ["service-a", "service-b"] },
                retries: { type: "integer", enum: [1, 2] },
            },
            required: ["service", "retries"],
        };
        expect(
            validateRunbookBindingArguments(schema, arguments_, inputs),
        ).toEqual({ valid: true });
        expect(arguments_).toEqual({
            target: { $input: "service" },
            count: { $input: "retries" },
        });
        expect(
            validateRunbookBindingArguments(schema, arguments_, {
                ...inputs,
                properties: {
                    ...inputs.properties,
                    retries: { type: "integer", enum: [0, 1] },
                },
            }).valid,
        ).toBe(false);
    });

    test("supports nested object/array references only when declared primitive types prove schema fit", () => {
        const nested = {
            type: "object",
            properties: {
                body: {
                    type: "object",
                    properties: {
                        names: { type: "array", items: { type: "string" } },
                    },
                    required: ["names"],
                    additionalProperties: false,
                },
            },
            required: ["body"],
            additionalProperties: false,
        };
        const arguments_ = { body: { names: [{ $input: "name" }] } };
        const inputs = {
            properties: { name: { type: "string" } },
            required: ["name"],
        };
        expect(
            validateRunbookBindingArguments(nested, arguments_, inputs).valid,
        ).toBe(true);
        expect(
            validateRunbookBindingArguments(nested, arguments_, {
                properties: { name: { type: "number" } },
                required: ["name"],
            }).valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(
                { ...nested, const: { body: { names: [""] } } },
                arguments_,
                inputs,
            ).valid,
        ).toBe(false);
    });

    test.each([
        {
            arguments_: { target: { $input: "missing" }, count: 1 },
            inputs: { properties: {}, required: [] },
        },
        {
            arguments_: { target: { $input: "name" }, count: 1 },
            inputs: {
                properties: { name: { type: "string" } },
                required: ["name"],
            },
        },
        {
            arguments_: { target: { $input: "name", extra: true }, count: 1 },
            inputs: {
                properties: { name: { type: "string" } },
                required: ["name"],
            },
        },
        {
            arguments_: { target: { $input: "name" }, count: 1 },
            inputs: {
                properties: { name: { type: "string", writeOnly: true } },
                required: ["name"],
            },
        },
        {
            arguments_: { target: { $input: "name" }, count: 1 },
            inputs: {
                properties: { name: { type: "string", enum: ["service"] } },
                required: [],
            },
        },
    ])(
        "rejects unknown, unprovable, malformed, secret and optional references",
        ({ arguments_, inputs }) => {
            expect(
                validateRunbookBindingArguments(schema, arguments_, inputs)
                    .valid,
            ).toBe(false);
        },
    );

    test("bounds JSON and rejects unsupported symbolic conditional schemas explicitly", () => {
        expect(
            validateRunbookBindingArguments(schema, {
                target: "x".repeat(65_537),
                count: 1,
            }).valid,
        ).toBe(false);
        expect(
            validateRunbookBindingArguments(schema, {
                target: () => "not called",
                count: 1,
            }).valid,
        ).toBe(false);
        const inputSchema = {
            properties: { name: { type: "string", enum: ["service"] } },
            required: ["name"],
        };
        expect(
            validateRunbookBindingArguments(
                { ...schema, anyOf: [{ required: ["target"] }] },
                { target: { $input: "name" }, count: 1 },
                inputSchema,
            ),
        ).toMatchObject({
            valid: false,
            reason: expect.stringContaining(
                "does not support provable symbolic",
            ),
        });
    });

    test("does not invoke argument getters or proxy traps during local-host validation", () => {
        let calls = 0;
        const arguments_ = { count: 1 };
        Object.defineProperty(arguments_, "target", {
            enumerable: true,
            get() {
                calls++;
                return "service";
            },
        });
        expect(validateRunbookBindingArguments(schema, arguments_).valid).toBe(
            false,
        );
        const proxy = new Proxy(
            { target: "service", count: 1 },
            {
                ownKeys() {
                    calls++;
                    return ["target", "count"];
                },
            },
        );
        expect(validateRunbookBindingArguments(schema, proxy).valid).toBe(
            false,
        );
        expect(calls).toBe(0);
    });

    test("host readiness and callback retain concrete arguments and reject invalid schemas, not silently dropping them", async () => {
        const catalog = createRunbookBindingCatalog(
            {
                getApprovedMacros: async () => [],
                listMacros: async () => [],
            },
            async () => [
                {
                    serverConfigId: "server",
                    name: "actual",
                    trust: "trusted",
                    enabled: true,
                    available: true,
                    entries: [
                        {
                            id: '["server","recover"]',
                            serverConfigId: "server",
                            name: "recover",
                            inputSchema: { ...schema, type: "object" },
                            fingerprint: "current-schema",
                        },
                    ],
                },
            ],
        );
        const binding = {
            kind: "mcp" as const,
            id: '["server","recover"]',
            version: "current-schema",
            fingerprint: "current-schema",
        };
        const arguments_ = { target: "service", count: 2 };
        expect(
            (
                await catalog.checkBindingTargets({
                    bindings: [{ ...binding, arguments: arguments_ }],
                })
            ).valid,
        ).toBe(true);
        const invalid = { ...binding, arguments: { target: "x", count: 0 } };
        expect(
            await catalog.checkBindingTargets({ bindings: [invalid] }),
        ).toMatchObject({
            valid: false,
            issues: [{ binding: invalid, code: "invalidArguments" }],
        });
        const validate = createRunbookBindingValidator(catalog);
        expect(
            await validate([
                {
                    kind: "mcp",
                    accepted: true,
                    serverId: "server",
                    targetId: "recover",
                    version: binding.version,
                    fingerprint: binding.fingerprint,
                    ...{ arguments: arguments_ },
                },
            ]),
        ).toMatchObject([{ status: "accepted" }]);
        expect(
            await validate([
                {
                    kind: "mcp",
                    accepted: true,
                    serverId: "server",
                    targetId: "recover",
                    version: binding.version,
                    fingerprint: binding.fingerprint,
                    ...{ arguments: invalid.arguments },
                },
            ]),
        ).toMatchObject([{ status: "rejected" }]);
        const canonical = {
            kind: "mcp" as const,
            accepted: true,
            serverId: "server",
            targetId: "recover",
            version: binding.version,
            fingerprint: binding.fingerprint,
        };
        expect(
            await validate([
                { ...canonical, ...{ arguments: arguments_ } },
                { ...canonical, ...{ arguments: invalid.arguments } },
            ]),
        ).toMatchObject([{ status: "accepted" }, { status: "rejected" }]);
        const symbolic = {
            ...canonical,
            ...{ arguments: { target: { $input: "service" }, count: 1 } },
        };
        const input = {
            id: "service",
            description: "Service",
            type: "enum" as const,
            enumValues: ["service-a", "service-b"],
            required: true,
            secret: false,
        };
        expect(await validate([symbolic], { inputs: [input] })).toMatchObject([
            { status: "accepted", argumentsValidated: true, binding: symbolic },
        ]);
        expect(
            await validate([symbolic], {
                inputs: [{ ...input, secret: true }],
            }),
        ).toMatchObject([{ status: "unavailable" }]);
        expect(await validate([symbolic])).toMatchObject([
            { status: "unavailable" },
        ]);
    });
});
