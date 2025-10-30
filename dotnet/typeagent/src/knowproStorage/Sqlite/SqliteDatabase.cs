// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Runtime.CompilerServices;

namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteDatabase : IDisposable
{
    public const int MaxBatchSize = 999;

    private SqliteConnection _connection;

    public SqliteDatabase(string filePath, bool createNew = false)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(filePath, nameof(filePath));

        if (createNew)
        {
            DeleteDatabase(filePath);
        }
        _connection = new SqliteConnection(ConnectionString(filePath));
        _connection.Open();
    }

    public SqliteCommand CreateCommand(string sql)
    {
        var cmd = _connection.CreateCommand();
        cmd.CommandText = sql;
        return cmd;
    }

    public void Execute(string commandText)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(commandText, nameof(commandText));

        using var command = _connection.CreateCommand();
        command.CommandText = commandText;
        command.ExecuteNonQuery();
    }

    public T Get<T>(string sql, Action<SqliteCommand>? addParams, Func<SqliteDataReader, T> rowDeserializer)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = sql;
        if (addParams is not null)
        {
            addParams(cmd);
        }
        using var reader = cmd.ExecuteReader();
        return !reader.Read()
            ? throw new KnowProException(KnowProException.ErrorCode.StorageProviderDataNotFound, cmd.ToLogString())
            : rowDeserializer(reader);
    }

    public object? GetOne(string commandText)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(commandText, nameof(commandText));

        using var command = _connection.CreateCommand();
        command.CommandText = commandText;
        return command.ExecuteScalar();
    }

    public List<T> GetList<T>(string commandText, Func<SqliteDataReader, T> cb)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(commandText, nameof(commandText));

        using var command = CreateCommand(commandText);
        using var reader = command.ExecuteReader();
        return reader.GetList<T>(cb);
    }

    public List<T>? GetListOrNull<T>(string commandText, Func<SqliteDataReader, T> cb)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(commandText, nameof(commandText));

        using var command = CreateCommand(commandText);
        using var reader = command.ExecuteReader();
        return reader.GetListOrNull<T>(cb);
    }

    public IEnumerable<T> Enumerate<T>(
        string sql,
        Action<SqliteCommand> addParams,
        Func<SqliteDataReader, T> rowDeserializer
    )
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = sql;
        if (addParams is not null)
        {
            addParams(cmd);
        }
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            yield return rowDeserializer(reader);
        }
    }

    public IEnumerable<T> Enumerate<T>(string sql, Func<SqliteDataReader, T> rowDeserializer)
    {
        return Enumerate<T>(sql, null, rowDeserializer);
    }

    public IEnumerable<KeyValuePair<int, NormalizedEmbeddingB>> EnumerateEmbeddings(string sql)
    {
        return Enumerate<KeyValuePair<int, NormalizedEmbeddingB>>(
            sql,
            reader => new(reader.GetInt32(0), reader.GetNormalizedEmbedding(1))
        );
    }
    
    public IAsyncEnumerable<T> EnumerateAsync<T>(
        string sql,
        Func<SqliteDataReader, T> rowDeserializer,
        CancellationToken cancellationToken = default
    )
    {
        return EnumerateAsync(sql, null, rowDeserializer, cancellationToken);
    }

    public async IAsyncEnumerable<T> EnumerateAsync<T>(
        string sql,
        Action<SqliteCommand>? addParams,
        Func<SqliteDataReader, T> rowDeserializer,
        [EnumeratorCancellation]
        CancellationToken cancellationToken = default
    )
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = sql;
        if (addParams is not null)
        {
            addParams(cmd);
        }
        using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            yield return rowDeserializer(reader);
        }
    }

    public int GetCount(string tableName)
    {
        string sql = $"SELECT COUNT(*) FROM {tableName}";
        long count = (long)(GetOne(sql) ?? 0);
        return (int)count;
    }

    public void ClearTable(string tableName)
    {
        using var cmd = CreateCommand($"DELETE FROM {tableName}");
        cmd.ExecuteNonQuery();
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool fromDispose)
    {
        if (fromDispose && _connection is not null)
        {
            _connection.Dispose();
            // Without an explicit call to ClearPool, the connection is held onto and the file remains open
            SqliteConnection.ClearPool(_connection);
            _connection = null;
        }
    }

    public static string ConnectionString(string filePath)
    {
        return $"Data Source={filePath}";
    }

    public static void DeleteDatabase(string filePath)
    {
        FileExtensions.RemoveFiles(
            filePath,
            filePath + "-shm",
            filePath + "-wal"
        );
    }

    internal static string[] MakeInPlaceholderParamIds(int count, string prefix = "@id")
    {
        ArgumentVerify.ThrowIfLessThanEqual(count, 0, nameof(count));

        string[] ids = new string[count];
        for (int i = 0; i < count; ++i)
        {
            ids[i] = $"@id{i}";
        }
        return ids;
    }

    internal static string MakeInStatement(string[] placeholderIds)
    {
        return string.Join(", ", placeholderIds);
    }
}

