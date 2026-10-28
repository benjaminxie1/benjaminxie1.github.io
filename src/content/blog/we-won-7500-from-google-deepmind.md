---
title: "We Won $7,500 from Google DeepMind"
description: "Last Sunday, our team won 1st Place at Google DeepMind’s Gemini 4 Argon Hackathon—and also wound up submerged in the San Francisco Port."
date: 2026-10-27
draft: true
---

About 4 months ago, my good friends Dhilen and Jonathan suggested we ought to participate together in hackathons again. In high school, we’d placed 1st at the Ventura County Hackathon by the Sea, and somehow we’d all ended up at the University of California, Berkeley after high school, so this hackathon was a reunion of sorts.

It feels surreal as to what even happened at the hackathon: from meeting Google DeepMind engineers working on recursive self-improvement (scary!); to shelling out $200 to purchase Claude 20x mid-hackathon after my usage limits were reached; to winning 1st overall, and $7,500 cash in prizes.

---

## At Cal Hacks 13.0

Originally, since we were Berkeley students, the team had planned to only participate in the *other* hackathon that weekend, namely [Cal Hacks 13.0](https://www.calhacks.io). Dhilen, Jonathan, and I had arrived at the Palace of Fine Arts at ~5pm that Friday after taking the BART across the Bay, only to discover the Cal Hacks venue was a harsh, flickering, fluorescent, thick, humid, choking, industrial warehouse. Agh. I can still hear the buzzing of the floodlights. Regardless, we’d still planned on building .

### Scrabblebot

After nabbing a tray of burritos and hoarding some energy drinks, we couldn’t agree on an idea. Each of us had brought one, and each of us thought the other two were wrong.

Dhilen wanted to build something on top of the finance work he’d been doing: an agent that reads earnings calls and flags when what executives say doesn’t match their numbers. Jonathan liked it. I wanted to build Scrabblebot, which would watch a live Scrabble game through a phone camera and tell you the best move. My argument was that it was fun. Their argument was that it was useless. They were both right.

The problem with all three ideas was the same: none of us actually needed them. We’d have been building them to win a hackathon, and you can usually tell when a project was built for that reason. By 9pm we had a whiteboard full of half-ideas and nothing we believed in, so we did what any reasonable team does when it can’t pick an idea. We went to play poker.

### Jane Street Poker

Jane Street, one of the Cal Hacks sponsors, was running a poker tournament in a side room. About eighty people signed up. I’m not a good poker player, but I am a patient one, and in a tournament full of tired hackers, patience goes surprisingly far. I folded almost everything for two hours and watched other people knock each other out.

At around 2am, with ten of us left, I looked down at ace-king offsuit. AK is one of the best hands you can be dealt before the flop, so I pushed all in. The player to my left called with a pair of sevens. The board came out with no ace and no king, and that was that.

I finished 10th, which earned me a $15 Amazon gift card and a deck of Jane Street playing cards. It also earned me a problem. BART stops running [around midnight](https://www.bart.gov/schedules), so by the time the tournament ended, the last train back across the Bay was long gone.

![Ben standing beneath the lit dome of the Palace of Fine Arts rotunda at night](/blog/palace-of-fine-arts-3am.webp#small "3:43am at the Palace of Fine Arts. The last BART was long gone.")

So I wandered around the Palace of Fine Arts, which is a much better building at 3am than a hackathon venue is at 5pm, and eventually split an Uber back to Berkeley with two other stranded hackers. I got to bed a little after 5.

We spent most of Saturday recovering and halfheartedly poking at Scrabblebot. It wasn’t going anywhere. Then Jonathan sent us a link to a different hackathon happening the next day: Google DeepMind was launching a new model, and Cerebral Valley was running a one-day hackathon to show it off. We decided to drop Cal Hacks and go.

## At Argon Hacks

The [Gemini 4 Argon Hackathon](https://cerebralvalley.ai/e/gemini-4-argon-sf) ran from 9am to 10pm that Sunday, built around Google DeepMind’s new model, [Gemini 4 Argon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/). We had one day, no idea, and a BART ride to think of one.

### The idea

The idea came from Dhilen. He’d spent the summer doing bioengineering research at Lawrence Livermore National Laboratory, and on the train he told us about the part of lab work nobody writes papers about: the protocols.

A protocol is the recipe for an experiment. In theory it’s a precise, numbered list of steps. In practice it lives in someone’s notebook, half crossed out, with notes like “ask when to add this” in the margin. Everyone in the lab knows the protocol is a little wrong, and everyone knows which parts. And when someone gets one of those parts wrong, say by reusing a pipette tip that should have been changed or skipping a mixing step, nothing visibly happens. You only find out a week later, when the results make no sense and the experiment has to be run again.

![A handwritten lab notebook page with a bone-marrow cell protocol, steps crossed out and margin notes](/blog/we-won-7500-from-google-deepmind-4z5q1t3.webp#small "What a real protocol looks like. Note “ask when to add this” at the bottom.")

That morning I’d been reading Anthropic’s write-up on [how Claude designed protein binders against scorpion neurotoxins](https://www.anthropic.com/research/claude-scorpion-toxin-binder-design). Of 211 designs Claude proposed, 17 bound their targets when tested in a real lab. Put that next to Dhilen’s story and the shape of the problem gets clear. Models are getting good at the thinking part of biology: deciding what to make. They can’t help much yet with the doing part, which is still a person at a bench following a fragile recipe. As the thinking gets faster, the doing becomes the bottleneck.

So the question we asked was: what if you could run an experiment before you run the experiment? Build a simulated copy of a real lab bench, load a real protocol into it, and let an agent find the mistakes before a person makes them. Reinforcement learning for biolabs.

We all knew within a few minutes that this was the one. It was a real problem, one of us had lived it, and it was exactly the kind of thing a model like Argon, which is good at reading images and long documents, was built for.[^1]

### LabTwin

We called it [LabTwin](https://github.com/benjaminxie1/argon-hacks). You give it three things: a lab protocol (PDF or Markdown), a photo or video of the bench, and what each well should end up containing. Gemini 4 Argon reads all three and builds a digital twin of the bench. To get the scale right, it uses the standard 96-well plate in the photo as a ruler: every plate is exactly the same size, so if it can find the plate, it can measure everything else.

![A real lab bench photo next to LabTwin's 3D reconstruction of the same bench](/blog/real-vs-twin.webp#wide "Left: a real bench. Right: the bench LabTwin rebuilt from that photo.")

Under the hood, five Gemini agents work in parallel. One builds the 3D scene, one tracks what’s in every tube and well, one writes the reward function, one builds the reinforcement-learning environment, and one generates variations of the protocol to test. Together they produce a physics simulation in [MuJoCo](https://ieeexplore.ieee.org/document/6386109) and a [Gymnasium](https://gymnasium.farama.org) environment where an RL agent can pick up tips, aspirate, dispense, mix, and eject them, just like a person at the bench.

The most important design decision was that Argon never grades its own homework. Models are good at producing plausible answers and bad at noticing when a plausible answer is wrong, which is exactly the failure mode we were trying to catch in people. So every step is checked by a plain, deterministic validator: did the tip hit anything, did it stay inside the well, did every well end up with exactly the right volume and concentration? When a check fails, the failure goes back to the agent responsible for it, Argon rewrites that step of the protocol, and the simulation runs again to prove the fix works.

For the demo, we wrote a simple serial dilution and planted one mistake in it: the protocol tells you to keep the same pipette tip between two transfers. It’s an easy mistake to make, and it quietly contaminates every well after it. LabTwin caught it, explained why it mattered, and rewrote the step.

![A serial dilution protocol with the planted error highlighted: the same pipette tip is reused between transfers 3 and 4](/blog/demo-protocol-planted-error.webp "The demo protocol. Spot the error.")

<div class="embed embed-youtube"><iframe src="https://www.youtube-nocookie.com/embed/dGreES9C6a0" title="YouTube video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>

### The rest of the day

Building all of that in thirteen hours took more compute than I had. Around 4pm, in the middle of debugging the validator, I hit my Claude usage limit. I had the choice between waiting five hours and paying $200 for [Claude Max 20x](https://support.claude.com/en/articles/11049741-what-is-the-max-plan) right then, which, with six hours left, was not really a choice.[^1]

At lunch we ended up at a table with a few Google DeepMind engineers. One of them worked on recursive self-improvement: using models to help do the research that produces the next model. He talked about it the way you’d talk about any engineering project, which was the scariest part. It was also the best conversation I had all weekend.

We demoed at 8pm. The judges asked two questions: whether it worked on protocols we hadn’t prepared, and whether a real lab would use it. We showed it a protocol Dhilen had brought from Livermore, and it found a step that was ambiguous enough that two people could reasonably do it two different ways. For the second question, Dhilen just said yes.

At 9:40, they announced [1st place: LabTwin](https://cerebralvalley.ai/e/gemini-4-argon-sf/hackathon/gallery/67).

### The port

Which brings me to the San Francisco Port. Winning a hackathon at 10pm on a Sunday leaves you with a lot of adrenaline and nowhere to put it, so the three of us walked down to the water to celebrate. What happened next involved a pier, a dare, and a decision that made a lot of sense at the time. The water in San Francisco Bay in late October is about 60 degrees. I can confirm this.

We took the last BART home soaking wet, with $7,500 and a story we’ll be telling for a long time.

## Takeaways

I have the AK offsuit.

I lost that poker tournament holding the second-best starting hand in the game, and I think that hand explains more about hackathons than anything else from the weekend. AK offsuit is strong, but it isn’t a made hand. It’s a good start that still needs the board to cooperate. Most people who lose with it didn’t play it wrong. They just treated a good start as if it were a finished result.

A good idea at a hackathon is the same. Scrabblebot was a fine start, and so were the other two ideas we argued about on Friday. What made LabTwin different wasn’t that it was clever. It was that one of us had personally experienced the problem, which meant we knew what the solution had to do, and we could tell when we were building the wrong thing. Ideas that come from your own life come with a built-in judge.

The other thing I learned is to trust the feeling. On that BART ride, before we’d written a line of code, I “had a feeling” about this idea. I didn’t have that feeling about anything on Friday. I think the feeling is mostly your brain noticing that an idea is real before you can explain why. You can’t make it happen. But you can notice when it isn’t there, and you should take that as a sign to keep looking, even if that means walking out of one hackathon and into another.

Two days after we won, Anthropic published [early results on accelerating drug development with Claude](https://www.anthropic.com/research/early-progress-drug-development), including changes to how wet-lab work and protocols get done. The doing part of biology is about to get much faster, and I’m glad we got to build a small piece of it.

## Further reading

If you want to go deeper on the ideas behind LabTwin:

- [Coscientist](https://pmc.ncbi.nlm.nih.gov/articles/PMC10733136) (Boiko et al., *Nature* 2023): an LLM that plans and runs real chemistry experiments.
- [BioPlanner](https://arxiv.org/abs/2310.10632) (O’Donoghue et al., EMNLP 2023): can language models plan lab protocols?
- [LAB-Bench](https://arxiv.org/abs/2407.10362) (FutureHouse, 2024) and [BioProBench](https://arxiv.org/abs/2505.07889) (2025): benchmarks for protocol understanding and reasoning.
- [ExpVid](https://arxiv.org/abs/2510.11606) (2025): how well multimodal models understand lab videos.
- [Self-driving laboratories for chemistry and materials science](https://chemrxiv.org/engage/chemrxiv/article-details/66708e2e5101a2ffa8cbd354) (*Chemical Reviews*, 2024): a survey of autonomous labs.
- [Invalid action masking in policy gradient algorithms](https://arxiv.org/abs/2006.14171) (Huang & Ontañón): the idea behind the masked PPO we trained.

**Links:**

- The GitHub repositree: [benjaminxie1/argon-hacks](https://github.com/benjaminxie1/argon-hacks)
- The demo videeyo: [youtu.be/dGreES9C6a0](https://youtu.be/dGreES9C6a0)
- The project page: [Cerebral Valley gallery](https://cerebralvalley.ai/e/gemini-4-argon-sf/hackathon/gallery/67)

[^1]: We may also have put the hackathon’s Gemini 4 Argon API key to work on a few personal projects afterward. Allegedly.
