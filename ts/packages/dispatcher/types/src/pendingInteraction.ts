// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RequestId } from "./dispatcher.js";
import type { TemplateEditConfig } from "./clientIO.js";

/**
 * The type of a pending interaction awaiting a client response.
 */
export type PendingInteractionType = "question" | "proposeAction";

/**
 * A request sent to the client for a pending interaction.
 * Contains all data needed for the client to render the appropriate UI.
 *
 * The `question` type unifies the former `askYesNo` and `popupQuestion` types:
 * choices are always explicit strings; callers that want a yes/no prompt pass
 * `choices: ["Yes", "No"]` and use `askYesNo()` / `popupQuestion()` wrappers
 * on SessionContext to convert between boolean and index.
 */
export type PendingInteractionRequest = {
    interactionId: string;
    type: PendingInteractionType;
    requestId?: RequestId;
    source: string;
    timestamp: number;
} & (
    | {
          type: "question";
          message: string;
          choices: string[];
          defaultId?: number;
      }
    | {
          type: "proposeAction";
          actionTemplates: TemplateEditConfig;
      }
);

/**
 * A response from the client resolving a pending interaction.
 */
export type PendingInteractionResponse =
    | { interactionId: string; type: "question"; value: number }
    | { interactionId: string; type: "proposeAction"; value: unknown };
