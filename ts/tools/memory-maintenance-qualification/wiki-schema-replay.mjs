// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { identity, sha256 } from "./quality-contract.mjs";
import {
    freezeProtocol,
    loadInventory,
    messages,
    responseSchema,
    schedule,
    validateAnswer,
} from "./wiki-schema-contract.mjs";
import { scorecard } from "./wiki-schema-scorecard.mjs";

const writeNew = (file, value) =>
    writeFile(file, JSON.stringify(value, null, 2), { flag: "wx" });

export async function sdkTransport(client) {
    const native = client.createDecisionModel({ provider: "azure" });
    assert.ok(native.success, "Native Decision endpoint is not configured");
    assert.equal(native.data.model, "decision-1", "Expected decision-1");
    const alias = client.openai.GPT_6_LUNA;
    const provider = client.openai.getChatModelSettings(alias).provider;
    assert.ok(
        ["azure", "openai"].includes(provider),
        "Replay requires Azure/OpenAI JSON-schema transport",
    );
    let observed;
    const chat = client.openai.createChatModel(
        alias,
        { n: 1, temperature: 1, response_format: { type: "json_object" } },
        (request, response) => {
            observed = { request, response };
        },
    );
    assert.equal(
        typeof chat.inspectRequest,
        "function",
        "Wire inspection required",
    );
    return {
        binding: {
            native: {
                provider: native.data.provider,
                requestedModel: native.data.model,
            },
            luna: {
                provider,
                alias,
                completionSettings: chat.completionSettings,
            },
            httpAttemptCounts:
                "unavailable; SDK may retry transport internally",
        },
        inspect(packet, arm) {
            const schema = responseSchema(packet, arm);
            const inspection = chat.inspectRequest(messages(packet), schema);
            const body = JSON.parse(inspection.serializedRequest);
            const responses = Array.isArray(body.input);
            if (responses) {
                assert.equal(
                    body.instructions,
                    messages(packet)[0].content,
                    "Wire system content changed",
                );
                assert.deepEqual(
                    body.input,
                    [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "input_text",
                                    text: packet.requestJson,
                                },
                            ],
                        },
                    ],
                    "Wire caller content changed",
                );
                const { type, ...actualSchema } = body.text?.format ?? {};
                assert.equal(
                    type,
                    "json_schema",
                    "Strict JSON schema was not sent",
                );
                assert.deepEqual(actualSchema, schema, "Wire schema changed");
            } else {
                assert.deepEqual(
                    body.messages,
                    messages(packet),
                    "Wire caller content changed",
                );
                assert.equal(
                    body.response_format?.type,
                    "json_schema",
                    "Strict JSON schema was not sent",
                );
                assert.deepEqual(
                    body.response_format.json_schema,
                    schema,
                    "Wire schema changed",
                );
            }
            const wireOutputLimit =
                body.max_completion_tokens ??
                body.max_output_tokens ??
                body.max_tokens ??
                null;
            const outputLimit =
                wireOutputLimit ?? inspection.constraints?.outputTokens;
            assert.ok(
                Number.isSafeInteger(outputLimit) && outputLimit > 0,
                "Configure a common request-constraint outputTokens allowance before replay",
            );
            return {
                body,
                estimatedInputTokens: inspection.estimatedInputTokens,
                outputLimit,
                wireOutputLimit,
                outputLimitKind:
                    wireOutputLimit === null
                        ? "admission-allowance-not-wire-cap"
                        : "wire-cap",
                wireApi: responses ? "responses" : "chat_completions",
            };
        },
        async invoke(packet, arm, signal, inspection) {
            observed = undefined;
            if (arm === "native") {
                const result = await native.data.decide(
                    JSON.parse(packet.requestJson),
                    {
                        signal,
                        timeoutMs: 60_000,
                    },
                );
                return result.success
                    ? {
                          payload: { answers: result.data.answers },
                          nativeReceipt: result.data,
                      }
                    : { failure: result, terminal: true };
            }
            let usage;
            const result = await chat.complete(
                messages(packet),
                (value) => {
                    usage = value;
                },
                responseSchema(packet, arm),
                undefined,
                signal,
            );
            if (!result.success)
                return { failure: result, terminal: true, observed };
            if (
                !observed ||
                identity(observed.request) !== identity(inspection.body)
            )
                return {
                    failure: {
                        code: "wire_mismatch",
                        message:
                            "Successful chat wire is missing or differs from inspected request",
                    },
                    terminal: true,
                    observed,
                    rawText: result.data,
                };
            return {
                rawText: result.data,
                observed,
                usage,
                reportedModel: observed.response.model,
            };
        },
    };
}

function assertWireParity(full, choice) {
    assert.equal(
        full.outputLimit,
        choice.outputLimit,
        "Output caps differ between schemas",
    );
    const common = (inspection) => {
        const { response_format: _schema, ...body } = inspection.body;
        if (body.text?.format) {
            const { format: _format, ...remaining } = body.text;
            body.text = remaining;
        }
        return body;
    };
    assert.deepEqual(
        common(full),
        common(choice),
        "Schema ablation changed other wire settings",
    );
}

export async function prepareReplay(options, normalize) {
    const inventory = await loadInventory(
        options.inventory,
        options.inventoryHash,
        normalize,
    );
    const protocol = freezeProtocol(
        inventory,
        options.inventoryHash,
        options.seed,
    );
    await mkdir(options.output);
    const filename = path.join(options.output, "protocol.json");
    await writeNew(filename, protocol);
    return {
        state: "prepared",
        protocol: filename,
        protocolHash: sha256(await readFile(filename)),
        inventoryHash: options.inventoryHash,
        plannedCalls: schedule(protocol).length,
        confirmationKind: protocol.confirmationKind,
    };
}

async function frozenInputs(options, normalize) {
    const inventory = await loadInventory(
        options.inventory,
        options.inventoryHash,
        normalize,
    );
    const bytes = await readFile(options.protocol);
    assert.equal(
        sha256(bytes),
        options.protocolHash,
        "Protocol byte hash mismatch",
    );
    const protocol = JSON.parse(bytes);
    assert.deepEqual(
        protocol,
        freezeProtocol(inventory, options.inventoryHash, protocol.seed),
        "Protocol changed after selection",
    );
    return { inventory, protocol };
}

function limits(options, protocol, now) {
    assert.equal(
        options.live,
        true,
        "Execution requires explicit --live approval",
    );
    const deadline = Date.parse(options.deadline);
    assert.ok(
        Number.isFinite(deadline) && deadline > now,
        "A future absolute deadline is required",
    );
    assert.ok(
        deadline - now <= protocol.maxDurationMs,
        "Deadline exceeds approved 90-minute window",
    );
    assert.ok(
        Number.isSafeInteger(options.maxCalls) &&
            options.maxCalls > 0 &&
            options.maxCalls <= protocol.maxCalls,
        "Call cap must be between 1 and 360",
    );
    return deadline;
}

function phasePass(rows, expected) {
    return (
        rows.length === expected && rows.every((row) => row.status === "valid")
    );
}

async function executeCall(
    entry,
    packet,
    transport,
    inspection,
    normalize,
    signal,
) {
    const started = performance.now();
    let result;
    try {
        result = await transport.invoke(packet, entry.arm, signal, inspection);
    } catch (error) {
        return {
            ...entry,
            status: "transport-or-wire-failure",
            terminal: true,
            error: { name: error.name, message: error.message },
            durationMs: performance.now() - started,
        };
    }
    const row = { ...entry, result, durationMs: performance.now() - started };
    if (result.failure)
        return {
            ...row,
            status: "provider-failure",
            terminal: result.terminal !== false,
        };
    const validation = {
        jsonValid: false,
        schemaValid: false,
        nativeContractValid: entry.arm === "luna-choice" ? null : false,
    };
    try {
        const payload =
            result.rawText === undefined
                ? result.payload
                : JSON.parse(result.rawText);
        validation.jsonValid = true;
        const choices = validateAnswer(
            packet,
            entry.arm,
            payload,
            (...args) => {
                validation.schemaValid = true;
                const answers = normalize(...args);
                validation.nativeContractValid = true;
                return answers;
            },
        );
        validation.schemaValid = true;
        return {
            ...row,
            status: "valid",
            payload,
            choices,
            validation,
            durationMs: performance.now() - started,
        };
    } catch (error) {
        return {
            ...row,
            status: "invalid-output",
            validation,
            failureStage: !validation.jsonValid
                ? "json"
                : !validation.schemaValid
                  ? "schema"
                  : "native-contract",
            error: { name: error.name, message: error.message },
            durationMs: performance.now() - started,
        };
    }
}

export async function runReplay(options, dependencies) {
    const { normalize, createTransport } = dependencies;
    const { inventory, protocol } = await frozenInputs(options, normalize);
    const deadline = limits(options, protocol, Date.now());
    const plan = schedule(protocol);
    const packets = new Map(
        inventory.packets.map((packet) => [packet.id, packet]),
    );
    await mkdir(options.output);
    // A frozen protocol can authorize only one execution, including interrupted runs.
    await writeNew(`${options.protocol}.execution.json`, {
        startedAt: new Date().toISOString(),
        deadline: options.deadline,
        maxCalls: options.maxCalls,
        output: path.resolve(options.output),
    });
    await writeNew(path.join(options.output, "frozen-inputs.json"), {
        inventory,
        protocol,
        plan,
    });
    const implementation = {};
    for (const name of [
        "wiki-schema-contract.mjs",
        "wiki-schema-scorecard.mjs",
        "wiki-schema-replay.mjs",
    ])
        implementation[name] = sha256(
            await readFile(new URL(name, import.meta.url)),
        );
    await writeNew(
        path.join(options.output, "implementation.json"),
        implementation,
    );
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error("Replay deadline exceeded")),
        Math.max(1, deadline - Date.now()),
    );
    const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
    const rows = [];
    let stopReason = null;
    try {
        const transport = await createTransport();
        await writeNew(
            path.join(options.output, "binding.json"),
            transport.binding,
        );
        const inspections = new Map();
        for (const id of [...protocol.pilot, ...protocol.confirmation]) {
            signal.throwIfAborted();
            const packet = packets.get(id);
            const full = transport.inspect(packet, "luna-full");
            const choice = transport.inspect(packet, "luna-choice");
            assertWireParity(full, choice);
            inspections.set(id, { "luna-full": full, "luna-choice": choice });
        }
        await writeNew(
            path.join(options.output, "wire-preflight.json"),
            Object.fromEntries(inspections),
        );
        for (const [ordinal, entry] of plan.entries()) {
            if (signal.aborted || Date.now() >= deadline) {
                stopReason = "deadline-or-cancellation";
                break;
            }
            if (rows.length >= options.maxCalls) {
                stopReason = "logical-call-cap";
                break;
            }
            if (
                entry.phase !== "preflight" &&
                !phasePass(
                    rows.filter((row) => row.phase === "preflight"),
                    3,
                )
            ) {
                stopReason = "preflight-failed";
                break;
            }
            const packet = packets.get(entry.id);
            const request =
                entry.arm === "native"
                    ? { requestJson: packet.requestJson }
                    : {
                          messages: messages(packet),
                          schema: responseSchema(packet, entry.arm),
                          inspection: inspections.get(entry.id)[entry.arm],
                      };
            const prefix = String(ordinal).padStart(4, "0");
            await writeNew(
                path.join(options.output, `${prefix}-request.json`),
                {
                    ...entry,
                    requestHash: packet.requestHash,
                    request,
                    requestIdentity: identity(request),
                    reservedAt: new Date().toISOString(),
                },
            );
            if (Date.now() >= deadline || signal.aborted) {
                stopReason = "deadline-before-dispatch";
                break;
            }
            const row = await executeCall(
                entry,
                packet,
                transport,
                inspections.get(entry.id)?.[entry.arm],
                normalize,
                signal,
            );
            rows.push(row);
            await writeNew(
                path.join(options.output, `${prefix}-result.json`),
                row,
            );
            if (row.terminal) {
                stopReason = row.status;
                break;
            }
        }
    } catch (error) {
        stopReason = "setup-or-persistence-failure";
        await writeNew(path.join(options.output, "failure.json"), {
            name: error.name,
            message: error.message,
        });
        throw error;
    } finally {
        clearTimeout(timer);
        const report = {
            ...scorecard(inventory, protocol, rows),
            stopReason,
            logicalCalls: rows.length,
            deadline: options.deadline,
            finishedAt: new Date().toISOString(),
        };
        await writeNew(path.join(options.output, "scorecard.json"), report);
    }
    return JSON.parse(
        await readFile(path.join(options.output, "scorecard.json"), "utf8"),
    );
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            mode: { type: "string" },
            inventory: { type: "string" },
            "inventory-hash": { type: "string" },
            protocol: { type: "string" },
            "protocol-hash": { type: "string" },
            output: { type: "string" },
            seed: { type: "string" },
            live: { type: "boolean" },
            deadline: { type: "string" },
            "max-calls": { type: "string" },
        },
    });
    assert.ok(
        ["prepare", "run"].includes(values.mode),
        "Choose --mode prepare or run",
    );
    assert.ok(
        values.inventory && values["inventory-hash"] && values.output,
        "Inventory, inventory hash and new private output directory required",
    );
    const client = await import("../../packages/aiclient/dist/index.js");
    const options = {
        ...values,
        inventoryHash: values["inventory-hash"],
        protocolHash: values["protocol-hash"],
        maxCalls: Number(values["max-calls"]),
    };
    if (values.mode === "prepare") {
        assert.ok(!values.live, "Prepare never authorizes inference");
        return prepareReplay(options, client.normalizeDecisionAnswers);
    }
    return runReplay(options, {
        normalize: client.normalizeDecisionAnswers,
        createTransport: async () => {
            const config = await import("../../packages/config/dist/index.js");
            config.loadConfigSync();
            client.initRuntimeConfigFromProcessEnv();
            return sdkTransport(client);
        },
    });
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    main().then(
        (result) => {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            if (result.state === "incomplete") process.exitCode = 2;
        },
        (error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        },
    );
