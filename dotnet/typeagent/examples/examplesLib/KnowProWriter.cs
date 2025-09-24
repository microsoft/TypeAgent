// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.ExamplesLib.CommandLine;

namespace TypeAgent.ExamplesLib;

public class KnowProWriter : ConsoleWriter
{
    public static void Write(ConcreteEntity entity)
    {
        if (entity is not null)
        {
            WriteLine(entity.Name.ToUpper());
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
