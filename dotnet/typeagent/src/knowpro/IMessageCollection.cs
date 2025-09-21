// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageCollection<TMessage, TMeta> : IAsyncCollection<TMessage>
    where TMessage : IMessage<TMeta>
    where TMeta: IMessageMetadata
{
}
