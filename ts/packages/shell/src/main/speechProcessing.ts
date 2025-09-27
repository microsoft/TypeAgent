// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModelWithStreaming, openai } from "aiclient";
import registerDebug from "debug";
import { createTypeChat } from "typeagent";
import { SpeechProcessingAction } from "./speechProcessingSchema.js";

const debug = registerDebug("typeagent:shell:speechProcessing");


export class SpeechProcessing {
    // Singleton
    private static instance: SpeechProcessing;
    public static getInstance(): SpeechProcessing {
        if (!SpeechProcessing.instance) {
            SpeechProcessing.instance = new SpeechProcessing();
        }
        return SpeechProcessing.instance;
    }

    private model: ChatModelWithStreaming | null = null;

    private instructions: string = `
You are a system that processes speech recognition results from an open microphone.  Your goal is to annotate the speech recognition results and to classify the incoming strings so that a downstream component can take action when the user has a question or needs an action taken. 

Here is the XSD schema for the XML strings that you produce:
\`\`\`
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">

  <!-- Root element -->
  <xs:element name="Text">
    <xs:complexType>
      <xs:sequence>
        <!-- Individual intents -->
        <xs:element name="Statement" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
        <xs:element name="Question" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
        <xs:element name="Request" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>

        <!-- Compound intent container -->
        <xs:element name="Compound" minOccurs="0" maxOccurs="unbounded">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="Statement" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
              <xs:element name="Question" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
              <xs:element name="Request" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>

      </xs:sequence>
    </xs:complexType>
  </xs:element>

</xs:schema>
\`\`\`

Example input: 
\`\`\`
Hello, team! We’ve made great progress on the prototype. Can we schedule a demo for next week? I think the UI still needs some polish. Could someone review the layout before Monday? Do we have final approval from legal? Please confirm with the compliance team. Send me the updated specs when ready.
\`\`\`

Example output:
\`\`\`
<Text>
  <Statement>Hello, team!</Statement>
  <Statement>We’ve made great progress on the prototype.</Statement>
  <Question>Can we schedule a demo for next week?</Question>

  <Compound>
    <Statement>I think the UI still needs some polish.</Statement>
    <Request>Could someone review the layout before Monday?</Request>
  </Compound>

  <Compound>
    <Question>Do we have final approval from legal?</Question>
    <Request>Please confirm with the compliance team.</Request>
  </Compound>

  <Request>Send me the updated specs when ready.</Request>
</Text>
\`\`\`

Return only valid XML    
`;


    constructor() {
        this.model = openai.createChatModel(
            openai.azureApiSettingsFromEnv(
                openai.ModelType.Chat,
                undefined,
                "GPT_5_NANO",
            ), 
            {
                temperature: 1.0,
                max_completion_tokens: 8196,
                response_format: { type: "json_object"},
                reasoning_effort: "low",
            },
            undefined,
            ["continuous-speech-processing"]
        );

    }

    public async processSpeech(speechText: string): Promise<string | undefined> {

        debug("Processing speech: " + speechText);

        try {
            const azoai = createTypeChat<SpeechProcessingAction>(
                this.model!,
                //loadSchema(["speechProcessingSchema.ts"], import.meta.url),
                `
                // An action that processes speech input and returns processed text
                // Processed text is in XML format that has been annotated to indicate user intent.
                export type SpeechProcessingAction = {
                    actionName: "speechProcessingAction";
                    parameters: {
                        // The original, unmodified speech input
                        inputText: string;
                        // An XML string containing the processed text
                        processedText: string;
                    }
                }               
                `,
                "SpeechProcessingAction",
                this.instructions,
                [],
                8196,
                30
            );

            const response = await azoai.translate(speechText);

            if (response.success) {
                return response.data.parameters.processedText;
            } else {
                return undefined;
            }
        } catch (error) {
            debug("Error processing speech: " + error);
            return undefined;
        }
    };
}