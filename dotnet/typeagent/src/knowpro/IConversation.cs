// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// For IConversation levelAPIs:
/// <see cref="ConversationAPI"/>
/// </summary>
/// <typeparam name="TMessage"></typeparam>
public interface IConversation<TMessage> : IDisposable
    where TMessage : IMessage
{
    IMessageCollection<TMessage> Messages { get; }

    ISemanticRefCollection SemanticRefs { get; }

    ITermToSemanticRefIndex SemanticRefIndex { get; }

    IConversationSecondaryIndexes SecondaryIndexes { get; }
}


public interface IConversation
{
    IMessageCollection Messages { get; }

    ISemanticRefCollection SemanticRefs { get; }

    ITermToSemanticRefIndex SemanticRefIndex { get; }

    IConversationSecondaryIndexes SecondaryIndexes { get; }
}
