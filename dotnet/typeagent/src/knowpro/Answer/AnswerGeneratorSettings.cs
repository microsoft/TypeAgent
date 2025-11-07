// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Answer;

/// <summary>
/// Settings for answer generation (C# translation of the TypeScript AnswerGeneratorSettings).
/// </summary>
public sealed class AnswerGeneratorSettings
{
    public AnswerGeneratorSettings(IChatModel model)
        : this(model, model)
    {
    }

    public AnswerGeneratorSettings(IChatModel generatorModel, IChatModel combinerModel)
    {
        ArgumentVerify.ThrowIfNull(generatorModel, nameof(generatorModel));
        ArgumentVerify.ThrowIfNull(combinerModel, nameof(combinerModel));

        GeneratorModel = generatorModel;
        CombinerModel = combinerModel;
    }

    /// <summary>
    /// Model used to generate answers from context.
    /// </summary>
    public IChatModel GeneratorModel { get; }

    /// <summary>
    /// Model used to combine multiple partial answers (e.g. rewriting / merging).
    /// Defaults to <see cref="AnswerGeneratorModel"/> if not explicitly supplied.
    /// </summary>
    public IChatModel CombinerModel { get; }

    /// <summary>
    /// Maximum number of characters allowed in the context for any given call.
    /// (Default mirrors TS: 4096 tokens * ~4 chars per token).
    /// </summary>
    public int MaxCharsInBudget { get; set; } = 4096 * 4;

    /// <summary>
    /// When chunking, number of chunks processed in parallel.
    /// </summary>
    public int Concurrency { get; set; } = 2;

    /// <summary>
    /// Stop processing early if an answer is already found using just knowledge chunks.
    /// </summary>
    public bool FastStop { get; set; } = true;

    /// <summary>
    /// Additional instructions (prompt sections) prepended when invoking the model.
    /// </summary>
    public IList<IPromptSection>? ModelInstructions { get; set; }
}
