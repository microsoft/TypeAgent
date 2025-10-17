// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// Json objects contain string properties that can be assigned values from a known set of strings: vocabularies.
/// The JsonVocab attribute lets you specify these values as easily as you would in Typescript.
/// During deserialization, the custom JsonVocabConverter verifies that the string property only contains
/// values that belong to the vocabulary
/// 
/// You can specify a vocabulary inline:
/// [JsonVocab("negative | neutral | positive")]
/// 
/// Or you can specify the name of vocabulary that is resolved at runtime. 
/// </summary>
public class JsonVocabAttribute : JsonConverterAttribute
{
    private string _entries;
    private IVocab _vocab;

    /// <summary>
    /// Default const
    /// </summary>
    public JsonVocabAttribute() { }

    /// <summary>
    /// Define a JsonVocab attribute
    /// </summary>
    /// <param name="entries">The entries in the vocabulary , each separated by a '|'</param>
    /// <param name="propertyName">The json property name for which this is a vocabulary</param>
    public JsonVocabAttribute(string entries, string? propertyName = null)
    {
        Entries = entries;
        PropertyName = propertyName;
    }

    /// <summary>
    /// The Name of the vocabulary
    /// </summary>
    public string? Name { get; set; }
    /// <summary>
    /// Entries in this vocabulary, if any were provided inline
    /// </summary>
    public string? Entries
    {
        get => _entries;
        set
        {
            _vocab = null;
            _entries = value;
            if (!string.IsNullOrEmpty(value))
            {
                _vocab = Schema.Vocab.Parse(_entries);
            }
        }
    }
    /// <summary>
    /// The Json property name for which this is a vocabulary
    /// </summary>
    public string? PropertyName { get; set; }

    /// <summary>
    /// Should the vocabulary be emitted inline, or as a standalone type
    /// </summary>
    public bool Inline { get; set; } = true;

    /// <summary>
    /// If true, validates properties for membership in this vocabulary
    /// </summary>
    public bool Enforce { get; set; } = true;

    internal IVocab? Vocab => _vocab;

    internal bool HasEntries => !string.IsNullOrEmpty(_entries);

    internal bool HasName => !string.IsNullOrEmpty(Name);

    internal bool HasVocab => _vocab is not null;

    internal bool HasPropertyName => !string.IsNullOrEmpty(PropertyName);

    /// <summary>
    /// Create a convertor that ensures that any assigned value is a member of the associated vocabulary
    /// </summary>
    /// <param name="typeToConvert"></param>
    /// <returns></returns>
    public override JsonConverter? CreateConverter(Type typeToConvert)
    {
        if (typeof(string) != typeToConvert)
        {
            return null;
        }

        if (HasVocab)
        {
            return new JsonVocabConvertor(_vocab, PropertyName);
        }
        if (HasName)
        {
            return new JsonVocabConvertor(Name, PropertyName);
        }
        return base.CreateConverter(typeToConvert);
    }

    public Vocab? ToVocab()
    {
        if (!HasEntries)
        {
            return null;
        }
        return new Vocab(_vocab);
    }

    public NamedVocab? ToVocabType()
    {
        if (!HasVocab)
        {
            return null;
        }
        return new NamedVocab(Name, _vocab);
    }
}

