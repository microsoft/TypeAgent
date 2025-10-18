// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

internal struct ScoredTextLocation
{
    [JsonPropertyName("score")]
    public double Score { get; set; }

    [JsonPropertyName("textLocation")]
    public TextLocation TextLocation { get; set; }
}
