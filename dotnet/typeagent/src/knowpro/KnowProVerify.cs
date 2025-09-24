// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro;

public class KnowProVerify
{
    public static void ThrowIfInvalidMessageOrdinal(int messageOrdinal)
    {
        ArgumentVerify.ThrowIfLessThan(messageOrdinal, 0, nameof(messageOrdinal));
    }

    public static void ThrowIfInvalidSemanticRefOrdinal(int semanticRefOrdinal)
    {
        ArgumentVerify.ThrowIfLessThan(semanticRefOrdinal, 0, nameof(semanticRefOrdinal));
    }

    public static void ThrowIfInvalid(IMessage message)
    {
        ArgumentVerify.ThrowIfNull(message, nameof(message));
        ArgumentVerify.ThrowIfNullOrEmpty(message.TextChunks, nameof(message.TextChunks));
    }

    public static void ThrowIfInvalid(SemanticRef semanticRef)
    {
        ArgumentVerify.ThrowIfNull(semanticRef, nameof(semanticRef));
        ArgumentVerify.ThrowIfNull(semanticRef.Range, nameof(semanticRef.Range));
        ArgumentVerify.ThrowIfNullOrEmpty(semanticRef.KnowledgeType, nameof(semanticRef.KnowledgeType));
        ArgumentVerify.ThrowIfNull(semanticRef.Knowledge, nameof(semanticRef.Knowledge));
    }

    public static void ThrowIfInvalid(ConcreteEntity entity)
    {
        ArgumentVerify.ThrowIfNull(entity, nameof(entity));
        ArgumentVerify.ThrowIfNullOrEmpty(entity.Name, nameof(entity.Name));
        ArgumentVerify.ThrowIfNull(entity.Type, nameof(entity.Type));
    }
}
