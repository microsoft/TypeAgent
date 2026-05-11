// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Events emitted by the workflow engine during execution.
 * Mirrors the observability contract in ir-v1.md section 5.6.
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
          scopePath: string[];
          timestamp: number;
      }
    | {
          type: "nodeCompleted";
          runId: string;
          nodeId: string;
          scopePath: string[];
          output: unknown;
          timestamp: number;
      }
    | {
          type: "nodeFailed";
          runId: string;
          nodeId: string;
          scopePath: string[];
          error: { message: string; data?: unknown };
          timestamp: number;
      }
    | {
          type: "loopIterationStarted";
          runId: string;
          nodeId: string;
          scopePath: string[];
          iteration: number;
          timestamp: number;
      }
    | {
          type: "loopExited";
          runId: string;
          nodeId: string;
          scopePath: string[];
          iteration: number;
          output: unknown;
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
          error: { message: string; data?: unknown };
          timestamp: number;
      };

export type WorkflowEventListener = (event: WorkflowEvent) => void;
