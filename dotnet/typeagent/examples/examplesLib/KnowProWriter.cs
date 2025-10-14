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
            KnowProWriter.WriteJson(message);
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
                KnowProWriter.WriteJson(sr);
            }
            WriteLine();
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

    public static void WriteKnowledgeSearchResults(
        IConversation conversation,
        IDictionary<KnowledgeType, SemanticRefSearchResult>? results
    )
    {
        if (results.IsNullOrEmpty())
        {
            WriteError("No results");
            return;
        }

        foreach (var kType in results!.Keys)
        {
            KnowProWriter.WriteKnowledgeSearchResult(conversation, kType, results[kType]);
            KnowProWriter.WriteLine();
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
