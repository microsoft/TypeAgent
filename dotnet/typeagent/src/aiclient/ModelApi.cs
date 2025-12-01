// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class ModelApi : IDisposable
{
    private bool _disposedValue;

    public ModelApi(ModelApiSettings settings, HttpClient ? client = null)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));

        Settings = settings;
        Client = client ?? new HttpClient();

        ConfigureClient();
    }

    public ModelApiSettings Settings { get; }

    public HttpClient Client { get; }

    private void ConfigureClient()
    {
        Settings.Configure(Client);
        if (Settings.TimeoutMs > 0)
        {
            Client.Timeout = TimeSpan.FromMilliseconds(Settings.TimeoutMs);
        }
    }

    protected virtual void Dispose(bool disposing)
    {
        if (!_disposedValue)
        {
            if (disposing)
            {
                this.Client.Dispose();
            }

            _disposedValue = true;
        }
    }

    public void Dispose()
    {
        // Do not change this code. Put cleanup code in 'Dispose(bool disposing)' method
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }
}
