// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Topic = string;

export type AggregateTopicResponse = {
    status: "Success" | "None";
    topic: Topic;
};

export type ChildTopic = {
    name: string;
    level: number;
    parentName?: string;
};

export type TopicGroup = {
    rootTopic: string;
    children: ChildTopic[];
};

export type HierarchicalTopicResponse = {
    status: "Success" | "None";
    topicGroups: TopicGroup[];
};
