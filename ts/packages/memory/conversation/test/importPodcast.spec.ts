// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { split } from "knowledge-processor";
import { parsePodcastTranscript } from "../src/importPodcast.js";

describe("conversation.importPodcast", () => {
    const turnParserRegex = /^(?<speaker>[A-Z0-9 ]+:)\s*?(?<speech>.*)$/;
    const transcriptText = `  
HAMLET: To be, or not to be: that is the question:  
Whether 'tis nobler in the mind to suffer  
The slings and arrows of outrageous fortune,  
Or to take arms against a sea of troubles  
And by opposing end them.  

MACBETH: 
Tomorrow, and tomorrow, and tomorrow,  
Creeps in this petty pace from day to day,  
To the last syllable of recorded time;  
And all our yesterdays have lighted fools  
The way to dusty death. Out, out, brief candle!  
Life's but a walking shadow, a poor player  
That struts and frets his hour upon the stage  
And then is heard no more. It is a tale  
Told by an idiot, full of sound and fury,  
Signifying nothing

RICHARD:Now is the winter of our discontent  
Made glorious summer by this sun of York;
And all the clouds that lour'd upon our house  
In the deep bosom of the ocean buried. 

SHERLOCK HOLMES:   In solving a problem of this sort, 
the grand thing is to be able to reason backward. 
That is a very useful accomplishment, and a very easy one, 
but people do not practice it much. 
In the everyday affairs of life, it is more useful 
to reason forward, and so the other comes to be neglected. 
There are fifty who can reason synthetically for one who can reason analytically.

LADY BRACKNELL: To lose one parent, Mr. Worthing, may be regarded as a misfortune; 
to lose both looks like carelessness.

MACBETH:
I will not be afraid of death and bane,
Till Birnam Forest come to Dunsinane.

LADY BRACKNELL:   I do not approve of anything that tampers with natural ignorance. 
Ignorance is like a delicate exotic fruit; touch it and the bloom is gone.
`;
    const speechCount = 7;
    const participantCount = 5;

    test("regex", () => {
        const regex = turnParserRegex;
        const transcriptLines = split(transcriptText, /\r?\n/, {
            removeEmpty: true,
            trim: true,
        });
        const speakers: string[] = [];
        transcriptLines.forEach((line) => {
            const match = regex.exec(line);
            if (match && match.groups) {
                if (match.groups.speaker) {
                    speakers.push(match.groups.speaker);
                }
            }
        });
        expect(speakers).toHaveLength(speechCount);
    });
    test("parseTranscript", () => {
        const [messages, participants] = parsePodcastTranscript(transcriptText);
        expect(messages).toHaveLength(speechCount);
        expect(participants.size).toEqual(participantCount);
    });
});
