// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";

// metadata for podcast messages

export class PodcastMessageMeta
    implements kp.IKnowledgeSource, kp.IMessageMetadata
{
    public listeners: string[] = [];

    constructor(public speaker?: string | undefined) {}

    public get source() {
        return this.speaker;
    }

    public get dest() {
        return this.listeners;
    }

    getKnowledge() {
        if (this.speaker === undefined) {
            return {
                entities: [],
                actions: [],
                inverseActions: [],
                topics: [],
            };
        } else {
            const entities: kpLib.ConcreteEntity[] = [];
            entities.push({
                name: this.speaker,
                type: ["person"],
            } as kpLib.ConcreteEntity);
            const listenerEntities = this.listeners.map((listener) => {
                return {
                    name: listener,
                    type: ["person"],
                } as kpLib.ConcreteEntity;
            });
            entities.push(...listenerEntities);
            const actions: kpLib.Action[] = [];
            for (const listener of this.listeners) {
                actions.push({
                    verbs: ["say"],
                    verbTense: "past",
                    subjectEntityName: this.speaker,
                    objectEntityName: listener,
                } as kpLib.Action);
            }
            return {
                entities,
                actions,
                // TODO: Also create inverse actions
                inverseActions: [],
                topics: [],
            };
        }
    }
}

export class PodcastMessage implements kp.IMessage {
    constructor(
        public textChunks: string[],
        public metadata: PodcastMessageMeta,
        public tags: string[] = [],
        public timestamp: string | undefined = undefined,
    ) {}

    public getKnowledge(): kpLib.KnowledgeResponse {
        return this.metadata.getKnowledge();
    }

    public addContent(content: string, chunkOrdinal = 0) {
        if (chunkOrdinal > this.textChunks.length) {
            this.textChunks.push(content);
        } else {
            this.textChunks[chunkOrdinal] += content;
        }
    }
}
