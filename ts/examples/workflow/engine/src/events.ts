// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Events emitted by the workflow engine during execution.
 */
export type WorkflowEvent =
    | {
          type: "runStarted";
          runId: string;
          workflowName: string;
          timestamp: number;
      }
    | {
          type: "nodeStarted";
          runId: string;
          nodeId: string;
          taskName: string;
          /** 1-based visit count for this node in the current run. */
          iteration: number;
          timestamp: number;
      }
    | {
          type: "nodeCompleted";
          runId: string;
          nodeId: string;
          taskName: string;
          output: unknown;
          /** 1-based visit count for this node in the current run. */
          iteration: number;
          timestamp: number;
      }
    | {
          type: "nodeFailed";
          runId: string;
          nodeId: string;
          taskName: string;
          error: { message: string; data?: unknown };
          timestamp: number;
      }
    | {
          type: "runCompleted";
          runId: string;
          output: unknown;
          timestamp: number;
      }
    | {
          type: "runFailed";
          runId: string;
          nodeId: string;
          error: { message: string; data?: unknown };
          timestamp: number;
      }
    | {
          type: "runCancelled";
          runId: string;
          timestamp: number;
      };

export type WorkflowEventListener = (event: WorkflowEvent) => void;
