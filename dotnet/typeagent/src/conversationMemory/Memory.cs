// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : Conversation<TMessage>
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

    public ValueTask SearchWithLanguageAsync(
        string searchText,
        LangSearchOptions? options = null,
        LangSearchFilter? filter = null,
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
            return this.SearchWithLanguageAsync(searchText, options, filter, cancellationToken);
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
            return !NoiseTerms.IsNullOrEmpty() && NoiseTerms.Contains(t);
        };

        return options;
    }
}
