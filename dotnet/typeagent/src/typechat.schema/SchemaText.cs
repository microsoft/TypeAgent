// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// Schema is defined by:
/// - The schema specification, in text
/// - The language the schema is written in, such as Typescript
/// </summary>
public struct SchemaText
{
    /// <summary>
    /// Standard schema languages
    /// </summary>
    public static class Languages
    {
        /// <summary>
        /// The schema is written in Typescript
        /// </summary>
        public const string Typescript = "TypeScript";
    }

    private readonly string _lang;
    private readonly string _text;

    /// <summary>
    /// Create a SchemaText object to hold schema specified in the given language
    /// </summary>
    /// <param name="text">schema text</param>
    /// <param name="lang">schema language</param>
    /// <exception cref="ArgumentException"></exception>
    [JsonConstructor]
    public SchemaText(string text, string lang)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(text, nameof(text));
        ArgumentVerify.ThrowIfNullOrEmpty(lang, nameof(lang));

        _lang = lang;
        _text = text;
    }

    /// <summary>
    /// The schema language
    /// </summary>
    [JsonPropertyName("lang")]
    public string Lang => _lang;

    /// <summary>
    /// The schema text
    /// </summary>
    [JsonPropertyName("text")]
    public string Text => _text;

    public override string ToString()
    {
        return _text;
    }

    public static implicit operator string(SchemaText schema)
    {
        return schema._text;
    }

    public static SchemaText Load(string filePath)
    {
        string schemaText = File.ReadAllText(filePath);
        string ext = Path.GetExtension(filePath);
        string lang = null;
        if (ext == ".ts")
        {
            lang = Languages.Typescript;
        }
        else
        {
            throw new NotSupportedException($"{lang} is not supported");
        }
        return new SchemaText(schemaText, lang);
    }
}
