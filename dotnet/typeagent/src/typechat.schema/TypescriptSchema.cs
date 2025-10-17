// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

public class TypescriptSchema : TypeSchema
{
    private readonly IVocabCollection? _vocabs;

    public TypescriptSchema(Type type, string schemaText, IVocabCollection? vocabs = null)
        : base(type, new SchemaText(schemaText, SchemaText.Languages.Typescript))
    {
        _vocabs = vocabs;
    }

    public IVocabCollection? Vocabs => _vocabs;

    public bool HasVocabs => _vocabs is not null;

    public static TypescriptSchema Load(Type type, string filePath)
    {
        return new TypescriptSchema(type, File.ReadAllText(filePath));
    }
}
