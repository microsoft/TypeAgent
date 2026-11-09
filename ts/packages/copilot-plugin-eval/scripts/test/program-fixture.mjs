// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function programFixture(document, timestamp) {
    const scope = {
        workspaceId: "D:\\synthetic\\workspace",
        profileId: "synthetic-profile",
        sessionId: "synthetic-session",
        catalogDirectory:
            "D:\\synthetic\\plugin-config\\recipes\\synthetic-scope",
    };
    const capabilities = ["lookup_document", "fetch_document"].map(
        (operation) => ({
            id: `mcp:eval-docs/${operation}`,
            providerId: "eval-docs",
            transport: "mcp",
            operation,
            effect: "read",
        }),
    );
    const run = {
        macroId: "synthetic-macro",
        version: 2,
        runId: "synthetic-current-run",
        status: "completed",
        inputs: { title: document.title },
        steps: [],
        startedAt: timestamp,
        completedAt: timestamp,
        program: {
            recipeId: "synthetic-recipe",
            revision: "immutable-checked-revision",
            runId: "synthetic-current-run",
            accepted: true,
            status: "completed",
            fallback: "never",
            output: document.content,
            semanticEvidence: [],
            checkpoints: capabilities.map((capability, index) => ({
                callId: `current-call-${index}`,
                capabilityId: capability.id,
                effect: "read",
                phase: "completed",
            })),
            completedCallIds: ["current-call-0", "current-call-1"],
        },
    };
    const response = { status: "completed", run };
    const event = {
        id: "program-invocation",
        timestamp,
        type: "hook.end",
        data: {
            hookType: "userPromptSubmitted",
            success: true,
            output: {
                handled: true,
                handledBy: "typeagent",
                responseContent: JSON.stringify(response),
            },
        },
    };
    return {
        run,
        event,
        evidence: {
            eventId: event.id,
            owner: "plugin",
            response,
            reconciledRun: structuredClone(run),
            macro: {
                macroId: run.macroId,
                version: run.version,
                state: "approved",
                executionKind: "program",
                program: {
                    recipeId: run.program.recipeId,
                    revision: run.program.revision,
                    capabilities,
                },
            },
            registration: scope,
            expected: {
                ...scope,
                runId: run.runId,
                startedAt: timestamp,
                endedAt: timestamp,
            },
        },
    };
}
