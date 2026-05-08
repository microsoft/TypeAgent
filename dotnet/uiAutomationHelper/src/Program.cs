// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text;
using UiAutomationHelper.Methods;
using UiAutomationHelper.Rpc;

namespace UiAutomationHelper;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        var dispatch = new Dispatch();
        Methods.Register.All(dispatch);

        var server = new JsonRpcServer(Console.In, Console.Out, dispatch);
        Notifier.Init(server);
        await server.RunAsync(cts.Token).ConfigureAwait(false);
        return 0;
    }
}
