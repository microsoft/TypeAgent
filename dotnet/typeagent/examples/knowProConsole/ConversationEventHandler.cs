// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace KnowProConsole;

public class ConversationEventHandler
{
    InplaceText _inplaceUpdate;
    Stopwatch? _duration = null;
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
        conversation.IndexingStarted += this.Conversation_IndexingStarted;
        conversation.IndexingCompleted += this.Conversation_IndexingCompleted;
        var secondaryIndexes = conversation.SecondaryIndexes;
        secondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.OnIndexed += this.FuzzyIndex_OnIndexed;
        secondaryIndexes.MessageIndex.OnIndexed += this.Message_OnIndexed;
        conversation.SemanticRefs.OnKnowledgeExtracted += this.KnowledgeExtractor_OnExtracted;
    }

    public void Unsubscribe(IConversation conversation)
    {
        conversation.IndexingStarted -= this.Conversation_IndexingStarted;
        conversation.IndexingCompleted -= this.Conversation_IndexingCompleted;
        var secondaryIndexes = conversation.SecondaryIndexes;
        secondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.OnIndexed -= this.FuzzyIndex_OnIndexed;
        secondaryIndexes.MessageIndex.OnIndexed -= this.Message_OnIndexed;
        conversation.SemanticRefs.OnKnowledgeExtracted -= this.KnowledgeExtractor_OnExtracted;
    }

    private void Conversation_IndexingCompleted(EventArgs obj)
    {
        _duration?.Stop();
    }

    private void Conversation_IndexingStarted(EventArgs obj)
    {
        StartTiming();
    }

    private void FuzzyIndex_OnIndexed(BatchProgress item)
    {
        WriteProgress(item, FUZZY);
    }

    private void Message_OnIndexed(BatchProgress item)
    {
        WriteProgress(item, MESSAGE);
    }

    private void KnowledgeExtractor_OnExtracted(BatchProgress item)
    {
        WriteProgress(item, KNOWLEDGE);
    }

    private void WriteProgress(BatchProgress progress, string label)
    {
        _inplaceUpdate.Write($"[{label}: {progress.CountCompleted} / {progress.Count}] [{_duration?.Elapsed.TotalSeconds:N1}s]");

        if (progress.CountCompleted == progress.Count)
        {
            ConsoleWriter.WriteLine();
            StartTiming();
        }
    }

    private void StartTiming()
    {
        _duration = Stopwatch.StartNew();
    }
}
