// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteStorageProvider<TMessage, TMeta> : IStorageProvider<TMessage, TMeta>
    where TMessage : IMessage<TMeta>
    where TMeta : IMessageMetadata
{
    public Task<IMessageCollection<TMessage, TMeta>> GetMessageCollectionAsync()
    {
        throw new NotImplementedException();
    }

    public Task<ISemanticRefCollection> GetSemanticRefCollection()
    {
        throw new NotImplementedException();
    }
}
