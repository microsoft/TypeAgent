// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CopilotToolMacro,
    MacroValidationReport,
} from "@typeagent/copilot-macros";
import type { ProcedureVersion } from "@typeagent/memory-service";
import type {
    CatalogEntry,
    SkillIdentity,
    SkillPackageInput,
} from "@typeagent/skill-catalog";

export interface ProcedureLineage {
    corpusId: string;
    procedureId: string;
    version: number;
    jsonHash: string;
    markdownHash: string;
    basedOnCandidateId?: string;
    previousVersion?: number;
}

export interface SkillArtifactInput {
    path?: string;
    content: string | Uint8Array;
}

export interface ProcedureSkillOptions {
    identity: SkillIdentity;
    description?: string;
    schema?: SkillArtifactInput;
    grammar?: SkillArtifactInput;
}

export interface ArtifactValidationIssue {
    code: string;
    message: string;
    path?: string;
}

export type MacroDraftResult =
    | {
          status: "notAvailable";
          reason: string;
          lineage: ProcedureLineage;
      }
    | {
          status: "invalid";
          errors: readonly ArtifactValidationIssue[];
          validation?: MacroValidationReport;
          lineage: ProcedureLineage;
      }
    | {
          status: "ready";
          macro: CopilotToolMacro;
          validation: MacroValidationReport;
          lineage: ProcedureLineage;
      };

export interface SkillCatalogPublisher {
    publish(input: SkillPackageInput): Promise<CatalogEntry>;
}

export interface MacroArtifactPublisher<TResult = unknown> {
    publishMacro(
        macro: CopilotToolMacro,
        lineage: ProcedureLineage,
    ): Promise<TResult>;
}

export type PublishedMacroResult<TResult> =
    | Exclude<MacroDraftResult, { status: "ready" }>
    | {
          status: "published";
          macro: CopilotToolMacro;
          validation: MacroValidationReport;
          lineage: ProcedureLineage;
          published: TResult;
      };

export interface ProcedureArtifactGenerator {
    createSkillPackage(
        procedure: ProcedureVersion,
        options: ProcedureSkillOptions,
    ): SkillPackageInput;
    createMacroDraft(procedure: ProcedureVersion): MacroDraftResult;
}
