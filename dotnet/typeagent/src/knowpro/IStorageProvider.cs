// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IStorageProvider : IDisposable
{
    IMessageCollection Messages { get; }

    ISemanticRefCollection SemanticRefs { get; }

    ITermToSemanticRefIndex SemanticRefIndex { get; }

    IConversationSecondaryIndexes SecondaryIndexes { get; }

    IStorageTransaction BeginTransaction();
}

public interface IStorageProvider<TMessage> : IStorageProvider
    where TMessage : IMessage
{
    IMessageCollection<TMessage> TypedMessages { get; }
}

public interface IStorageTransaction : IDisposable
{
    Task CommitAsync();

    Task RollbackAsync();
}
