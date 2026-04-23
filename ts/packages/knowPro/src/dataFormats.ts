// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemanticRef, ScoredSemanticRefOrdinal } from "./interfaces.js";

//------------------------
// Serialization formats
//------------------------

export interface IConversationData<TMessage = any> {
    nameTag: string;
    messages: TMessage[];
    tags: string[];
    semanticRefs: SemanticRef[];
    semanticIndexData?: ITermToSemanticRefIndexData | undefined;
}

// persistent form of a term index
export interface ITermToSemanticRefIndexData {
    items: ITermToSemanticRefIndexItem[];
}

export interface ITermToSemanticRefIndexItem {
    term: string;
    semanticRefOrdinals: ScoredSemanticRefOrdinal[];
}
