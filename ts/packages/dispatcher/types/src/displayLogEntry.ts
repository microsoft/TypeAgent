// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";
import type {
    IAgentMessage,
    NotifyExplainedData,
    TemplateEditConfig,
} from "./clientIO.js";
import type { RequestId } from "./dispatcher.js";
import type { PendingInteractionType } from "./pendingInteraction.js";

export type SetDisplayEntry = {
    type: "set-display";
    seq: number;
    timestamp: number;
    message: IAgentMessage;
};

export type AppendDisplayEntry = {
    type: "append-display";
    seq: number;
    timestamp: number;
    message: IAgentMessage;
    mode: DisplayAppendMode;
};

export type SetDisplayInfoEntry = {
    type: "set-display-info";
    seq: number;
    timestamp: number;
    requestId: RequestId;
    source: string;
    actionIndex?: number;
    action?: TypeAgentAction | string[];
};

export type NotifyEntry = {
    type: "notify";
    seq: number;
    timestamp: number;
    notificationId: string | RequestId | undefined;
    event: string;
    data: NotifyExplainedData | any;
    source: string;
};

export type UserRequestEntry = {
    type: "user-request";
    seq: number;
    timestamp: number;
    requestId: RequestId;
    command: string;
};

export type PendingInteractionEntry = {
    type: "pending-interaction";
    seq: number;
    timestamp: number;
    interactionId: string;
    interactionType: PendingInteractionType;
    requestId?: RequestId;
    source: string;
    // question fields
    message?: string;
    choices?: string[];
    defaultId?: number;
    // proposeAction fields
    actionTemplates?: TemplateEditConfig;
};

export type InteractionResolvedEntry = {
    type: "interaction-resolved";
    seq: number;
    timestamp: number;
    interactionId: string;
    response: unknown;
};

export type InteractionCancelledEntry = {
    type: "interaction-cancelled";
    seq: number;
    timestamp: number;
    interactionId: string;
};

export type DisplayLogEntry =
    | SetDisplayEntry
    | AppendDisplayEntry
    | SetDisplayInfoEntry
    | NotifyEntry
    | UserRequestEntry
    | PendingInteractionEntry
    | InteractionResolvedEntry
    | InteractionCancelledEntry;
