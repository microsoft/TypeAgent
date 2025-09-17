// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct MessageOrdinal
{
    public MessageOrdinal(int value)
    {
        ArgumentVerify.ThrowIfLessThan(value, 0, nameof(value));
        Value = value;
    }

    public int Value { get; set; }

    public static implicit operator MessageOrdinal(int value) { return new MessageOrdinal(value); }
    public static implicit operator int(MessageOrdinal value) { return value.Value; }
}
