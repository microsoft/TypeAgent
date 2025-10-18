// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// An Vocabulary Entry.
/// </summary>
public readonly struct VocabEntry : IComparable<VocabEntry>, IEquatable<VocabEntry>
{
    private readonly string _text;

    [JsonConstructor]
    public VocabEntry(string text)
    {
        _text = text;
    }

    /// <summary>
    /// Vocabulary text
    /// </summary>
    public string Text => _text;

    public int CompareTo(VocabEntry other)
    {
        return _text.CompareTo(other._text);
    }

    public int CompareTo(VocabEntry other, StringComparison comparison)
    {
        return string.Compare(_text, other._text, comparison);
    }

    public override bool Equals(object? obj) => _text.Equals(obj);

    public bool Equals(VocabEntry other) => _text.Equals(other._text, StringComparison.Ordinal);

    public override int GetHashCode() => _text.GetHashCode();

    public override string? ToString() => _text;

    public static implicit operator string(VocabEntry entry)
    {
        return entry._text;
    }

    public static implicit operator VocabEntry(string text)
    {
        return new VocabEntry(text);
    }
    public static bool operator ==(VocabEntry left, VocabEntry right)
    {
        return left.Equals(right);
    }

    public static bool operator !=(VocabEntry left, VocabEntry right)
    {
        return !(left == right);
    }
}
