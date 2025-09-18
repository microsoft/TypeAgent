// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
namespace TypeAgent.KnowPro;

public interface IConversationSecondaryIndexes
{
    IPropertyToSemanticRefIndex PropertyToSemanticRefIndex { get; }
    ITermToRelatedTermIndex TermToRelatedTermsIndex { get; }
}
