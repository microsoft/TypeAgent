// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : Conversation<TMessage>, IMemory
    where TMessage : class, IMessage, new()
{

    public Memory(MemorySettings settings, IStorageProvider<TMessage> storageProvider)
        : base(settings.ConversationSettings, storageProvider)
    {
        Settings = settings;
    }

    public new MemorySettings Settings { get; }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }

    public NoiseText NoiseTerms { get; set; }

    private bool UseScoped => Settings.UseScopedSearch is not null && Settings.UseScopedSearch.Value;

    public async ValueTask<IList<ConversationSearchResult>> SearchAsync(
        string searchText,
        LangSearchOptions? options = null,
        LangSearchFilter? filter = null,
        LangSearchDebugContext? debugContext = null,
        CancellationToken cancellationToken = default
    )
    {
        options = AdjustLanguageSearchOptions(options);
        if (UseScoped)
        {
            // Using Structured Tags for scoping
            throw new NotImplementedException();
        }
        else
        {
            IConversation conversation = this;
            return await conversation.SearchAsync(
                searchText,
                options,
                filter,
                debugContext,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }

    public virtual IList<PromptSection>? GetModelInstructions()
    {
        return null;
    }

    private LangSearchOptions AdjustLanguageSearchOptions(LangSearchOptions? options)
    {
        // Clone options so we can edit them
        options = options is null
            ? LangSearchOptions.CreateTypical()
            : new LangSearchOptions(options);

        var instructions = GetModelInstructions();
        if (!instructions.IsNullOrEmpty())
        {
            if (!options.ModelInstructions.IsNullOrEmpty())
            {
                options.ModelInstructions.AddRange(instructions);
            }
            else
            {
                options.ModelInstructions = instructions;
            }
        }
        // Filter noise terms
        options.CompilerSettings.TermFilter = (t) =>
        {
            return NoiseTerms.IsNullOrEmpty() || !NoiseTerms.Contains(t);
        };

        return options;
    }
}
