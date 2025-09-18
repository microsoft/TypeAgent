// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageCollection<TMessage> : IAsyncCollection<TMessage, MessageOrdinal>
    where TMessage : IMessage<IMessageMetadata>
{
}
