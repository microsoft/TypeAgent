// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IStorageProvider<TMessage>
    where TMessage : IMessage
{
    Task<IMessageCollection<TMessage>> GetMessageCollectionAsync();
    Task<ISemanticRefCollection> GetSemanticRefCollection();
}
