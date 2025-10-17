// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// A vocabulary with a name.
/// Name Vocabs can be shallow compared by their names. 
/// </summary>
public class NamedVocab : IComparable<NamedVocab>
{
    private readonly string _name;
    private readonly IVocab _vocab;

    public NamedVocab(IVocab vocab)
        : this(string.Empty, vocab)
    {
    }

    public NamedVocab(string name, IVocab vocab)
    {
        ArgumentVerify.ThrowIfNull(name, nameof(name));
        ArgumentVerify.ThrowIfNull(vocab, nameof(vocab));

        _name = name;
        _vocab = vocab;
    }

    [JsonConstructor]
    public NamedVocab(string name, Vocab vocab)
        : this(name, (IVocab)vocab)
    {
    }

    /// <summary>
    /// The name of this vocab
    /// </summary>
    public string Name => _name;

    /// <summary>
    /// The vocabulary associated with this vocab
    /// </summary>
    public IVocab Vocab => _vocab;

    /// <summary>
    /// Compares the vocab name
    /// </summary>
    /// <param name="other"></param>
    /// <returns></returns>
    public int CompareTo(NamedVocab? other)
    {
        return _name.CompareTo(other._name);
    }

    /// <summary>
    /// Checks if obj matches the vocab name
    /// </summary>
    /// <param name="obj"></param>
    /// <returns></returns>
    public override bool Equals(object? obj) => _name.Equals(obj);

    /// <summary>
    /// Hashcode for the vocab name
    /// </summary>
    /// <returns></returns>
    public override int GetHashCode() => _name.GetHashCode();

    /// <summary>
    /// Return the vocab name
    /// </summary>
    /// <returns></returns>
    public override string? ToString() => _name;
}
