// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public interface ICommandModule
{
    IList<Command> GetCommands();
}
