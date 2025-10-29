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
        conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.OnIndexed += this.FuzzyIndex_OnIndexed;
    }

    public void Unsubscribe(IConversation conversation)
    {
        conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.OnIndexed -= this.FuzzyIndex_OnIndexed;
    }

    private void FuzzyIndex_OnIndexed(BatchItem<string> item)
    {
        WriteProgress(item, "Fuzzy");
    }

    private void WriteProgress(BatchItem<string> item, string label)
    {
        _inplaceUpdate.Write($"[{label}: {item.Pos + 1} / {item.Count}]");
    }
}
