// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Common;
using TypeAgent.ConversationMemory;
using TypeAgent.KnowPro;
using TypeAgent.KnowPro.Storage.Sqlite;

namespace TypeAgent.TestLib;

public class TestWithData : IDisposable
{
    protected DirectoryInfo _tempDir { get; set; }

    protected SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>? _sqliteDB { get; set; }

    protected Podcast? _podcast { get; set; }

    private bool _disposedValue;

    /// <summary>
    /// Test setup including loading .ENV settings and creating temporary folder for sqlite DB
    /// </summary>
    public TestWithData(bool loadDotEnv, bool loadTestPodcast = false)
    {
        _tempDir = Directory.CreateTempSubdirectory($"TypeAgent_{this.GetType().Name}");

        if (loadDotEnv)
        {
            TestHelpers.LoadDotEnvOrSkipTest();
        }

        if (loadTestPodcast)
        {
            // Load the test conversation database
            this._sqliteDB = new SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>(new ConversationSettings(), Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)!, "episode_53_adriantchaikovsky", false);
            this._podcast = new Podcast(new MemorySettings(), this._sqliteDB);
        }
    }

    /// <summary>
    /// Cleans up test data
    /// </summary>
    ~TestWithData()
    {
        Dispose(false);
    }

    #region IDisposable
    protected virtual void Dispose(bool disposing)
    {
        if (!_disposedValue)
        {
            if (disposing)
            {
                this._sqliteDB?.Dispose();
                this._podcast?.Dispose();

                Directory.Delete(_tempDir.FullName, true);
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
    #endregion IDisposable
}
