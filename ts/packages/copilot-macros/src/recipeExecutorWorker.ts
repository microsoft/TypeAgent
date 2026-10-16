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

function evaluate(vm: QuickJSContext, source: string) {
    const evaluated = vm.evalCode(source, "recipe.js");
    if (evaluated.error) {
        evaluated.error.dispose();
        throw new Error("Guest evaluation failed or exceeded resource limits.");
    }
    return evaluated.value;
}

async function executeGuest(data: WorkerInput): Promise<void> {
    const port = parentPort!;
    const { newQuickJSWASMModule } = createRequire(import.meta.url)(
        "@tootallnate/quickjs-emscripten",
    ) as typeof import("@tootallnate/quickjs-emscripten");
    const module = await newQuickJSWASMModule();
    const runtime = module.newRuntime();
    runtime.setMemoryLimit(data.bounds.memoryLimitBytes);
    runtime.setMaxStackSize(data.bounds.stackLimitBytes);
    runtime.setInterruptHandler(() => Date.now() >= data.deadline);
    const vm = runtime.newContext();
    const requests: string[] = [];
    let calls = 0;
    let protocolError: string | undefined;
    let completion:
        | { status: string; value?: unknown; message?: string }
        | undefined;
    const install = (name: string, callback: (text: string) => void) => {
        const handle = vm.newFunction(name, (argument) => {
            try {
                if (!argument || vm.typeof(argument) !== "string")
                    throw new Error("Invalid guest protocol.");
                const text = vm.getString(argument);
                if (Buffer.byteLength(text) > data.bounds.maxJsonBytes)
                    throw new Error("Guest JSON limit exceeded.");
                callback(text);
                return vm.undefined;
            } catch (error) {
                protocolError =
                    error instanceof Error ? error.message : "Broker failure.";
                return vm.throw(
                    error instanceof Error
                        ? error
                        : new Error("Broker failure."),
                );
            }
        });
        vm.setProp(vm.global, name, handle);
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
    const deliver = evaluate(vm, data.source);
    while (!completion) {
        if (Date.now() >= data.deadline)
            throw new Error("Guest deadline exceeded.");
        const jobs = runtime.executePendingJobs(100);
        if (jobs.error) {
            jobs.error.dispose();
            throw new Error("Guest job failed or exceeded resource limits.");
        }
        if (protocolError) throw new Error(protocolError);
        if (completion) break;
        const request = requests.shift();
        if (request) {
            const text = await new Promise<string>((resolve) => {
                port.once("message", resolve);
                port.postMessage({ kind: "request", text: request });
            });
            const response = vm.newString(text);
            try {
                vm.unwrapResult(
                    vm.callFunction(deliver, vm.undefined, response),
                ).dispose();
            } finally {
                response.dispose();
            }
        } else if (!runtime.hasPendingJob()) {
            throw new Error("Guest promise did not settle.");
        }
    }
    if (requests.length) throw new Error("Guest left unawaited broker calls.");
    if (completion?.status !== "completed" || completion.value === undefined)
        throw new Error(completion?.message ?? "Guest failed.");
    const output = JSON.stringify(completion.value);
    deliver.dispose();
    vm.dispose();
    runtime.dispose();
    port.postMessage({ kind: "result", text: output });
}

if (parentPort) {
    // Termination releases the complete WASM heap even when QuickJS cannot
    // unwind an allocation failure. No failed VM is reused or retained.
    void executeGuest(workerData as WorkerInput).catch((error: unknown) => {
        parentPort!.postMessage({
            kind: "failure",
            text:
                error instanceof Error
                    ? error.message
                    : "Unexpected guest failure.",
        });
    });
}
