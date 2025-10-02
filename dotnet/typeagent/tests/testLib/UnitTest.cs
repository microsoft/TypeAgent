// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.TestLib;

public class UnitTest
{
    readonly ITestOutputHelper? _output;

    public UnitTest(ITestOutputHelper? output = null)
    {
        _output = output;
    }

    public ITestOutputHelper? Output => _output;

    public void WriteLine(string message)
    {
        if (_output != null)
        {
            _output.WriteLine(message);
        }
        else
        {
            Trace.WriteLine(message);
        }
    }

    public string? GetEnv(string name)
    {
        return Environment.GetEnvironmentVariable(name);
    }
}
