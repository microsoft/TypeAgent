// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct SemanticRefOrdinal
{
    public SemanticRefOrdinal(int value)
    {
        ArgumentVerify.ThrowIfLessThan(value, 0, nameof(value));
        Value = value;
    }

    public int Value { get; set; }

    public static implicit operator SemanticRefOrdinal(int value) { return new SemanticRefOrdinal(value); }
    public static implicit operator int(SemanticRefOrdinal value) { return value.Value; }
}
