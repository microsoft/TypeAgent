// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// Represents a cache for storing and retrieving conversation data, including semantic references and messages.
/// </summary>
public interface IConversationCache
{
    IAsyncCollectionReader<SemanticRef> SemanticRefs { get; }

    IAsyncCollectionReader<IMessage> Messages { get; }

    ITermToRelatedTermsFuzzyLookup RelatedTermsFuzzy { get; }
}
