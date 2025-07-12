// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

export interface MetadataExtractor {
    extractFromUrl(url: string): BasicKnowledge;
    extractFromTitle(title: string): BasicKnowledge;
    extractTemporal(visitDate?: string, bookmarkDate?: string): TemporalFacets;
    extractDomain(url: string): DomainEntity;
    mergeWithAIKnowledge(
        metadata: BasicKnowledge, 
        aiKnowledge: kpLib.KnowledgeResponse
    ): kpLib.KnowledgeResponse;
}

export interface BasicKnowledge {
    entities: kpLib.ConcreteEntity[];
    topics: string[];
    actions: any[];
    confidence: number;
}

export interface TemporalFacets {
    visitDate?: string;
    bookmarkDate?: string;
    visitYear?: string;
    bookmarkYear?: string;
}

export interface DomainEntity extends kpLib.ConcreteEntity {
    domain: string;
    category?: string;
    confidence: number;
}
