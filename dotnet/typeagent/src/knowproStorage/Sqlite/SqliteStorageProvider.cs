// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteStorageProvider<TMessage> : IStorageProvider<TMessage>
    where TMessage : IMessage
{
    public Task<IMessageCollection<TMessage>> GetMessageCollectionAsync()
    {
        throw new NotImplementedException();
    }

    public Task<ISemanticRefCollection> GetSemanticRefCollection()
    {
        throw new NotImplementedException();
    }
}
