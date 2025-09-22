// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct ScoredSemanticRefOrdinal
{
    public int SemanticRefOrdinal { get; set; }
    public float Score { get; set; }

    public static ScoredSemanticRefOrdinal New(int semanticRefOrdinal) { return new ScoredSemanticRefOrdinal { SemanticRefOrdinal = semanticRefOrdinal, Score = 1 }; }
}
