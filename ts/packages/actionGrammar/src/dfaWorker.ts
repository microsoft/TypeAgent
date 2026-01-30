// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parentPort } from "worker_threads";
import { NFA } from "./nfa.js";
import { compileNFAToDFA } from "./dfaCompiler.js";
import { DFA } from "./dfa.js";

/**
 * Worker thread for compiling NFAs to DFAs
 *
 * This runs in a separate thread to avoid blocking the main event loop
 * during expensive DFA construction.
 */

interface DFACompilationRequest {
    nfa: NFA;
    name?: string;
}

interface DFACompilationResult {
    success: boolean;
    dfa?: DFA;
    error?: string;
    compilationTimeMs: number;
}

if (parentPort) {
    parentPort.on("message", (request: DFACompilationRequest) => {
        const startTime = Date.now();

        try {
            const dfa = compileNFAToDFA(request.nfa, request.name);
            const compilationTimeMs = Date.now() - startTime;

            const result: DFACompilationResult = {
                success: true,
                dfa,
                compilationTimeMs,
            };

            parentPort!.postMessage(result);
        } catch (error) {
            const compilationTimeMs = Date.now() - startTime;

            const result: DFACompilationResult = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                compilationTimeMs,
            };

            parentPort!.postMessage(result);
        }
    });
}
