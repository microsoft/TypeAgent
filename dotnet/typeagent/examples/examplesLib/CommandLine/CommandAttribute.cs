// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

[AttributeUsage(AttributeTargets.Method)]
public class CommandAttribute : Attribute
{
    string? _name;
    public CommandAttribute()
    {
    }

    public CommandAttribute(string name)
    {
        Name = name;
    }

    public string? Name
    {
        get => _name;
        set
        {
            ArgumentVerify.ThrowIfNullOrEmpty(value, nameof(Name));
            _name = value;
        }
    }

    public bool HasName => !string.IsNullOrEmpty(_name);
}
