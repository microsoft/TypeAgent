// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

public partial class RelevantMessage
{
    public RelevantMessage() { }

    public RelevantMessage(IMessage message)
    {
        ArgumentVerify.ThrowIfNull(message, nameof(message));

        To = OneOrManyItem.Create(message.Metadata?.Dest);
        From = OneOrManyItem.Create(message.Metadata?.Source);
        Timestamp = message.Timestamp;
        MessageText = OneOrManyItem.Create(message.TextChunks);
    }
}

public partial class AnswerContext
{
    public string ToPromptString()
    {
        var json = new StringBuilder();
        json.Append("{\n");

        int propertyCount = 0;
        if (!Entities.IsNullOrEmpty())
        {
            propertyCount = AddPrompt(json, propertyCount, "entities", Entities);
        }
        if (!Topics.IsNullOrEmpty())
        {
            propertyCount = AddPrompt(json, propertyCount, "topics", Topics);
        }
        if (!Messages.IsNullOrEmpty())
        {
            propertyCount = AddPrompt(json, propertyCount, "messages", Messages);
        }
        json.Append("\n}");

        return json.ToString();
    }

    private int AddPrompt(StringBuilder text, int propertyCount, string name, object value)
    {
        if (propertyCount > 0)
        {
            text.Append(",\n");
        }
        var json = Serializer.ToJson(value);
        text.Append($"{name}: {json}");
        return propertyCount + 1;
    }
}
