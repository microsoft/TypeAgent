// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageCollection<TMessage> : IAsyncCollection<TMessage>
    where TMessage : IMessage
{
}

public interface IMessageCollection : IReadOnlyAsyncCollection<IMessage>
{

}
