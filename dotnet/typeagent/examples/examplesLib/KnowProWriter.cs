// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.ExamplesLib.CommandLine;

namespace TypeAgent.ExamplesLib;

public class KnowProWriter : ConsoleWriter
{
    public static async Task WriteMessagesAsync(IConversation conversation)
    {
        await foreach (var message in conversation.Messages)
        {
            WriteMessage(message);
            WriteLine();
        }
    }

    public static async Task WriteSemanticRefsAsync(IConversation conversation)
    {
        await foreach (var sr in conversation.SemanticRefs)
        {
            if (sr.KnowledgeType == KnowledgeType.Entity)
            {
                WriteEntity(sr.Knowledge as ConcreteEntity);
            }
            else
            {
                WriteJson(sr);
            }
            WriteLine();
        }
    }

    public static void WriteMessage(IMessage message)
    {
        PushColor(ConsoleColor.Cyan);
        WriteNameValue("Timestamp", message.Timestamp);
        if (!message.Tags.IsNullOrEmpty())
        {
            // TODO:write tag
        }
        WriteMetadata(message);
        PopColor();

        foreach (var chunk in message.TextChunks)
        {
            Write(chunk);
        }
        WriteLine();
    }

    public static void WriteMetadata(IMessage message)
    {
        if (message.Metadata is not null)
        {
            Write("Metadata: ");
            WriteJson(message.Metadata);
        }
    }

public static void WriteEntity(ConcreteEntity? entity)
    {
        if (entity is not null)
        {
            WriteLine(entity.Name.ToUpper());
            WriteList(entity.Type, ListType.Csv);
            if (!entity.Facets.IsNullOrEmpty())
            {
                var facetList = entity.Facets!.Map((f) => f.ToString());
                WriteList(facetList, ListType.Ul);
            }
        }
    }

    public static void WriteConversationSearchResults(IConversation conversation, ConversationSearchResult? searchResult)
    {
        if (searchResult is null)
        {
            WriteError("No conversation search results");
            return;
        }

        if (!searchResult.MessageMatches.IsNullOrEmpty())
        {
            WriteLineHeading("Message Ordinals");
            WriteScoredMessagesAsync(conversation, searchResult.MessageMatches);
        }
        if (!searchResult.KnowledgeMatches.IsNullOrEmpty())
        {
            WriteLineHeading("Knowledge");
            WriteKnowledgeSearchResults(conversation, searchResult.KnowledgeMatches);
        }
    }

    public static void WriteScoredMessagesAsync(IConversation conversation, IList<ScoredMessageOrdinal> messageOrdinals)
    {
        WriteLine($"{messageOrdinals.Count} matches");
        WriteJson(messageOrdinals);
    }

    public static void WriteKnowledgeSearchResults(
        IConversation conversation,
        IDictionary<KnowledgeType, SemanticRefSearchResult>? results
    )
    {
        if (results.IsNullOrEmpty())
        {
            WriteError("No knowledge results");
            return;
        }

        foreach (var kv in results!)
        {
            WriteKnowledgeSearchResult(conversation, kv.Key, kv.Value);
            WriteLine();
        }
    }

    public static void WriteKnowledgeSearchResult(
        IConversation conversation,
        KnowledgeType kType,
        SemanticRefSearchResult result
    )
    {
        WriteLineUnderline(kType.ToString().ToUpper());
        InColor(ConsoleColor.Cyan, () => WriteList(
            result.TermMatches,
            "Matched terms",
            ListType.Ol)
        );
        WriteLine($"{result.SemanticRefMatches.Count} matches");
        WriteJson(result.SemanticRefMatches);
    }

    public static void WriteDataFileStats<TMessage>(ConversationData<TMessage> data)
        where TMessage : IMessage
    {
        WriteLine($"Message count: {data.Messages.GetCount()}");
        WriteLine($"SemanticRefs count: {data.SemanticRefs.GetCount()}");
        if (data.SemanticIndexData is not null)
        {
            WriteLine($"SemanticRefIndex count: {data.SemanticIndexData.Items.GetCount()}");
        }
        else
        {
            WriteLine($"SemanticRefIndex count: 0");
        }
    }
}
