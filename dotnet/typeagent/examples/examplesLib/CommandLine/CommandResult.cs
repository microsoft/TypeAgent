// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public struct CommandResult
{
    int _code;

    private CommandResult(int code)
    {
        _code = code;
    }

    public readonly int Code => _code;

    public static implicit operator int(CommandResult result)
    {
        return result.Code;
    }

    public static readonly CommandResult Success = new CommandResult(0);
    public static readonly CommandResult Error = new CommandResult(1);
    public static readonly CommandResult Stop = new CommandResult(-1);
    public static readonly CommandResult NotHandled = new CommandResult(-2);
}
