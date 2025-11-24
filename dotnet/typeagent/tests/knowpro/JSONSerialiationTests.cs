// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using TypeAgent.KnowPro;

namespace TypeAgent.Tests.KnowPro;

public class JSONSerialiationTests
{
    [Fact]
    public void TestDateValSerialization()
    {
        string json = /*lang=json*/ @"
        {
            ""day"": 1,
            ""month"": 1,
            ""year"": 1900
        }
        ";

        DateVal? d = JsonSerializer.Deserialize<DateVal>(json);
        Assert.True(d is not null);
        Assert.Equal(1, d.Day);
        Assert.Equal(1, d.Month);
        Assert.Equal(1900, d.Year);

        string txt = JsonSerializer.Serialize(d);

        Assert.Equal(json.Replace("\n", "").Replace(" ", ""), txt);
    }

    [Fact]
    public void TestTimeValSerialization()
    {
        string json = /*lang=json*/ @"
        {
            ""hour"": 11,
            ""minute"": 51,
            ""seconds"": 3
        }
        ";

        TimeVal? t = JsonSerializer.Deserialize<TimeVal>(json);
        Assert.True(t is not null);
        Assert.Equal(11, t.Hour);
        Assert.Equal(51, t.Minute);
        Assert.Equal(3, t.Seconds);

        string txt = JsonSerializer.Serialize(t);

        Assert.Equal(json.Replace("\n", "").Replace(" ", ""), txt);
    }

    [Fact]
    public void TestDateTimeSerialization()
    {
        string json = /*lang=json*/ @"
        {
            ""date"": {
                ""day"": 1,
                ""month"": 1,
                ""year"": 1900
            },
            ""time"": {
                ""hour"": 11,
                ""minute"": 51,
                ""seconds"": 3
            }
        }
        ";

        TypeAgent.KnowPro.DateTime? dateTime = JsonSerializer.Deserialize<TypeAgent.KnowPro.DateTime>(json);
        Assert.True(dateTime is not null);
        Assert.True(dateTime.Date is not null);
        Assert.True(dateTime.Time is not null);
        Assert.Equal(1, dateTime.Date.Day);
        Assert.Equal(1, dateTime.Date.Month);
        Assert.Equal(1900, dateTime.Date.Year);
        Assert.Equal(11, dateTime.Time.Hour);
        Assert.Equal(51, dateTime.Time.Minute);
        Assert.Equal(3, dateTime.Time.Seconds);

        string txt = JsonSerializer.Serialize(dateTime);

        Assert.Equal(json.Replace("\n", "").Replace(" ", ""), txt);
    }
}
