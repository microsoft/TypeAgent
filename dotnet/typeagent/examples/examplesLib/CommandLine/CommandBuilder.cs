// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public static class Options
{
    public const string ArgPrefix = "--";

    public static Option<T> Create<T>(string name, string description)
    {
        var option = new Option<T>(ArgPrefix + name);
        if (!string.IsNullOrEmpty(description))
        {
            option.Description = description;
        }
        return option;
    }

    public static Option<T> Arg<T>(string name, string description) => Create<T>(name, description);

    public static Option<T> Arg<T>(string name, string description, T? defaultValue)
    {
        var option = Create<T>(name, description);
        if (defaultValue is not null)
        {
            option.DefaultValueFactory = (_) => (T)defaultValue;
        }
        return option;
    }
}

public class Args
{
    public static Option<T> Arg<T>(string name, string description)
    {
        var arg = Options.Arg<T>(name, description);
        arg.Required = true;
        return arg;
    }

    public static Option<T> Arg<T>(string name, string description, T? defaultValue)
    {
        var arg = Options.Arg<T>(name, description, defaultValue);
        arg.Required = true;
        return arg;
    }
}
