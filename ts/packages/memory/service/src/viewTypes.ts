// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcedureSourceCitation } from "./types.js";
import type { AgentEdition } from "./agentEdition.js";

export type ViewKind = "troubleshootingGuide";
export type ViewState = "draft" | "stale" | "archived";
export interface ViewCitation extends ProcedureSourceCitation {
    locator: string;
    excerpt: string;
}
export interface ViewSourceSelector {
    kind: "sources";
    sources: Array<{ sourceId: string; revisionId: string }>;
}
export interface ViewSection {
    id: string;
    role:
        | "description"
        | "prerequisites"
        | "diagnostic"
        | "guard"
        | "verification"
        | "recovery"
        | "context";
    heading: string;
    body: string;
}
export type ViewEndpoint =
    | { kind: "section"; viewId: string; sectionId: string }
    | { kind: "source"; sourceId: string; revisionId: string };
export interface ViewRelationshipInput {
    id: string;
    predicate: "supportedBy" | "dependsOn";
    from: ViewEndpoint;
    to: ViewEndpoint;
    citations: ViewCitation[];
}
export type ViewRelationship =
    | (ViewRelationshipInput & {
          schemaVersion: 1;
          family: "evidence" | "dependency";
          origin: "human";
          reviewState: "unreviewed";
      })
    | {
          id: string;
          schemaVersion: 1;
          family: "lineage" | "dependency";
          origin: "system";
          predicate: "generatedFrom" | "dependsOn";
          from: { kind: "view"; viewId: string; revisionId: string };
          to:
              | { kind: "definition"; viewId: string; revisionId: string }
              | { kind: "source"; sourceId: string; revisionId: string };
      };
interface GuideFields {
    title: string;
    summary?: string;
    sections: ViewSection[];
    citations: ProcedureSourceCitation[];
    agentEdition?: AgentEdition;
    compatibilityFields?: Record<string, unknown>;
}
export interface TroubleshootingGuideContent extends GuideFields {
    kind: "troubleshootingGuide";
}
export interface ProcedureViewContent extends GuideFields {
    kind: "procedure";
}
export interface ViewDefinitionInput {
    viewId: string;
    kind: ViewKind;
    selector: ViewSourceSelector;
}
export interface ViewDefinition {
    viewId: string;
    revisionId: string;
    kind: ViewKind | "procedure";
    selector: ViewSourceSelector;
}
export interface ViewVersion {
    corpusId: string;
    viewId: string;
    revisionId: string;
    version: number;
    state: ViewState;
    createdAt: string;
    actor: string;
    baseRevisionId?: string;
    generation?: {
        candidateId: string;
        content: TroubleshootingGuideContent | ProcedureViewContent;
        fingerprint: string;
    };
    definition: ViewDefinition;
    content: TroubleshootingGuideContent | ProcedureViewContent;
    relationships: ViewRelationship[];
    provenance: "human" | "procedure";
    compatibility?: {
        state: "saved" | "stale" | "archived";
        basedOnCandidateId?: string;
        previousVersion?: number;
    };
}
export interface ViewSnapshot {
    head: string | null;
    views: ViewVersion[];
}
export interface ViewSaveRequest {
    corpusId: string;
    viewId: string;
    expectedVersion: number;
    expectedHead: string | null;
    definition: ViewDefinitionInput;
    content: TroubleshootingGuideContent;
    relationships: ViewRelationshipInput[];
}
export interface ViewArchiveRequest {
    corpusId: string;
    viewId: string;
    expectedVersion: number;
    expectedHead: string;
}
export interface ViewReadRequest {
    corpusId: string;
    viewId: string;
    revisionId?: string;
}
export interface ViewHistoryEntry {
    commitId: string;
    version: ViewVersion;
}
export interface MemoryViewService {
    listViews(corpusId: string): Promise<ViewSnapshot>;
    getView(request: ViewReadRequest): Promise<ViewVersion | undefined>;
    saveViewDraft(request: ViewSaveRequest): Promise<ViewHistoryEntry>;
    archiveView(request: ViewArchiveRequest): Promise<ViewHistoryEntry>;
    getViewHistory(request: ViewReadRequest): Promise<ViewHistoryEntry[]>;
    publishView(request: ViewReadRequest): Promise<never>;
}
