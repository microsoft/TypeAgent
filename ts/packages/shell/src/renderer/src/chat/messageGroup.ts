// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent, TypeAgentAction } from "@typeagent/agent-sdk";
import {
    CommandResult,
    IAgentMessage,
    NotifyExplainedData,
    RequestId,
} from "agent-dispatcher";
import { RequestMetrics } from "agent-dispatcher";

import { MessageContainer } from "../messageContainer";
import { ChatView } from "./chatView";
import { SettingsView } from "../settingsView";

export class MessageGroup {
    public metricsDiv?: {
        mainMetricsDiv: HTMLDivElement;
        markMetricsDiv: HTMLDivElement;
    };
    private readonly userMessage: MessageContainer;
    private statusMessage: MessageContainer | undefined;
    private readonly agentMessages: MessageContainer[] = [];
    private readonly start: number = performance.now();
    constructor(
        private readonly chatView: ChatView,
        private readonly settingsView: SettingsView,
        request: DisplayContent,
        container: HTMLDivElement,
        requestPromise: Promise<CommandResult | undefined> | undefined,
        public agents: Map<string, string>,
        private hideMetrics: boolean,
    ) {
        this.userMessage = new MessageContainer(
            chatView,
            settingsView,
            "user",
            chatView.userGivenName,
            agents,
            container,
            hideMetrics,
            this.start,
        );

        this.userMessage.setMessage(request, chatView.userGivenName);

        if (container.firstChild) {
            container.firstChild.before(this.userMessage.div);

            this.userMessage.div.scrollIntoView(false);
        } else {
            container.append(this.userMessage.div);
        }

        this.chatView.tts?.stop();

        if (requestPromise) {
            requestPromise
                .then((result) => this.requestCompleted(result?.metrics))
                .catch((error) => this.requestException(error));
        }
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        this.userMessage.setMetricsVisible(visible);
        this.statusMessage?.setMetricsVisible(visible);
        for (const agentMessage of this.agentMessages) {
            agentMessage.setMetricsVisible(visible);
        }
    }

    public setDisplayInfo(
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            source,
            actionIndex,
        });
        agentMessage.setDisplayInfo(source, action);
    }

    public setActionData(_requestId: RequestId, data: any) {
        const agentMessage = this.ensureAgentMessage({
            message: "",
            source: "",
            actionIndex: undefined,
        });

        agentMessage.updateActionData(data);
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
                this.settingsView,
                "agent",
                source,
                this.agents,
                this.userMessage.div,
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
                this.userMessage.updateMainMetrics(
                    "Translation",
                    metrics.parse,
                );
            }

            this.statusMessage?.updateMainMetrics(
                "Action",
                metrics.command,
                this.agentMessages.length === 0 ? metrics.duration : undefined,
            );

            for (let i = 0; i < this.agentMessages.length; i++) {
                const agentMessage = this.agentMessages[i];
                const info = metrics.actions[i];
                agentMessage.updateMainMetrics(
                    "Action",
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
                        this.settingsView,
                        "agent",
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

    public updateUserMessage(message: string) {
        this.userMessage.setMessage(message, this.chatView.userGivenName);
    }

    public notifyExplained(data: NotifyExplainedData) {
        this.userMessage.notifyExplained(data);
    }

    public hideUserMessage() {
        this.userMessage.hide();
    }
}
