// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
namespace TypeAgent.KnowPro;

public interface IConversationSecondaryIndexes
{
    IPropertyToSemanticRefIndex PropertyToSemanticRefIndex { get; }

    ITimestampToTextRangeIndex TimestampIndex { get; }

    ITermToRelatedTermIndex TermToRelatedTermsIndex { get; }

    IMessageTextIndex MessageIndex { get; }
}
