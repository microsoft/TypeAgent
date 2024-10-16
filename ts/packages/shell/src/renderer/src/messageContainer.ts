// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayAppendMode, DisplayContent } from "@typeagent/agent-sdk";
import { TTS, TTSMetrics } from "./tts/tts";
import { TemplateEditConfig, PhaseTiming } from "agent-dispatcher";

import { ChoicePanel, InputChoice } from "./choicePanel";
import { setContent } from "./setContent";
import { ChatView } from "./chatView";
import { iconCheckMarkCircle, iconRoadrunner, iconX } from "./icon";
import { TemplateEditor } from "./templateEditor";
import { getClientAPI } from "./main";
import { SettingsView } from "./settingsView";

function createTimestampDiv(timestamp: Date, className: string) {
    const timeStampDiv = document.createElement("div");
    timeStampDiv.classList.add(className);

    const nameSpan = document.createElement("span");
    nameSpan.className = "agent-name";
    timeStampDiv.appendChild(nameSpan); // name placeholder

    const dateSpan = document.createElement("span");
    dateSpan.className = "timestring";
    timeStampDiv.appendChild(dateSpan); // time string

    dateSpan.innerText = timestamp.toLocaleTimeString();

    return timeStampDiv;
}

function updateMetrics(
    mainMetricsDiv: HTMLDivElement,
    markMetricsDiv: HTMLDivElement,
    name: string,
    metrics?: PhaseTiming,
    total?: number,
) {
    // clear out previous perf data
    mainMetricsDiv.innerHTML = "";
    markMetricsDiv.innerHTML = "";

    if (metrics?.marks) {
        const messages: string[] = [];
        for (const [key, value] of Object.entries(metrics.marks)) {
            const { duration, count } = value;
            messages.push(metricsString(key, duration, count));
        }
        markMetricsDiv.innerHTML = messages.join("<br>");
    }
    const messages: string[] = [];
    if (metrics?.duration) {
        messages.push(metricsString(`${name} Elapsed Time`, metrics.duration));
    }
    if (total !== undefined) {
        messages.push(metricsString("Total Elapsed Time", total));
    }
    mainMetricsDiv.innerHTML = messages.join("<br>");
}

function formatTimeReaderFriendly(time: number) {
    if (time < 1) {
        return `${time.toFixed(3)}ms`;
    } else if (time > 1000) {
        return `${(time / 1000).toFixed(1)}s`;
    } else {
        return `${time.toFixed(1)}ms`;
    }
}

function metricsString(name: string, duration: number, count = 1) {
    const avg = duration / count;
    return `${name}: <b>${formatTimeReaderFriendly(avg)}${count !== 1 ? `(out of ${count})` : ""}</b>`;
}

function updateMetricsVisibility(visible: boolean, div: HTMLDivElement) {
    const addClass = visible
        ? "chat-message-body"
        : "chat-message-body-hide-metrics";
    const removeClass = visible
        ? "chat-message-body-hide-metrics"
        : "chat-message-body";
    div.classList.remove(removeClass);
    div.classList.add(addClass);
}

export class MessageContainer {
    public readonly div: HTMLDivElement;
    private readonly messageBodyDiv: HTMLDivElement;
    private readonly messageDiv: HTMLDivElement;
    private readonly timestampDiv: HTMLDivElement;
    private readonly iconDiv?: HTMLDivElement;

    private metricsDiv?: {
        mainMetricsDiv: HTMLDivElement;
        markMetricsDiv: HTMLDivElement;
        ttsMetricsDiv: HTMLDivElement;
        firstResponseMetricsDiv: HTMLDivElement;
    };

    private messageStart?: number;
    private audioStart?: number;
    private ttsFirstChunkTotal: number = 0;
    private ttsFirstChunkCount: number = 0;
    private ttsSynthesisTotal: number = 0;

    private lastAppendMode?: DisplayAppendMode;
    private completed = false;
    private pendingSpeakText: string = "";

    public get source() {
        return this._source;
    }

    private updateSource() {
        if (this.iconDiv !== undefined) {
            const source = this._source;
            const sourceIcon = this.agents.get(source);

            // set source and source icon
            (this.timestampDiv.firstChild as HTMLDivElement).innerText = source; // name
            this.iconDiv.innerText = sourceIcon ?? "❔"; // icon
        }
    }

    constructor(
        private chatView: ChatView,
        private settingsView: SettingsView,
        private classNameSuffix: "agent" | "user",
        private _source: string,
        private readonly agents: Map<string, string>,
        beforeElem: Element,
        private hideMetrics: boolean,
        private readonly requestStart: number,
        private showFirstResponseMetrics = false,
    ) {
        const div = document.createElement("div");
        div.className = `chat-message-container-${classNameSuffix}`;

        const timestampDiv = createTimestampDiv(
            new Date(),
            `chat-timestamp-${classNameSuffix}`,
        );
        div.append(timestampDiv);
        this.timestampDiv = timestampDiv;

        if (classNameSuffix === "agent") {
            const agentIconDiv = document.createElement("div");
            agentIconDiv.className = "agent-icon";
            div.append(agentIconDiv);
            this.iconDiv = agentIconDiv;
        }

        const messageBodyDiv = document.createElement("div");
        const bodyClass = this.hideMetrics
            ? "chat-message-body-hide-metrics"
            : "chat-message-body";
        messageBodyDiv.className = `${bodyClass} chat-message-${classNameSuffix}`;
        div.append(messageBodyDiv);
        this.messageBodyDiv = messageBodyDiv;

        const message = document.createElement("div");
        message.className = "chat-message-content";
        messageBodyDiv.append(message);
        this.messageDiv = message;

        // The chat message list has the style flex-direction: column-reverse;
        beforeElem.before(div);

        this.div = div;
        this.updateSource();
    }

    public getMessage() {
        return this.messageDiv.innerText;
    }

    public setMessage(
        content: DisplayContent,
        source: string,
        appendMode?: DisplayAppendMode, // default to not appending.
    ) {
        if (typeof content !== "string" && content.kind === "info") {
            // Don't display info
            return;
        }

        if (this.messageStart === undefined) {
            // Don't count dispatcher status messages as first response.
            if (source !== "dispatcher") {
                this.messageStart = performance.now();
                this.updateFirstResponseMetrics();
            }
        }

        // Flush last temporary reset the lastAppendMode.
        this.flushLastTemporary();

        this._source = source;
        this.updateSource();

        const speakText = setContent(
            this.messageDiv,
            content,
            this.settingsView,
            appendMode === "inline" && this.lastAppendMode !== "inline"
                ? "block"
                : appendMode,
        );

        this.speak(speakText, appendMode);

        this.lastAppendMode = appendMode;

        this.updateDivState();
    }

    public addChoicePanel(
        choices: InputChoice[],
        onSelected: (choice: InputChoice) => boolean | void,
    ) {
        const choicePanel = new ChoicePanel(
            this.messageDiv,
            choices,
            (choice: InputChoice) => {
                if (onSelected(choice) !== false) {
                    choicePanel.remove();
                }
            },
        );
    }

    public proposeAction(
        proposeActionId: number,
        actionTemplates: TemplateEditConfig,
    ) {
        // use this div to show the proposed action
        const actionContainer = document.createElement("div");
        actionContainer.className = "action-container";
        this.messageDiv.appendChild(actionContainer);

        const actionCascade = new TemplateEditor(
            actionContainer,
            actionTemplates,
        );

        const createTextSpan = (text: string) => {
            const span = document.createElement("span");
            span.innerText = text;
            return span;
        };
        const confirm = () => {
            const choices: InputChoice[] = [
                {
                    text: "Accept",
                    element: createTextSpan("✓"),
                    selectKey: ["y", "Y", "Enter"],
                    value: true,
                },
                {
                    text: "Edit",
                    element: createTextSpan("✎"),
                    selectKey: ["n", "N", "Delete"],
                    value: undefined,
                },
                {
                    text: "Cancel",
                    element: createTextSpan("✕"),
                    selectKey: ["Escape"],
                    value: false,
                },
            ];
            this.addChoicePanel(choices, (choice: InputChoice) => {
                if (choice.value === undefined) {
                    edit();
                    return;
                }
                actionContainer.remove();
                const replacement = choice.value ? undefined : null;
                getClientAPI().sendProposedAction(proposeActionId, replacement);
            });
            this.scrollIntoView();
        };
        const edit = () => {
            actionCascade.setEditMode(true);
            const choices: InputChoice[] = [
                {
                    text: "Replace",
                    element: iconCheckMarkCircle(),
                    value: true,
                },
                {
                    text: "Cancel",
                    element: iconX(),
                    value: false,
                },
            ];
            this.addChoicePanel(choices, (choice: InputChoice) => {
                if (choice.value === true) {
                    if (actionCascade.hasErrors) {
                        return false;
                    }
                    actionContainer.remove();
                    getClientAPI().sendProposedAction(
                        proposeActionId,
                        actionCascade.value,
                    );
                } else {
                    actionCascade.reset();
                    actionCascade.setEditMode(false);
                    confirm();
                }
                return true;
            });
            this.scrollIntoView();
        };

        confirm();
    }

    private speakText(tts: TTS, speakText: string) {
        let cbAudioStart: (() => void) | undefined;
        if (this.audioStart === undefined) {
            this.audioStart = -1;
            cbAudioStart = () => {
                this.audioStart = performance.now();
                this.updateFirstResponseMetrics();
            };
        }
        const p = tts.speak(speakText, cbAudioStart);
        p.then((timing) => {
            if (timing) {
                this.addTTSTiming(timing);
            }
        });
    }

    private speak(
        speakText: string | undefined,
        appendMode?: DisplayAppendMode,
    ) {
        const tts = this.chatView.tts;
        if (tts === undefined) {
            return;
        }
        if (speakText === undefined) {
            // Flush the pending text.
            this.flushPendingSpeak(tts);
            return;
        }

        if (appendMode !== "inline") {
            this.flushPendingSpeak(tts);
            this.speakText(tts, speakText);
            return;
        }

        this.pendingSpeakText += speakText;
        const minSpeak = 10; // TODO: Adjust this value.
        if (this.pendingSpeakText.length <= minSpeak) {
            // Too short to speak.
            return;
        }
        const segmenter = new Intl.Segmenter(navigator.language, {
            granularity: "sentence",
        });
        const segments = Array.from(segmenter.segment(this.pendingSpeakText));

        if (segments.length < 2) {
            // No sentence boundary.
            return;
        }

        // Try Keep the last segment and speak the rest.
        const index = segments[segments.length - 1].index;
        if (index <= minSpeak) {
            // Too short to speak.
            return;
        }

        const speakTextPartial = this.pendingSpeakText.slice(0, index);
        this.pendingSpeakText = this.pendingSpeakText.slice(index);
        this.speakText(tts, speakTextPartial);
    }

    private flushPendingSpeak(tts: TTS) {
        // Flush the pending text.
        if (this.pendingSpeakText) {
            this.speakText(tts, this.pendingSpeakText);
            this.pendingSpeakText = "";
        }
    }

    public complete() {
        this.completed = true;
        if (this.chatView.tts) {
            this.flushPendingSpeak(this.chatView.tts);
        }
        this.flushLastTemporary();
        this.updateDivState();
    }

    private updateDivState() {
        if (this.completed && !this.messageDiv.firstChild) {
            this.hide();
        } else {
            this.show();
        }
    }

    private flushLastTemporary() {
        if (this.lastAppendMode === "temporary") {
            this.messageDiv.lastChild?.remove();
            this.lastAppendMode = undefined;
        }
    }

    private ensureMetricsDiv() {
        if (this.metricsDiv === undefined) {
            const metricsContainer = document.createElement("div");
            metricsContainer.className = `chat-message-metrics chat-message-metrics-${this.classNameSuffix}`;
            this.messageBodyDiv.append(metricsContainer);

            const metricsDetails = document.createElement("div");
            metricsDetails.className = "metrics-details";
            metricsContainer.append(metricsDetails);

            const left = document.createElement("div");
            metricsDetails.append(left);
            const middle = document.createElement("div");
            metricsDetails.append(middle);
            const right = document.createElement("div");
            metricsDetails.append(right);

            const firstResponseMetricsDiv = document.createElement("div");
            left.append(firstResponseMetricsDiv);

            const markMetricsDiv = document.createElement("div");
            middle.append(markMetricsDiv);

            // Only show with dev UI.
            const ttsMetricsDiv = document.createElement("div");
            ttsMetricsDiv.className = "tts-metrics";
            middle.append(ttsMetricsDiv);

            const mainMetricsDiv = document.createElement("div");
            right.append(mainMetricsDiv);

            this.metricsDiv = {
                mainMetricsDiv,
                markMetricsDiv,
                ttsMetricsDiv,
                firstResponseMetricsDiv,
            };
        }
        return this.metricsDiv;
    }

    public updateMainMetrics(
        name: string,
        metrics?: PhaseTiming,
        total?: number,
    ) {
        if (metrics === undefined && total === undefined) {
            return;
        }
        const metricsDiv = this.ensureMetricsDiv();
        updateMetrics(
            metricsDiv.mainMetricsDiv,
            metricsDiv.markMetricsDiv,
            name,
            metrics,
            total,
        );
    }

    private updateFirstResponseMetrics() {
        if (this.showFirstResponseMetrics) {
            const messages: string[] = [];
            if (this.messageStart !== undefined) {
                messages.push(
                    metricsString(
                        "First Message",
                        this.messageStart - this.requestStart,
                    ),
                );
            }
            if (this.audioStart !== undefined) {
                messages.push(
                    metricsString(
                        "First Audio",
                        this.audioStart - this.requestStart,
                    ),
                );
            }
            const div = this.ensureMetricsDiv().firstResponseMetricsDiv;
            div.innerHTML = messages.join("<br>");
        } else if (this.metricsDiv) {
            this.metricsDiv.firstResponseMetricsDiv.innerHTML = "";
        }
    }

    public setFirstResponseMetricsVisibility(visible: boolean) {
        this.showFirstResponseMetrics = visible;
        this.updateFirstResponseMetrics();
    }

    public addTTSTiming(timing: TTSMetrics) {
        const messages: string[] = [];
        if (timing.firstChunkTime) {
            this.ttsFirstChunkTotal += timing.firstChunkTime;
            this.ttsFirstChunkCount++;
        }
        this.ttsSynthesisTotal += timing.duration;

        if (this.ttsFirstChunkCount !== 0) {
            messages.push(
                metricsString(
                    "TTS First Chunk",
                    this.ttsFirstChunkTotal,
                    this.ttsFirstChunkCount,
                ),
            );
        }
        messages.push(metricsString("TTS Synthesis", this.ttsSynthesisTotal));
        this.ensureMetricsDiv().ttsMetricsDiv.innerHTML = messages.join("<br>");
    }

    public show() {
        this.div.classList.remove("chat-message-hidden");
    }
    public hide() {
        this.div.classList.add("chat-message-hidden");
    }
    public scrollIntoView() {
        this.div.scrollIntoView(false);
    }

    public setMetricsVisible(visible: boolean) {
        this.hideMetrics = !visible;
        updateMetricsVisibility(visible, this.messageBodyDiv);
    }

    public markRequestExplained(timestamp: string, fromCache?: boolean) {
        if (timestamp !== undefined) {
            const cachePart = fromCache ? "by cache match" : "by model";
            this.messageDiv.setAttribute(
                "data-expl",
                `Explained ${cachePart} at ${timestamp}`,
            );
        }
        this.messageDiv.classList.add("chat-message-explained");
        const icon = iconRoadrunner();
        icon.getElementsByTagName("svg")[0].style.fill = fromCache
            ? "#00c000"
            : "#c0c000";
        icon.className = "chat-message-explained-icon";
        this.messageDiv.appendChild(icon);
    }
}
