// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Newtonsoft.Json.Linq;

namespace Microsoft.VisualStudio.Shell
{
    public class AsyncPackage
    {
    }
}

namespace Microsoft.TypeAgent.VisualStudio.Bridge
{
    internal sealed class DTEActionExecutor : IBridgeActionExecutor
    {
        public DTEActionExecutor(AsyncPackage package)
        {
        }

        public Task<object?> ExecuteAsync(
            string actionName,
            JObject parameters,
            CancellationToken cancellation) =>
            Task.FromResult<object?>(null);
    }
}
