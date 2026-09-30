// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * agentStop capture. The CLI payload has a transcript path, not the result
 * text, so the latest assistant message is read from that transcript.
 * An optional `knowledge` field is attached when the host supplies one.
 */

import { fileURLToPath } from "node:url";
import {
    withWorkspaceMemory,
    type MemoryClient,
} from "../shared/memory-client.js";
import {
    parseStopKnowledge,
    readTranscriptTurn,
    type KnowledgePayload,
} from "../shared/transcript.js";
import { parseStopInput } from "./parse-input.js";
import { logHookError, readStdin, writeHookOutput } from "./stdio.js";
import type { StopHookInput } from "./types.js";

export async function resolveStopTurn(input: StopHookInput): Promise<
    | {
          text: string;
          knowledge?: KnowledgePayload;
      }
    | undefined
> {
    const supplied = parseStopKnowledge(input.knowledge);
    if (input.response) {
        return supplied
            ? { text: input.response, knowledge: supplied }
            : { text: input.response };
    }
    if (!input.transcriptPath) {
        return undefined;
    }
    try {
        const turn = await readTranscriptTurn(input.transcriptPath);
        if (!turn) {
            return undefined;
        }
        const knowledge = supplied ?? turn.knowledge;
        return knowledge ? { text: turn.text, knowledge } : { text: turn.text };
    } catch (error) {
        logHookError(error);
        return undefined;
    }
}

export async function handleAgentStop(
    input: StopHookInput,
    client: MemoryClient,
): Promise<Record<string, never>> {
    const turn = await resolveStopTurn(input);
    if (!turn || !turn.text.trim()) {
        return {};
    }
    try {
        await client.captureResult(turn.text, turn.knowledge);
    } catch (error) {
        logHookError(error);
    }
    return {};
}

async function main(): Promise<void> {
    const input = parseStopInput(JSON.parse(await readStdin()));
    await withWorkspaceMemory(input.cwd, (client) =>
        handleAgentStop(input, client),
    );
    writeHookOutput({});
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        logHookError(error);
        writeHookOutput({});
    });
}
