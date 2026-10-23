// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { QuickJSContext } from "@tootallnate/quickjs-emscripten";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

interface WorkerInput {
    source: string;
    deadline: number;
    bounds: {
        memoryLimitBytes: number;
        stackLimitBytes: number;
        maxCalls: number;
        maxJsonBytes: number;
    };
}

const port = parentPort;
let modulePromise:
    | ReturnType<
          typeof import("@tootallnate/quickjs-emscripten").newQuickJSWASMModule
      >
    | undefined;

function getModule() {
    if (modulePromise) return modulePromise;
    const { newQuickJSWASMModule } = createRequire(import.meta.url)(
        (workerData as { quickjsModulePath?: string }).quickjsModulePath ??
            "@tootallnate/quickjs-emscripten",
    ) as typeof import("@tootallnate/quickjs-emscripten");
    return (modulePromise = newQuickJSWASMModule());
}

function evaluate(vm: QuickJSContext, source: string) {
    const evaluated = vm.evalCode(source, "recipe.js");
    if (evaluated.error) {
        evaluated.error.dispose();
        throw new Error("Guest evaluation failed or exceeded resource limits.");
    }
    return evaluated.value;
}

async function executeGuest(data: WorkerInput): Promise<void> {
    const module = await getModule();
    const runtime = module.newRuntime();
    let vm: QuickJSContext | undefined;
    let deliver: ReturnType<typeof evaluate> | undefined;
    let wake: (() => void) | undefined;
    const requests: string[] = [];
    const responses: string[] = [];
    const pending = new Set<number>();
    let calls = 0;
    let protocolError: string | undefined;
    let completion:
        | { status: string; value?: unknown; message?: string }
        | undefined;
    const receive = (text: unknown) => {
        if (
            typeof text !== "string" ||
            Buffer.byteLength(text) > data.bounds.maxJsonBytes
        )
            protocolError = "Invalid broker response.";
        else responses.push(text);
        wake?.();
        wake = undefined;
    };
    port!.on("message", receive);
    let output: string;
    try {
        runtime.setMemoryLimit(data.bounds.memoryLimitBytes);
        runtime.setMaxStackSize(data.bounds.stackLimitBytes);
        runtime.setInterruptHandler(() => Date.now() >= data.deadline);
        const context = runtime.newContext();
        vm = context;
        const install = (name: string, callback: (text: string) => void) => {
            const handle = context.newFunction(name, (argument) => {
                try {
                    if (!argument || context.typeof(argument) !== "string")
                        throw new Error("Invalid guest protocol.");
                    const text = context.getString(argument);
                    if (Buffer.byteLength(text) > data.bounds.maxJsonBytes)
                        throw new Error("Guest JSON limit exceeded.");
                    callback(text);
                    return context.undefined;
                } catch (error) {
                    protocolError =
                        error instanceof Error
                            ? error.message
                            : "Broker failure.";
                    return context.throw(
                        error instanceof Error
                            ? error
                            : new Error("Broker failure."),
                    );
                }
            });
            context.setProp(context.global, name, handle);
            handle.dispose();
        };
        install("__recipeSend", (text) => {
            if (++calls > data.bounds.maxCalls)
                throw new Error("Broker call limit exceeded.");
            requests.push(text);
        });
        install("__recipeFinish", (text) => {
            if (completion) throw new Error("Duplicate guest completion.");
            completion = JSON.parse(text);
        });
        deliver = evaluate(context, data.source);
        while (!completion) {
            if (Date.now() >= data.deadline)
                throw new Error("Guest deadline exceeded.");
            const jobs = runtime.executePendingJobs(100);
            if (jobs.error) {
                jobs.error.dispose();
                throw new Error(
                    "Guest job failed or exceeded resource limits.",
                );
            }
            if (protocolError) throw new Error(protocolError);
            if (completion) break;
            for (const text of requests.splice(0)) {
                const request = JSON.parse(text) as { request: number };
                if (
                    !Number.isSafeInteger(request.request) ||
                    pending.has(request.request)
                )
                    throw new Error("Invalid guest request identity.");
                pending.add(request.request);
                port!.postMessage({ kind: "request", text });
            }
            if (responses.length) {
                for (const text of responses.splice(0)) {
                    const reply = JSON.parse(text) as { request: number };
                    if (!pending.delete(reply.request))
                        throw new Error("Unknown broker response.");
                    const response = context.newString(text);
                    try {
                        context
                            .unwrapResult(
                                context.callFunction(
                                    deliver,
                                    context.undefined,
                                    response,
                                ),
                            )
                            .dispose();
                    } finally {
                        response.dispose();
                    }
                }
                continue;
            }
            if (!runtime.hasPendingJob()) {
                if (!pending.size)
                    throw new Error("Guest promise did not settle.");
                await new Promise<void>((resolve) => {
                    wake = resolve;
                });
            }
        }
        if (requests.length || pending.size)
            throw new Error("Guest left unawaited broker calls.");
        if (
            completion?.status !== "completed" ||
            completion.value === undefined
        )
            throw new Error(completion?.message ?? "Guest failed.");
        output = JSON.stringify(completion.value);
    } finally {
        port!.off("message", receive);
        try {
            deliver?.dispose();
        } finally {
            try {
                vm?.dispose();
            } finally {
                runtime.dispose();
            }
        }
    }
    port!.postMessage({ kind: "result", text: output });
}

if (port) {
    let busy = false;
    port.on("message", (message: unknown) => {
        if (typeof message === "string") return;
        if (
            !message ||
            typeof message !== "object" ||
            !("kind" in message) ||
            message.kind !== "execute" ||
            !("data" in message) ||
            busy
        ) {
            port.postMessage({
                kind: "failure",
                text: "Invalid worker invocation.",
            });
            return;
        }
        busy = true;
        void executeGuest(message.data as WorkerInput)
            .catch((error: unknown) => {
                port.postMessage({
                    kind: "failure",
                    text:
                        error instanceof Error
                            ? error.message
                            : "Unexpected guest failure.",
                });
            })
            .finally(() => {
                busy = false;
            });
    });
}
