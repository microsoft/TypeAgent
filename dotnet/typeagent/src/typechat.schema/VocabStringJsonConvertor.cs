// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

internal class VocabStringJsonConvertor : JsonConverter<VocabString>
{
    private readonly IVocabCollection _vocabs;

    public VocabStringJsonConvertor(IVocabCollection vocabs)
    {
        ArgumentVerify.ThrowIfNull(vocabs, nameof(vocabs));
        _vocabs = vocabs;
    }

    public IVocabCollection Vocabs => _vocabs;

    public override VocabString Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var convertor = (JsonConverter<VocabString>)options.GetConverter(typeof(VocabString));
        var vocabString = convertor.Read(ref reader, typeToConvert, options);
        vocabString.ValidateConstraints(_vocabs);
        return vocabString;
    }

    public override void Write(Utf8JsonWriter writer, VocabString value, JsonSerializerOptions options)
    {
        var convertor = (JsonConverter<VocabString>)options.GetConverter(typeof(VocabString));
        convertor.Write(writer, value, options);
    }
}

