// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IConversation<TMessage>
    where TMessage : IMessage
{
    string Name { get; }
    IReadOnlyList<string> Tags { get; }
    IMessageCollection<TMessage> Messages { get; }
    ISemanticRefCollection SemanticRefs { get; }
    ITermToSemanticRefIndex SemanticRefIndex { get; }
    IConversationSecondaryIndexes SecondaryIndexes { get; }
}
