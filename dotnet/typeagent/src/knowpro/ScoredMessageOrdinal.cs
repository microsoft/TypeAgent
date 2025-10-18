// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct ScoredMessageOrdinal
{
    [JsonPropertyName("messageOrdinal")]
    public int MessageOrdinal { get; set; }

    [JsonPropertyName("score")]
    public double Score { get; set; }
}
