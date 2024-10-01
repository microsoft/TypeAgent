// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT License.


namespace TypeAgent.Email;

public static class Extensions
{
    public static void AppendHeader(this StringBuilder sb, string name, string value)
    {
        sb.Append(name);
        sb.Append(": ");
        sb.AppendLine(value);
    }

    public static string Join(this List<EmailAddress> list)
    {
        StringBuilder sb = new StringBuilder();
        for(int i = 0; i < list.Count; ++i)
        {
            var item = list[i];
            if (i > 0)
            {
                sb.Append(", ");
            }
            sb.Append(item.ToString());
        }
        return sb.ToString();
    }
}
