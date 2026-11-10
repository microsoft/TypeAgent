// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ProcedureRecord =
    | {
          kind:
              | "context"
              | "prerequisite"
              | "guard"
              | "description"
              | "policy"
              | "gap"
              | "metadata";
          id: string;
          text: string;
      }
    | {
          kind: "step";
          id: string;
          text: string;
          requiredInputs: string[];
          expectedObservation: string | null;
      }
    | {
          kind: "actionCollection";
          id: string;
          text: string;
          actionIds: string[];
          order: "any-order" | "unspecified";
      }
    | {
          kind: "workflow";
          id: string;
          text: string;
          nodeIds: string[];
          order: "partial-order";
      }
    | {
          kind: "orderingConstraint";
          id: string;
          before: string;
          after: string;
          condition: string;
      }
    | {
          kind: "decisionTable";
          id: string;
          title: string;
          text: string;
          appliesTo: string[];
          columns: string[];
          rows: string[][];
      }
    | {
          kind: "action";
          id: string;
          title: string;
          text: string;
          canonicalAction: string | null;
          informationRequests: string[] | null;
          formInstruction: string | null;
          interfaceParameters: string[] | null;
          sequence: string[] | null;
          selectionCondition: string | null;
          expectedObservation: string | null;
      }
    | {
          kind: "transition";
          id: string;
          from: string;
          to: string;
          condition: string;
      }
    | {
          kind: "outcome";
          id: string;
          text: string;
          result: "resolved" | "escalated" | "unresolved" | "unknown";
      };

export type ProcedureExtraction = {
    title: string;
    entryStep: string;
    titlePassageIds: string[];
    records: Array<{
        record: ProcedureRecord;
        supportPassageIds: string[];
        oppositionPassageIds: string[];
    }>;
    unusedPassages: Array<{ passageId: string; reason: string }>;
};

export type ProcedureAssessment = {
    supported: boolean;
    issues: Array<{ recordId: string | null; reason: string }>;
    coveredPassageIds: string[];
};
