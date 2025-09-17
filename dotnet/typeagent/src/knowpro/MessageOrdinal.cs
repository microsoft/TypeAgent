// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct MessageOrdinal
{
    int _value;

    public MessageOrdinal(int value)
    {
        ArgumentVerify.ThrowIfLessThan(value, 0, nameof(value));
    }

    public readonly int Value => _value;

    public static implicit operator MessageOrdinal(int value) { return new MessageOrdinal(value); }
    public static implicit operator int(MessageOrdinal value) { return value._value; }
}
