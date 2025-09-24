// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IStorageProvider<TMessage>
    where TMessage : IMessage
{
    IMessageCollection<TMessage> Messages { get; }
    ISemanticRefCollection SemanticRefs { get; }
    ITermToSemanticRefIndex SemanticRefIndex { get; }
    IPropertyToSemanticRefIndex PropertyIndex { get; }
}
