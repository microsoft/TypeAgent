// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IStorageProvider<TMessage, TMeta>
    where TMessage : IMessage<TMeta>
    where TMeta : IMessageMetadata
{
    Task<IMessageCollection<TMessage, TMeta>> GetMessageCollectionAsync();
    Task<ISemanticRefCollection> GetSemanticRefCollection();
}
