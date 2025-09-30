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
                WriteLine(sr.Knowledge as ConcreteEntity);
            }
            else
            {
                KnowProWriter.WriteJson(sr);
            }
            WriteLine();
        }
    }

    public static void WriteLine(ConcreteEntity? entity)
    {
        if (entity is not null)
        {
            WriteLine(entity.Name.ToUpper());
            WriteList(entity.Type, new ListOptions() { Type = ListType.Csv });
            if (!entity.Facets.IsNullOrEmpty())
            {
                var facetList = entity.Facets!.Map((f) => f.ToString());
                WriteList(facetList, new ListOptions() { Type = ListType.Ul });
            }
        }
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
