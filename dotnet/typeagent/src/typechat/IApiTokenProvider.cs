// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

public interface IApiTokenProvider
{
    Task<string> GetAccessTokenAsync(CancellationToken cancelToken);
    object GetCredential();
}
