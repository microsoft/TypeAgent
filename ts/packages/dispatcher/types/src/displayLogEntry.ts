// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";
import type { IAgentMessage, NotifyExplainedData } from "./clientIO.js";
import type { RequestId } from "./dispatcher.js";

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

export type DisplayLogEntry =
    | SetDisplayEntry
    | AppendDisplayEntry
    | SetDisplayInfoEntry
    | NotifyEntry;
