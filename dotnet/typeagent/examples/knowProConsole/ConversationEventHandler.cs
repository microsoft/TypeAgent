// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace KnowProConsole;

public class ConversationEventHandler
{
    InplaceText _inplaceUpdate;
    string _prevEventType = string.Empty;
    Dictionary<string, Stopwatch?> _duration = [];
    const string FUZZY = "Fuzzy";
    const string MESSAGE = "Message";
    const string KNOWLEDGE = "Knowledge";

    public ConversationEventHandler()
    {
        _inplaceUpdate = new InplaceText();
    }

    public InplaceText Progress => _inplaceUpdate;

    public void Subscribe(IConversation conversation)
    {
        var secondaryIndexes = conversation.SecondaryIndexes;
        secondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.OnIndexed += this.FuzzyIndex_OnIndexed;
        secondaryIndexes.MessageIndex.OnIndexed += this.Message_OnIndexed;
        conversation.SemanticRefs.OnKnowledgeExtracted += this.KnowledgeExtractor_OnExtracted;
    }

    public void Unsubscribe(IConversation conversation)
    {
        var secondaryIndexes = conversation.SecondaryIndexes;
        secondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.OnIndexed -= this.FuzzyIndex_OnIndexed;
        secondaryIndexes.MessageIndex.OnIndexed -= this.Message_OnIndexed;
        conversation.SemanticRefs.OnKnowledgeExtracted -= this.KnowledgeExtractor_OnExtracted;
    }

    private void FuzzyIndex_OnIndexed(BatchProgress item)
    {
        if (!_duration.ContainsKey(FUZZY))
        {
            _duration[FUZZY] = Stopwatch.StartNew();
        }

        WriteProgress(item, FUZZY);
    }

    private void Message_OnIndexed(BatchProgress item)
    {
        if (!_duration.ContainsKey(MESSAGE))
        {
            _duration[MESSAGE] = Stopwatch.StartNew();
        }

        WriteProgress(item, MESSAGE);
    }

    private void KnowledgeExtractor_OnExtracted(BatchProgress item)
    {
        if (!_duration.ContainsKey(KNOWLEDGE))
        {
            _duration[KNOWLEDGE] = Stopwatch.StartNew();
        }

        WriteProgress(item, KNOWLEDGE);
    }

    private void WriteProgress(BatchProgress progress, string label)
    {
        if (_prevEventType != label)
        {
            ConsoleWriter.WriteLine();
            _prevEventType = label;
        }
        _inplaceUpdate.Write($"[{label}: {progress.CountCompleted} / {progress.Count}] [~{_duration[label]?.Elapsed.TotalSeconds:N1}s]");

        if (progress.CountCompleted == progress.Count)
        {
            ConsoleWriter.WriteLine();
            _duration.Remove(label);
        }
    }
}
