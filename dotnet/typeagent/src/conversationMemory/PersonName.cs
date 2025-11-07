// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class PersonName
{
    public PersonName(string fullName)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(fullName, nameof(fullName));

        Names = fullName.SplitWords(StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    public IList<string> Names { get; }

    public bool HasNames => !Names.IsNullOrEmpty();

    public string? FirstName => Names.GetOrNull(0);

    public string? LastName => Names.Count > 1 ? Names[^1] : null;
}
