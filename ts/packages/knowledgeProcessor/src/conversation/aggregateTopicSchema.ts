// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Topic = string;

export type AggregateTopicResponse = {
    status: "Success" | "None";
    // topic
    topic: Topic;
};
