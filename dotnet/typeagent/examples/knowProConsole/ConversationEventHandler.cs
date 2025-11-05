// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class ConversationEventHandler
{
    InplaceText _inplaceUpdate;

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
        WriteProgress(item, "Fuzzy");
    }

    private void Message_OnIndexed(BatchProgress item)
    {
        WriteProgress(item, "Message");
    }

    private void KnowledgeExtractor_OnExtracted(BatchProgress item)
    {
        WriteProgress(item, "Knowledge");
    }

    private void WriteProgress(BatchProgress progress, string label)
    {
        _inplaceUpdate.Write($"[{label}: {progress.CountCompleted} / {progress.Count}]");
    }
}
