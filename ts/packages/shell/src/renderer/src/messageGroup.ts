// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent } from "@typeagent/agent-sdk";
import { IAgentMessage } from "agent-dispatcher";
import { RequestMetrics } from "agent-dispatcher";

import {
    createTimestampDiv,
    MessageContainer,
    updateMetrics,
    updateMetricsVisibility,
} from "./messageContainer";
import { ChatView } from "./chatView";
import { setContent } from "./setContent";

export class MessageGroup {
    public readonly userMessageContainer: HTMLDivElement;
    public readonly userMessageBody: HTMLDivElement;
    public readonly userMessage: HTMLDivElement;
    public metricsDiv?: {
        mainMetricsDiv: HTMLDivElement;
        markMetricsDiv: HTMLDivElement;
    };
    private statusMessage: MessageContainer | undefined;
    private readonly agentMessages: MessageContainer[] = [];
    private readonly start: number = performance.now();
    constructor(
        private readonly chatView: ChatView,
        request: DisplayContent,
        container: HTMLDivElement,
        requestPromise: Promise<RequestMetrics | undefined> | undefined,
        timeStamp: Date,
        public agents: Map<string, string>,
        private hideMetrics: boolean,
    ) {
        const userMessageContainer = document.createElement("div");
        userMessageContainer.className = "chat-message-right";

        const timeStampDiv = createTimestampDiv(
            timeStamp,
            "chat-timestamp-right",
        );
        userMessageContainer.appendChild(timeStampDiv);

        const userMessageBody = document.createElement("div");
        const bodyClass = this.hideMetrics
            ? "chat-message-body-hide-metrics"
            : "chat-message-body";
        userMessageBody.className = `${bodyClass} chat-message-user`;
        userMessageContainer.appendChild(userMessageBody);

        const userMessage = document.createElement("div");
        userMessage.className = "chat-message-content";
        userMessageBody.appendChild(userMessage);

        setContent(userMessage, request);

        if (container.firstChild) {
            container.firstChild.before(userMessageContainer);

            userMessageContainer.scrollIntoView(false);
        } else {
            container.append(userMessageContainer);
        }

        this.userMessageContainer = userMessageContainer;
        this.userMessageBody = userMessageBody;
        this.userMessage = userMessage;

        this.chatView.tts?.stop();

        if (requestPromise) {
            requestPromise
                .then((metrics) => this.requestCompleted(metrics))
                .catch((error) => this.requestException(error));
        }
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        updateMetricsVisibility(visible, this.userMessageBody);
        this.statusMessage?.setMetricsVisible(visible);
        for (const agentMessage of this.agentMessages) {
            agentMessage.setMetricsVisible(visible);
        }
    }
    private requestCompleted(metrics: RequestMetrics | undefined) {
        this.updateMetrics(metrics);
        if (this.statusMessage === undefined) {
            this.addStatusMessage(
                { message: "Command completed", source: "shell" },
                false,
            );
        } else {
            this.statusMessage.complete();
            this.chatView.updateScroll();
        }
    }

    private requestException(error: any) {
        console.error(error);
        this.addStatusMessage(
            { message: `Processing Error: ${error}`, source: "shell" },
            false,
        );
    }

    private ensureStatusMessage(source: string) {
        if (this.statusMessage === undefined) {
            this.statusMessage = new MessageContainer(
                this.chatView,
                "agent",
                source,
                this.agents,
                this.userMessageContainer,
                this.hideMetrics,
                this.start,
                true,
            );
        }

        return this.statusMessage;
    }

    public addStatusMessage(msg: IAgentMessage, temporary: boolean) {
        let message = msg.message;
        const statusMessage = this.ensureStatusMessage(msg.source);
        statusMessage.setMessage(
            message,
            msg.source,
            temporary ? "temporary" : "block",
        );

        this.updateMetrics(msg.metrics);
        this.chatView.updateScroll();
    }

    public updateMetrics(metrics?: RequestMetrics) {
        if (metrics) {
            if (metrics.parse !== undefined) {
                if (this.metricsDiv === undefined) {
                    const metricsContainer = document.createElement("div");
                    metricsContainer.className =
                        "chat-message-metrics chat-message-metrics-right";
                    this.userMessageBody.append(metricsContainer);

                    const metricsDetails = document.createElement("div");
                    metricsDetails.className = "metrics-details";
                    metricsContainer.append(metricsDetails);

                    const left = document.createElement("div");
                    metricsDetails.append(left);
                    const right = document.createElement("div");
                    metricsDetails.append(right);
                    this.metricsDiv = {
                        mainMetricsDiv: right,
                        markMetricsDiv: left,
                    };
                }
                updateMetrics(
                    this.metricsDiv.mainMetricsDiv,
                    this.metricsDiv.markMetricsDiv,
                    "Translation",
                    metrics.parse,
                );
            }

            this.statusMessage?.updateMainMetrics(
                metrics.command,
                this.agentMessages.length === 0 ? metrics.duration : undefined,
            );

            for (let i = 0; i < this.agentMessages.length; i++) {
                const agentMessage = this.agentMessages[i];
                const info = metrics.actions[i];
                agentMessage.updateMainMetrics(
                    info,
                    i === this.agentMessages.length - 1
                        ? metrics.duration
                        : undefined,
                );
            }
        }
    }

    public ensureAgentMessage(msg: IAgentMessage, notification = false) {
        const statusMessage = this.ensureStatusMessage(msg.source);

        const index = msg.actionIndex;
        if (index === undefined) {
            return statusMessage;
        }
        const agentMessage = this.agentMessages[index];
        if (agentMessage === undefined) {
            statusMessage.setFirstResponseMetricsVisibility(false);
            let beforeElem = statusMessage;
            for (let i = 0; i < index + 1; i++) {
                if (this.agentMessages[i] === undefined) {
                    const newAgentMessage = new MessageContainer(
                        this.chatView,
                        "chat-message-left",
                        msg.source,
                        this.agents,
                        beforeElem.div,
                        this.hideMetrics,
                        this.start,
                        i === 0,
                    );
                    if (notification) {
                        newAgentMessage.div.classList.add("notification");
                    }
                    this.agentMessages[i] = newAgentMessage;
                }
                beforeElem = this.agentMessages[i];
            }
            this.chatView.updateScroll();
        }

        this.updateMetrics(msg.metrics);
        return this.agentMessages[index];
    }

    public updateMessageText(message: string) {
        this.userMessage.textContent = message;
    }
}
