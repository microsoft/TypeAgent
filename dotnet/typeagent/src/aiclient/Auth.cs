// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;


public enum AzureTokenScopes
{
    CogServices = 0 // You can assign specific integer values if needed  
}

public class AzureTokenProvider : IApiTokenProvider, IDisposable
{
    public const int DefaultExpirationBufferMs = 5 * 60 * 1000;

    private static readonly AzureTokenProvider s_default;

    static AzureTokenProvider()
    {
        s_default = new AzureTokenProvider(AzureTokenScopes.CogServices);
    }

    public static AzureTokenProvider Default => s_default;

    private readonly TokenCredential _credential;
    private readonly string[] _scopes;
    private readonly int _expirationBufferMs;
    private AccessToken _accessToken;
    private SemaphoreSlim? _lock;

    public AzureTokenProvider(AzureTokenScopes scope, int expirationBufferMs = DefaultExpirationBufferMs)
        : this(GetScopes(scope), expirationBufferMs)
    {
    }

    public AzureTokenProvider(string[] scopes, int expirationBufferMs = DefaultExpirationBufferMs)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(scopes, nameof(scopes));
        _credential = new DefaultAzureCredential();
        _scopes = scopes;
        _expirationBufferMs = expirationBufferMs;
        _lock = new SemaphoreSlim(1, 1);
    }

    public async Task<string> GetAccessTokenAsync(CancellationToken cancelToken)
    {
        if (_accessToken.ExpiresOn <= DateTimeOffset.UtcNow.AddMilliseconds(_expirationBufferMs))
        {
            return await RefreshTokenAsync(cancelToken).ConfigureAwait(false);
        }
        return _accessToken.Token;
    }

    public object GetCredential()
    {
        return _credential;
    }

    public async Task<string> RefreshTokenAsync(CancellationToken cancelToken)
    {
        await _lock!.WaitAsync(cancelToken).ConfigureAwait(false);
        try
        {
            _accessToken = await _credential.GetTokenAsync(new TokenRequestContext(_scopes), cancelToken).ConfigureAwait(false);
            _accessToken = new AccessToken(_accessToken.Token, _accessToken.ExpiresOn.AddMilliseconds(-_expirationBufferMs));
            return _accessToken.Token;
        }
        finally
        {
            _lock!.Release();
        }
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool fromDispose)
    {
        if (fromDispose)
        {
            _lock?.Dispose();
        }
        _lock = null;
    }

    private static string[] GetScopes(AzureTokenScopes scope)
    {
        return scope switch
        {
            AzureTokenScopes.CogServices => ["https://cognitiveservices.azure.com/.default"],
            _ => throw new ArgumentOutOfRangeException(nameof(scope), "Unsupported Azure token scope.")
        };
    }
}
