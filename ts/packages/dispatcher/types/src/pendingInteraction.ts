// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RequestId } from "./dispatcher.js";
import type { TemplateEditConfig } from "./clientIO.js";

/**
 * The type of a pending interaction awaiting a client response.
 */
export type PendingInteractionType =
    | "askYesNo"
    | "proposeAction"
    | "popupQuestion";

/**
 * A request sent to the client for a pending interaction.
 * Contains all data needed for the client to render the appropriate UI.
 */
export type PendingInteractionRequest = {
    interactionId: string;
    type: PendingInteractionType;
    requestId?: RequestId;
    source: string;
    timestamp: number;
} & (
    | { type: "askYesNo"; message: string; defaultValue?: boolean }
    | {
          type: "proposeAction";
          actionTemplates: TemplateEditConfig;
      }
    | {
          type: "popupQuestion";
          message: string;
          choices: string[];
          defaultId?: number;
      }
);

/**
 * A response from the client resolving a pending interaction.
 */
export type PendingInteractionResponse =
    | { interactionId: string; type: "askYesNo"; value: boolean }
    | { interactionId: string; type: "proposeAction"; value: unknown }
    | { interactionId: string; type: "popupQuestion"; value: number };
