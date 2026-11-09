// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SessionEventPolicy =
    | "ignore"
    | "message"
    | "tool-start"
    | "tool-complete"
    | "external-start"
    | {
          fields: readonly string[];
          outcome?:
              | "hook"
              | "permission"
              | "model"
              | "oauth"
              | "headers"
              | "server";
      };

// SDK type coverage is checked in sessionEventPolicy.spec.ts without a runtime SDK dependency.
// Details are projected, not raw event copies. Opaque selected evidence stays private until filtering.
export const sessionEventPolicies = {
    "session.start": {
        fields: [
            "sessionId",
            "producer",
            "clientName",
            "copilotVersion",
            "startTime",
            "context",
            "selectedModel",
            "parentSessionId",
            "detachedFromSpawningParentSessionId",
        ],
    },
    "session.resume": {
        fields: [
            "resumeTime",
            "startTime",
            "context",
            "selectedModel",
            "clientName",
            "producer",
            "parentSessionId",
            "detachedFromSpawningParentSessionId",
        ],
    },
    "session.remote_steerable_changed": "ignore",
    "session.error": {
        fields: [
            "errorType",
            "errorCode",
            "message",
            "stack",
            "statusCode",
            "remediation",
        ],
    },
    "session.idle": { fields: ["aborted", "mode"] },
    "session.title_changed": { fields: ["title"] },
    "session.schedule_created": {
        fields: [
            "id",
            "prompt",
            "displayPrompt",
            "origin",
            "at",
            "cron",
            "intervalMs",
            "recurring",
            "selfPaced",
            "tz",
        ],
    },
    "session.schedule_cancelled": { fields: ["id"] },
    "session.schedule_rearmed": "ignore",
    "session.autopilot_objective_changed": {
        fields: ["id", "operation", "status"],
    },
    "session.info": { fields: ["infoType", "message", "tip", "url"] },
    "session.warning": {
        fields: ["warningType", "message", "remediation", "url"],
    },
    "session.model_change": {
        fields: [
            "newModel",
            "previousModel",
            "source",
            "cause",
            "contextTier",
            "autoTier",
        ],
    },
    "session.auto_tier_switch_failed": {
        fields: ["reason", "requestedAutoTier", "effectiveAutoTier"],
    },
    "session.mode_changed": { fields: ["newMode", "previousMode"] },
    "session.mode_notice_delivered": "ignore",
    "session.session_limits_changed": "ignore",
    "session.permissions_changed": "ignore",
    "session.plan_changed": { fields: ["operation"] },
    "session.todos_changed": "ignore",
    "session.workspace_file_changed": { fields: ["operation", "path"] },
    "session.handoff": {
        fields: [
            "handoffTime",
            "host",
            "remoteSessionId",
            "repository",
            "sourceType",
            "summary",
            "context",
        ],
    },
    "session.truncation": {
        fields: [
            "performedBy",
            "messagesRemovedDuringTruncation",
            "preTruncationMessagesLength",
            "postTruncationMessagesLength",
        ],
    },
    "session.snapshot_rewind": { fields: ["eventsRemoved", "upToEventId"] },
    "session.shutdown": {
        fields: [
            "shutdownType",
            "errorReason",
            "currentModel",
            "codeChanges",
            "sessionStartTime",
        ],
    },
    "session.usage_checkpoint": "ignore",
    "session.context_changed": {
        fields: [
            "baseCommit",
            "branch",
            "cwd",
            "gitRoot",
            "headCommit",
            "hostType",
            "repository",
            "repositoryHost",
        ],
    },
    "session.usage_info": "ignore",
    "session.context_cleared": {
        fields: ["initialMessage", "messagesCleared"],
    },
    "session.compaction_start": { fields: ["trigger"] },
    "session.compaction_complete": {
        fields: [
            "success",
            "error",
            "summaryContent",
            "customInstructions",
            "checkpointNumber",
            "checkpointPath",
            "messagesRemoved",
            "trigger",
        ],
    },
    "session.task_complete": {
        fields: ["objectiveId", "outcome", "reason", "success", "summary"],
    },
    "session.completion_receipt": {
        fields: [
            "attempt",
            "eventRange",
            "finalTool",
            "sourceEventId",
            "stopReason",
            "failedToolCount",
            "successfulToolCount",
        ],
    },
    "session.fusion_route_started": "ignore",
    "session.fusion_route_failed": {
        fields: [
            "attemptId",
            "errorMessage",
            "fallbackModel",
            "reason",
            "syntheticModel",
        ],
    },
    "session.fusion_resolved": "ignore",
    "session.fusion_completed": {
        fields: [
            "fusionId",
            "turnId",
            "commitId",
            "outcome",
            "degradedReason",
            "finalSourceModel",
            "finalSourcePhaseId",
            "followUpModel",
        ],
    },
    "user.message": "message",
    "pending_messages.modified": "ignore",
    "assistant.turn_start": "ignore",
    "assistant.intent": "ignore",
    "assistant.fusion_phase_started": "ignore",
    "assistant.fusion_phase_activity": "ignore",
    "assistant.fusion_phase_completed": "ignore",
    "assistant.fusion_phase_failed": {
        fields: [
            "fusionId",
            "phaseId",
            "phaseKind",
            "status",
            "reason",
            "errorMessage",
            "degradedToPhaseId",
        ],
    },
    "assistant.server_tool_progress": "ignore",
    "assistant.reasoning": "ignore",
    "assistant.reasoning_delta": "ignore",
    "assistant.tool_call_delta": "ignore",
    "assistant.streaming_delta": "ignore",
    "assistant.message": "message",
    "assistant.message_start": "ignore",
    "assistant.message_delta": "ignore",
    "assistant.turn_end": "ignore",
    "assistant.idle": "ignore",
    // Observe the model for metadata, not token/cost/latency accounting.
    "assistant.usage": { fields: ["model"] },
    "model.call_failure": {
        fields: [
            "source",
            "failureKind",
            "errorType",
            "errorCode",
            "errorMessage",
            "statusCode",
            "apiCallId",
        ],
    },
    "model.call_finished": {
        fields: ["outcome", "turnId", "interactionId"],
        outcome: "model",
    },
    abort: { fields: ["reason"] },
    "tool.user_requested": "tool-start",
    "tool.execution_start": "tool-start",
    "tool.execution_partial_result": "ignore",
    "tool.execution_progress": "ignore",
    "tool.execution_complete": "tool-complete",
    "tool_search.activated": "ignore",
    "skill.invoked": {
        fields: [
            "name",
            "path",
            "content",
            "description",
            "allowedTools",
            "disableModelInvocation",
            "source",
            "trigger",
            "pluginName",
            "pluginVersion",
        ],
    },
    "subagent.started": {
        fields: [
            "agentDescription",
            "agentDisplayName",
            "agentName",
            "agentType",
            "executionMode",
            "factoryRunId",
            "parentId",
            "resumable",
            "toolCallId",
        ],
    },
    "subagent.configured": {
        fields: ["contextTier", "multiTurn", "reasoningEffort"],
    },
    "subagent.completed": {
        fields: ["agentDisplayName", "agentName", "cancelled", "toolCallId"],
    },
    "subagent.failed": {
        fields: ["agentDisplayName", "agentName", "error", "toolCallId"],
    },
    "subagent.selected": { fields: ["agentDisplayName", "agentName", "tools"] },
    "subagent.deselected": { fields: [] },
    "hook.start": "ignore",
    "hook.end": {
        fields: [
            "hookInvocationId",
            "hookType",
            "parentToolCallId",
            "success",
            "error",
        ],
        outcome: "hook",
    },
    "hook.progress": "ignore",
    "session.binary_asset": "ignore",
    "system.message": "message",
    "system.notification": { fields: ["content", "kind"] },
    "permission.requested": "ignore",
    "permission.completed": {
        fields: ["requestId", "toolCallId", "result"],
        outcome: "permission",
    },
    "user_input.requested": {
        fields: [
            "question",
            "choices",
            "allowFreeform",
            "requestId",
            "toolCallId",
        ],
    },
    "user_input.completed": { fields: ["answer", "requestId", "wasFreeform"] },
    "elicitation.requested": {
        fields: [
            "elicitationSource",
            "message",
            "mode",
            "requestedSchema",
            "requestId",
            "toolCallId",
            "url",
        ],
    },
    "elicitation.completed": { fields: ["action", "content", "requestId"] },
    "sampling.requested": "ignore",
    "sampling.completed": "ignore",
    "mcp.oauth_required": "ignore",
    "mcp.oauth_completed": {
        fields: ["outcome", "requestId"],
        outcome: "oauth",
    },
    "mcp.headers_refresh_required": "ignore",
    "mcp.headers_refresh_completed": {
        fields: ["outcome", "requestId"],
        outcome: "headers",
    },
    "session.custom_notification": "ignore",
    "ui.ephemeral_query": "ignore",
    "external_tool.requested": "external-start",
    // The SDK receipt has only requestId. Do not invent a tool ID, result, or success.
    "external_tool.completed": {
        fields: ["requestId", "toolCallId", "success", "result", "error"],
    },
    "command.queued": "ignore",
    "command.execute": {
        fields: ["args", "command", "commandName", "requestId"],
    },
    "command.completed": { fields: ["requestId"] },
    "auto_mode_switch.requested": { fields: ["errorCode", "requestId"] },
    "auto_mode_switch.completed": { fields: ["requestId", "response"] },
    "session_limits_exhausted.requested": { fields: ["requestId"] },
    "session_limits_exhausted.completed": { fields: ["requestId", "response"] },
    "session.auto_mode_resolved": {
        fields: ["chosenModel", "fallback", "fallbackReason"],
    },
    "session.managed_settings_resolved": "ignore",
    "session.managed_settings_enforced": {
        fields: ["action", "escalation", "failClosed", "message", "setting"],
    },
    "commands.changed": "ignore",
    "capabilities.changed": "ignore",
    "exit_plan_mode.requested": {
        fields: [
            "actions",
            "planContent",
            "recommendedAction",
            "requestId",
            "summary",
        ],
    },
    "exit_plan_mode.completed": {
        fields: ["approved", "feedback", "requestId", "selectedAction"],
    },
    "session.tools_updated": "ignore",
    "session.background_tasks_changed": "ignore",
    "factory.run_updated": "ignore",
    "factory.run_started": { fields: ["attempt", "factoryName", "runId"] },
    "factory.run_settled": { fields: ["failureType", "runId", "status"] },
    "session.skills_loaded": "ignore",
    "session.custom_agents_updated": "ignore",
    "session.mcp_servers_loaded": "ignore",
    "session.mcp_server_status_changed": {
        fields: ["error", "serverName", "status"],
        outcome: "server",
    },
    "session.mcp_server_removed": "ignore",
    "session.mcp_server_needs_reconnect": { fields: ["serverName"] },
    "mcp.tools.list_changed": "ignore",
    "mcp.resources.list_changed": "ignore",
    "mcp.prompts.list_changed": "ignore",
    "session.extensions_loaded": "ignore",
    "session.canvas.opened": "ignore",
    "session.canvas.registry_changed": "ignore",
    "session.canvas.closed": "ignore",
    "session.canvas.unavailable": "ignore",
    "session.canvas.recorded": "ignore",
    "session.canvas.removed": "ignore",
    "session.extensions.attachments_pushed": "ignore",
    "mcp_app.tool_call_complete": {
        fields: [
            "arguments",
            "error",
            "result",
            "serverName",
            "success",
            "toolName",
            "toolMeta",
        ],
    },
    // Persisted transcript references not yet present in the SDK event union.
    "skill.invoked_ref": {
        fields: [
            "name",
            "path",
            "description",
            "allowedTools",
            "source",
            "trigger",
            "pluginName",
            "pluginVersion",
            "contentId",
            "contentLength",
            "invokedAtTurn",
        ],
    },
    "skill.context_delivered_ref": {
        fields: ["interactionId", "source", "contentId", "prefix", "suffix"],
    },
} as const satisfies Record<string, SessionEventPolicy>;

export function sessionEventPolicy(
    type: string,
): SessionEventPolicy | undefined {
    return Object.prototype.hasOwnProperty.call(sessionEventPolicies, type)
        ? sessionEventPolicies[type as keyof typeof sessionEventPolicies]
        : undefined;
}

export function retainsOutcome(
    outcome: NonNullable<Extract<SessionEventPolicy, object>["outcome"]>,
    data: Record<string, unknown>,
): boolean {
    switch (outcome) {
        case "hook":
            return data.success === false;
        case "permission": {
            const result = data.result;
            if (
                typeof result !== "object" ||
                result === null ||
                !("kind" in result)
            )
                return false;
            return [
                "cancelled",
                "denied-by-rules",
                "denied-no-approval-rule-and-could-not-request-from-user",
                "denied-interactively-by-user",
                "denied-by-content-exclusion-policy",
                "denied-by-permission-request-hook",
            ].includes(typeof result.kind === "string" ? result.kind : "");
        }
        case "model":
            return (
                data.outcome === "error" ||
                data.outcome === "cancelled" ||
                data.outcome === "rejected"
            );
        case "oauth":
            return data.outcome === "cancelled";
        case "headers":
            return data.outcome === "timeout" || data.outcome === "none";
        case "server":
            return data.status === "failed" || data.status === "needs-auth";
    }
}
