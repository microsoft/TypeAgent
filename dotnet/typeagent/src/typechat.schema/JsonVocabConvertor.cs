// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// A custom convertor used with the Json Serializer to implement vocabuaries
/// </summary>
internal class JsonVocabConvertor : JsonConverter<string?>
{
    private readonly string? _propertyName;
    private readonly string? _vocabName;
    private readonly IVocab _vocab;

    public JsonVocabConvertor() { }

    internal JsonVocabConvertor(string vocabName, string? propertyName)
    {
        _propertyName = propertyName;
        _vocabName = vocabName;
    }

    public JsonVocabConvertor(IVocab vocab, string? propertyName)
    {
        ArgumentVerify.ThrowIfNull(vocab, nameof(vocab));
        _propertyName = propertyName;
        _vocab = vocab;
    }

    internal bool HasVocabName => !string.IsNullOrEmpty(_vocabName);

    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        string? value = reader.GetString();
        if (_vocab is not null)
        {
            _vocab.ThrowIfNotInVocab(_propertyName, value);
            return value;
        }
        else if (HasVocabName)
        {
            // Dynamically bind to a vocabulary if possible
            var converter = options.GetConverter(typeof(VocabString)) as VocabStringJsonConvertor;
            if (converter is null)
            {
                throw new SchemaException(SchemaException.ErrorCode.VocabNotFound);
            }
            converter.Vocabs.ThrowIfNotInVocab(_vocabName, _propertyName, value);
        }
        return value;
    }

    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value);
    }
}

