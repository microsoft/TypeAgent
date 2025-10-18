// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

internal static class VocabExtensions
{
    public static void ThrowIfNotInVocab(this IVocab vocab, string? propertyName, string? value)
    {
        if (vocab is null)
        {
            throw new SchemaException(SchemaException.ErrorCode.VocabNotFound);
        }
        string? error;
        if (propertyName is null)
        {
            error = vocab.ValidateConstraints(value);
        }
        else
        {
            error = vocab.ValidateConstraints(propertyName, value);
        }
        if (error is not null)
        {
            throw new SchemaException(SchemaException.ErrorCode.ValueNotInVocab, error);
        }
    }

    public static string? ValidateConstraints(this IVocab vocab, string value)
    {
        if (vocab.Contains(value))
        {
            return null;
        }

        return $"'{value}' does not exist. Permitted values: {vocab}";
    }

    public static string? ValidateConstraints(this IVocab vocab, string propertyName, string value)
    {
        if (vocab.Contains(value))
        {
            return null;
        }

        return $"{propertyName} '{value}' does not exist. Permitted {propertyName} values: {vocab}";
    }

    public static void ThrowIfNotInVocab(this IVocabCollection vocabs, string vocabName, string? propertyName, string? value)
    {
        NamedVocab? vocabType = vocabs.Get(vocabName);
        if (vocabType is null)
        {
            SchemaException.ThrowVocabNotFound(vocabName, value);
        }
        string? error;
        if (propertyName is null)
        {
            error = vocabType.Vocab.ValidateConstraints(value);
        }
        else
        {
            error = vocabType.Vocab.ValidateConstraints(propertyName, value);
        }
        if (error is not null)
        {
            throw new SchemaException(SchemaException.ErrorCode.ValueNotInVocab, error);
        }
    }
}
