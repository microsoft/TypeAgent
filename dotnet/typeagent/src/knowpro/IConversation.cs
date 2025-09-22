// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IConversation<TMessage, TMeta>
    where TMessage : IMessage<TMeta>
    where TMeta: IMessageMetadata
{
    string Name { get; }
    IReadOnlyList<string> Tags { get; }
    IMessageCollection<TMessage, TMeta> Messages { get; }
    ISemanticRefCollection SemanticRefs { get; }
    ITermToSemanticRefIndex SemanticRefIndex { get; }
    IConversationSecondaryIndexes SecondaryIndexes { get; }
}
