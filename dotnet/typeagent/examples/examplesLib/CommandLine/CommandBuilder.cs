// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public static class Options
{
    public const string ArgPrefix = "--";

    public static Option<T> Create<T>(string name, string? description)
    {
        var option = new Option<T>(ArgPrefix + name);
        if (!string.IsNullOrEmpty(description))
        {
            option.Description = description;
        }
        return option;
    }

    public static Option<T> Arg<T>(string name, string? description = null) => Arg<T>(name, description, default!);

    public static Option<T> Arg<T>(string name, string? description, T defaultValue)
    {
        var option = Create<T>(name, description);
        option.DefaultValueFactory = (_) => (T)defaultValue;
        return option;
    }
}

public class Args
{
    public static Option<T> Arg<T>(string name, string description)
    {
        // Use default! to suppress CS8604 warning for possible null reference
        return Arg<T>(name, description, default!);
    }

    public static Option<T> Arg<T>(string name, string description, T? defaultValue)
    {
        var arg = defaultValue is not null
                ? Options.Arg<T>(name, description, defaultValue)
                : Options.Arg<T>(name, description);

        arg.Required = true;
        return arg;
    }
}
