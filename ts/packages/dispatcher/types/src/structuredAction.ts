// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionEffect,
    ActionResult,
    PendingChoice,
    QuestionForm,
    QuestionFormResponse,
    TemplateSchema,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import type { TemplateEditConfig } from "./clientIO.js";

export const structuredActionProtocolVersion = 1;

export type ActionIdentity = {
    schemaName: string;
    actionName: string;
};

export type ActionSearchRequest = {
    query: string;
};

export type StructuredActionEnvelope = {
    protocolVersion: typeof structuredActionProtocolVersion;
    // Server-issued reuse boundary, not a bearer token or authorization grant.
    scopeId: string;
};

export type ActionExecutionPolicy = {
    effects: ActionEffect;
    confirmation: "required" | "not-required";
};

export type ActionOutputContract = {
    envelope: "ActionResult";
    optional: true;
    resultValue: { type: "unknown"; optional: true };
    resultEntity: { type: "Entity"; optional: true };
    entities: { type: "Entity[]"; optional: true };
};

export type ActionInteractionContract = {
    // Agent hooks may request interactions even for read-only actions.
    mode: "may-require-interaction";
    kinds: ("question" | "choice" | "form" | "action-proposal")[];
};

export type ActionContract = ActionIdentity & {
    description: string;
    input: {
        format: "typescript";
        typeName: string;
        schemaText: string;
    };
    policy: ActionExecutionPolicy;
    output: ActionOutputContract;
    interactions: ActionInteractionContract;
};

export type ActionSearchResult = StructuredActionEnvelope & {
    actions: ActionContract[];
};

export type ExecuteActionRequest = StructuredActionEnvelope &
    ActionIdentity & {
        parameters?: Record<string, unknown>;
    };

export type StructuredActionPrompt =
    | {
          type: "confirmation";
          action: ExecuteActionRequest;
          contract: ActionContract;
      }
    | {
          type: "question";
          message: string;
          choices: string[];
          defaultId?: number;
      }
    | Omit<Extract<PendingChoice, { type: "yesNo" }>, "choiceId">
    | Omit<Extract<PendingChoice, { type: "multiChoice" }>, "choiceId">
    | Omit<Extract<PendingChoice, { type: "pickRemember" }>, "choiceId">
    | ({ type: "form" } & QuestionForm)
    | {
          type: "proposal";
          templateAgentName: string;
          templateName: string;
          schema: TemplateSchema;
          data: unknown;
          templates: TemplateEditConfig;
      };

export type StructuredActionResponse =
    | { type: "confirmation"; approved: boolean }
    | { type: "question"; selected: number }
    | { type: "yesNo"; value: boolean }
    | { type: "multiChoice"; selected: number[] }
    | { type: "pickRemember"; selected: number; remember: boolean }
    | { type: "form"; value: QuestionFormResponse }
    | { type: "proposal"; accepted: boolean; data?: unknown };

export type ContinueActionRequest = StructuredActionEnvelope & {
    operationId: string;
    interactionId: string;
    response: StructuredActionResponse;
};

export type CancelActionRequest = StructuredActionEnvelope & {
    operationId: string;
    interactionId?: string;
};

export type StructuredActionError = {
    code:
        | "invalid_request"
        | "invalid_response"
        | "invalid_scope"
        | "unavailable"
        | "interaction_consumed"
        | "interaction_expired"
        | "execution_state_lost"
        | "queue_full"
        | "server_stopping"
        | "cancelled"
        | "execution_failed";
    message: string;
};

export type StructuredActionExecutionResult = StructuredActionEnvelope & {
    operationId: string;
    output: string[];
    results: { action: TypeAgentAction; result: ActionResult }[];
} & (
        | {
              status: "requires_interaction";
              interactionId: string;
              expiresAt: number;
              prompt: StructuredActionPrompt;
          }
        | { status: "completed" }
        | {
              status:
                  | "failed"
                  | "cancelled"
                  | "unavailable"
                  | "execution_uncertain";
              error: StructuredActionError;
          }
    );
