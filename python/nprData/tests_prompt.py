# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

from llm_util import LLMChat
from prompts import typeagent_entity_extraction_system_full
from structs import Episode
from dotenv import load_dotenv
import json

PASSAGE = """
ADRIAN TCHAIKOVSKY: So, I was always a very keen reader from a very early age. But a lot of my creative impulses went into role playing games when I was a teenager. And then I came across a set of books called the Dragonlance Chronicles, which were basically someoneï¿½s role playing Dungeons and Dragons campaign turned into novels. And that just ï¿½ that was the light bulb moment for me. That kind of drew the line between where I was and being a published author, because these people were very much my kind of people doing my kind of thing.ï¿½ï¿½
ï¿½
And it was quite a long road from there. It was about 15 years of trying to get published and not getting anywhere, and kind of honing my style as an author. But that was very much the just that, the moment the door opened for me.ï¿½
ï¿½
KEVIN SCOTT: And when you were a kid, were you writing short stories and fiction, or did that come later?ï¿½
ï¿½
ADRIAN TCHAIKOVSKY: I really wasnï¿½t. I remember being quite actively resistant to it at school. I mean, this is kind of for any parents who, for whatever unknown reason, would want their children to become a writer and are seeing no interest in it as yet, it was ï¿½ I was about 17 before I really put pen to paper. But I think, looking before then, I can certainly see I had a lot of desire to create. I was just using it in other outlets.ï¿½
ï¿½
KEVIN SCOTT: And so, Iï¿½m curious, like, you played role playing games. Like, what was your favorite role playing setup? Like, what game? What characters did you play?ï¿½
ï¿½
ADRIAN TCHAIKOVSKY: We were ï¿½ we played quite a few that were kicking around in the, it would be ï¿½80s, early ï¿½90s. And Dungeons and Dragons was definitely the main one, which was, I suspect, a common experience for most people at the time.ï¿½ï¿½
ï¿½
One of the things, my role was, as often as not, I was running the game, which meant creating the world and creating many, many characters, and sort of portraying characters in a fairly quickfire fashion for the other players. And this turned out to be an enormously useful sort of skillset for writing fantasy and science fiction novels, because the same kind of world creating, the same presentation of characters just crosses over very neatly from one to another.ï¿½
ï¿½
KEVIN SCOTT: And so, what did you study in university and what was ï¿½ what did you do after you graduated?ï¿½
ï¿½
ADRIAN TCHAIKOVSKY: So, I studied psychology, and I studied zoology. And I kind of came out of university yet somewhat disillusioned by both. The ï¿½ there were things I ï¿½ basically, there were things I wanted to learn, and they were not the things the courses were necessarily teaching.ï¿½ï¿½
ï¿½
So, I was very interested in animal behavior. And there were some really interesting psychology lectures on that, but very few of them. And at the time, the ï¿½ the dominant paradigm for animal behavior was based on the work of a chap called Skinner. And it was very much animals are kind of robots, and they didnï¿½t think, and they donï¿½t have emotions, which is obviously a very convenient thing to think if youï¿½re then going to run experiments on them.ï¿½ï¿½
ï¿½
And in zoology, I very much wanted to learn about insects and arachnids, and all the things I was interested in. And we got precisely one lecture on that, and it was how to kill them, which was not really what I felt Iï¿½d signed up for.ï¿½ï¿½
ï¿½
So, I sort of ï¿½ I came out of out of university with a fairly, fairly dismal degree, and no real interest in pushing that sort of academic side of things further. Whereupon I ended up, through a series of bizarre chances, with a career in law, mostly because I got a job as a legal secretary, because my writing had given me a high typing speed. And it basically comes down to that, something as ridiculous as that, then just kind of paid the rent for the next 10 years or so until the, well, 10-15 years or so until the writing finally took off.ï¿½
ï¿½
"""

EPISODE_PATH = "btt_podcast.txt"

if __name__ == "__main__":
    load_dotenv("./env_vars")
    chat = LLMChat("groq")
    
    with open("btt_chunks.json", "r") as f:
        data = json.load(f)
        episode_data = Episode.from_text_file(EPISODE_PATH)
    
    passage = episode_data.sections[0].transcript[0].content

    prompt = typeagent_entity_extraction_system_full(PASSAGE)
    response_turn = chat.send_message("user", prompt)
    print(response_turn.content)