// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading.Tasks;
using TypeAgent.ExamplesLib.CommandLine;

namespace TypeAgent.ExamplesLib;

public class KnowProWriter : ConsoleWriter
{
    public static void WriteTerm(Term term)
    {
        if (term.Weight is not null)
        {
            WriteLine($"{term.Text} [{term.Weight.Value}]");
        }
        else
        {
            WriteLine(term.Text);
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

    public static async Task WriteMessagesAsync(IConversation conversation)
    {
        await foreach (var message in conversation.Messages)
        {
            WriteMessage(message);
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

    public static void WriteAction(TypeAgent.KnowPro.Action? action)
    {
        if (action is not null)
        {
            WriteLine(action.ToString());
        }
    }

    public static void WriteTopic(Topic? topic)
    {
        if (topic is not null)
        {
            WriteLine(topic.Text);
        }
    }

    public static void WriteTag(Tag tag)
    {
        if (tag is not null)
        {
            WriteLine(tag.Text);
        }
    }

    public static async Task WriteConversationSearchResultsAsync(
            IConversation conversation,
            ConversationSearchResult? searchResult,
            bool showKnowledge,
            bool showMessages,
            bool verbose = false
    )
    {
        if (searchResult is null)
        {
            WriteError("No conversation search results");
            return;
        }

        if (!searchResult.MessageMatches.IsNullOrEmpty())
        {
            if (verbose)
            {
                foreach (var match in searchResult.MessageMatches)
                {
                    var message = await conversation.Messages.GetAsync(match.MessageOrdinal);
                    WriteNameValue("MessageOrdinal", match.MessageOrdinal);
                    WriteMessage(message);
                    WriteLine();
                }
            }
            else
            {
                WriteLineHeading("Message Ordinals");
                WriteScoredMessageOrdinals(conversation, searchResult.MessageMatches);
            }
        }
        if (!searchResult.KnowledgeMatches.IsNullOrEmpty())
        {
            WriteLineHeading("Knowledge");
            await WriteKnowledgeSearchResultsAsync(conversation, searchResult.KnowledgeMatches);
        }
    }

    public static void WriteScoredMessageOrdinals(
        IConversation conversation,
        IList<ScoredMessageOrdinal> messageOrdinals
    )
    {
        WriteLine($"{messageOrdinals.Count} matches");
        WriteJson(messageOrdinals);
    }

    public static async Task WriteKnowledgeSearchResultsAsync(
        IConversation conversation,
        IDictionary<KnowledgeType, SemanticRefSearchResult>? results,
        int? maxToDisplay = null,
        bool isAsc = false
    )
    {
        if (results.IsNullOrEmpty())
        {
            WriteError("No knowledge results");
            return;
        }

        foreach (var kv in results!)
        {
            await WriteKnowledgeSearchResultAsync(conversation, kv.Key, kv.Value, maxToDisplay, isAsc);
            WriteLine();
        }
    }

    public static async Task WriteKnowledgeSearchResultAsync(
        IConversation conversation,
        KnowledgeType kType,
        SemanticRefSearchResult result,
        int? maxToDisplay = null,
        bool isAsc = true
    )
    {
        WriteLineUnderline(kType.ToString().ToUpper());
        InColor(ConsoleColor.Cyan, () => WriteList(
            result.TermMatches,
            "Matched terms",
            ListType.Ol)
        );
        WriteLine($"{result.SemanticRefMatches.Count} matches");

        await WriteScoredSemanticRefsAsync(
            result.SemanticRefMatches,
            conversation.SemanticRefs,
            kType,
            maxToDisplay is not null ? maxToDisplay.Value : result.SemanticRefMatches.Count,
            isAsc
        );
    }

    public static void WriteSemanticRef(SemanticRef sr)
    {
        switch (sr.KnowledgeType)
        {
            default:
                break;

            case KnowledgeType.EntityTypeName:
            case KnowledgeType.STagTypeName:
                WriteEntity(sr.AsEntity());
                break;

            case KnowledgeType.ActionTypeName:
                WriteAction(sr.AsAction());
                break;

            case KnowledgeType.TopicTypeName:
                WriteTopic(sr.AsTopic());
                break;

            case KnowledgeType.TagTypeName:
                WriteTag(sr.AsTag());
                break;
        }
    }

    public static async Task WriteScoredSemanticRefsAsync(
        IList<ScoredSemanticRefOrdinal> semanticRefMatches,
        ISemanticRefCollection semanticRefCollection,
        KnowledgeType kType,
        int maxToDisplay,
        bool isAsc = true
    )
    {
        if (isAsc)
        {
            WriteLine("Sorted in ascending order(lowest first)");
        }

        var matchesToDisplay = semanticRefMatches.Slice(0, maxToDisplay);
        WriteLine($"Displaying {matchesToDisplay.Count} matches of total {semanticRefMatches.Count}");

        if (kType == KnowledgeType.Entity)
        {
            IList<Scored<ConcreteEntity>> entities = await semanticRefCollection.GetDistinctEntitiesAsync(matchesToDisplay);
            for (int i = 0; i < entities.Count; ++i)
            {
                var pos = isAsc ? matchesToDisplay.Count - (i + 1) : i;
                WriteLine(
                    ConsoleColor.Green,
                    $"{pos + 1} / {matchesToDisplay.Count}: [{entities[i].Score}]"
                );
                WriteEntity(entities[i]);
                WriteLine();
            }
        }
        else
        {
            IList<SemanticRef> semanticRefs = await semanticRefCollection.GetAsync(matchesToDisplay);
            for (int i = 0; i < matchesToDisplay.Count; ++i)
            {
                var pos = isAsc ? matchesToDisplay.Count - (i + 1) : i;
                WriteScoredRef(
                    pos,
                    matchesToDisplay.Count,
                    matchesToDisplay[pos],
                    semanticRefs[pos]
                );
            }
        }

    }

    public static void WriteScoredRef(
        int matchNumber,
        int totalMatches,
        ScoredSemanticRefOrdinal scoredRef,
        SemanticRef semanticRef
    )
    {
        WriteLine(
            ConsoleColor.Green,
            $"#{matchNumber + 1} / {totalMatches}: <{scoredRef.SemanticRefOrdinal}::{semanticRef.Range.Start.MessageOrdinal}> {semanticRef.KnowledgeType} [{scoredRef.Score}]"
        );
        WriteSemanticRef(semanticRef);
        WriteLine();
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
