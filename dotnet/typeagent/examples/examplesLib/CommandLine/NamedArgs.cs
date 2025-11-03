// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public class NamedArgs : INamedArgs
{
    string _argPrefix;
    ParseResult _args;

    public NamedArgs(ParseResult args, string? argPrefix = null)
    {
        ArgumentVerify.ThrowIfNull(args,nameof(args));
        _args = args;
        _argPrefix = argPrefix ?? Options.ArgPrefix;
    }

    public string? Get(string name)
    {
        return Get<string>(name);
    }

    public string GetRequired(string name)
    {
        string? value = Get(name);
        ArgumentVerify.ThrowIfNullOrEmpty(value, name);
        return value!;
    }

    public T? Get<T>(string name)
    {
        return _args.GetValue<T>(_argPrefix + name);
    }
}
