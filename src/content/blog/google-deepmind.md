---
title: "We Won $7,500 from Google DeepMind"
description: "Last Sunday, our team won 1st Place at Google DeepMind’s Gemini 4 Argon Hackathon—and also wound up submerged in the San Francisco Port."
date: 2026-10-27
draft: false
---

About 4 months ago, my good friends Dhilen and Jonathan suggested we ought to participate together in hackathons again. In high school, we’d placed 1st at the Ventura County Hackathon by the Sea, and somehow we’d all ended up at the University of California, Berkeley after high school, so this hackathon was a reunion of sorts.

It feels surreal as to what even happened at the hackathon: from meeting Google DeepMind engineers working on recursive self-improvement (scary!); to shelling out $200 to purchase Claude 20x mid-hackathon after my usage limits were reached; to winning 1st overall, and $7,500 cash in prizes.

---

## At Cal Hacks 13.0

Originally, since we were Berkeley students, the team had planned to only participate in the *other* hackathon that weekend, namely [Cal Hacks 13.0](https://www.calhacks.io). Dhilen, Jonathan, and I had arrived at the Palace of Fine Arts at ~5pm that Friday after taking the BART across the Bay, only to discover the Cal Hacks venue was a harsh, flickering, fluorescent, thick, humid, choking, industrial warehouse. Ugh. I can still hear the buzzing of the floodlights. Regardless, we’d still planned on building .

### Ideating

After nabbing a tray of burritos and hoarding some energy drinks, we couldn’t agree on an idea. Dhilen wanted to create something based on the finance work he’d done in the past—a reconciliation agent that receives trades in a simulated trading environment and acts as the uniform source of truth for resolving transactions. I suggested a real-estate claims disputer, and Jonathan wanted an energy management tool for servicing fleets.

Unable to pin down an idea, we soon were distracted by the many Cal Hacks events going on. A notable one was a game-theory optimal Scrabble bot competition with thousands in prizes. So I split from the team (sorry! my fault…) to work on [Scrabblebot](https://scrabblebot.spacetimedb.com/), which would bet on drawn tiles in a live Scrabble game against other bots to earn the most points.

![](/blog/we-won-7500-from-google-deepmind-0v4j3z2.webp "ScrabbleBot placed top three for about 3 hours!")

### Jane Street Poker

At around 12am, Jane Street, one of the Cal Hacks sponsors, was running a poker tournament in a side room. About eighty people signed up. I’m not a good poker player, but I am patient, which does pretty well when its 12am. I played only a few hands and watched other people knock each other out.

At around 2am, with ten of us left, I looked down at ace-nine offsuit. In poker, ace-nine is a solid hand to be dealt before the flop, especially if you have a short stack, so I pushed all in. The player to my left called with a pair of sevens. The board came out with no ace and no nine, and that was that.

I finished 10th, which earned me a $15 Amazon gift card and a deck of Jane Street playing cards. It also earned me a problem. BART stops running [around midnight](https://www.bart.gov/schedules), so by the time the tournament ended, the last train back across the Bay was long gone.

![](/blog/we-won-7500-from-google-deepmind-4t16300.webp#small "Jane Street cards!")

![Ben standing beneath the lit dome of the Palace of Fine Arts rotunda at night](/blog/palace-of-fine-arts-3am.webp#small "3:43am at the Palace of Fine Arts. The last BART was long gone.")

So Jonathan and I wandered around the Palace of Fine Arts (Dhilen had went back to his apartment to sleep), which had much better architecture than the hackathon venue, and eventually took the BART back to Berkeley. I went to bed a little after 7am.

We spent most of Saturday recovering and halfheartedly poking at Scrabblebot, which had fallen to ~25th place since Friday. We didn’t have much hope for Cal Hacks. Then Jonathan sent us a link to a different hackathon happening the next day: Google DeepMind was launching a new model, and Cerebral Valley was running [a one-day hackathon](https://cerebralvalley.ai/e/gemini-4-argon-sf) to show it off. We decided to drop Cal Hacks and go.

## At Argon Hacks

The [Gemini 4 Argon Hackathon](https://cerebralvalley.ai/e/gemini-4-argon-sf) ran from 9am to 10pm that Sunday, centered around Google DeepMind’s new model, [Gemini 4 Argon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/).

### The idea

The idea had come from Dhilen. He’d spent the summer doing bio-engineering research at Lawrence Livermore National Laboratory, and on the train he told us about the grueling repetition of wet lab protocols to find data.

A lab protocol is the set of instructions for an experiment. In theory, it’s a precise list of steps. In practice, it’s usually quite informal, with steps skipped or half crossed out. It’s an unspoken rule that everyone in the lab knows which parts are wrong. However, when someone gets one of those parts wrong, say by skipping a mixing step, nothing visibly happens. You only find out a week later, when the results are inaccurate, and the experiment has to be run again.

![A handwritten lab notebook page with a bone-marrow cell protocol, steps crossed out and margin notes](/blog/we-won-7500-from-google-deepmind-4z5q1t3.webp#small "A lipid nanoparticle protocol we ran live on LabTwin!")

That morning I’d also been reading Anthropic’s write-up on [how Claude designed protein binders against scorpion neurotoxins](https://www.anthropic.com/research/claude-scorpion-toxin-binder-design). Of 211 designs Claude proposed, 17 bound their targets when tested in a real lab. Currently, models are good at the thinking and planning part of biology. They can’t help much yet with the doing part, which hopefully will be [solved by robotics in the near future](https://ai-2027.com/). As the thinking gets faster, the doing becomes the bottleneck.

So I also agreed the idea was good. What if you could run an experiment *before* you run the experiment? Have a swarm of agents create a simulated copy of a real lab, implement a real protocol into it, and let an agent find the mistakes before a person makes them. Call it, ‘reinforcement learning for biolabs’.

It was the kind of thing a model like Argon 4, which is [state-of-the-art](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/#workingharder) at creating high-fidelity procedural worlds and understanding long documents was built for.[^1]

### LabTwin

We called it LabTwin. It takes three inputs: a lab protocol (PDF or Markdown), a photo or video of the lab, and what the result of the experiment should end up being. A Gemini 4 Argon orchestrator agent then fans out five Antigravity Managed Agents in parallel sandboxes, and with long decode they write the whole-room 3D twin, using the standard 96-well plate in the photo. The twin then executes your protocol in physics, identifying and fixing every failed step before a human wastes time performing live experiments.

![A real lab bench photo next to LabTwin's 3D reconstruction of the same bench](/blog/real-vs-twin.webp#wide)

Under the hood, the agents builds the 3D scene, track what’s in every tube and well, write the reward function, build the reinforcement-learning environment, and generate variations of the protocol to test. Together they produce a physics simulation in [MuJoCo](https://ieeexplore.ieee.org/document/6386109) and a [Gymnasium](https://gymnasium.farama.org) environment where an RL agent can pick up tips, aspirate, dispense, mix, and eject them, just like a person in the lab.

Notably, LabTwin never uses LLM-as-a-judge to verify output, which [has been known to lead to inaccurate results](https://arxiv.org/abs/2306.05685). Models are good at producing plausible answers and bad at noticing when a plausible answer is wrong. Therefore, we checked results with deterministic validator. Did the tip stay inside the well? Did every well end up with the right volume and concentration? When checks fail, Argon rewrites that step of the protocol, and the simulation runs again to prove the fix works.

For the demo, we used a serial dilution protocol and planted one mistake in it: the protocol tells you to keep the same pipette tip between two transfers. It’s an easy mistake to make, but it contaminates every well after it.

![A serial dilution protocol with the planted error highlighted: the same pipette tip is reused between transfers 3 and 4](/blog/demo-protocol-planted-error.webp "Demo protocol")

<figure class="embed embed-youtube"><iframe src="https://www.youtube-nocookie.com/embed/dGreES9C6a0" title="1-minute walkthrough demo" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe><figcaption>1-minute walkthrough demo</figcaption></figure>

### The rest of the day

Around 4pm, in the middle of debugging, I hit my Claude usage limit. I had the choice between waiting five hours and paying $200 for [Claude Max 20x](https://support.claude.com/en/articles/11049741-what-is-the-max-plan) right then, which, with six hours left, was not really a choice. Luckily it was a good investment![^1]

Around dinner we ended up chatting with some ambitious high schoolers working on the (Instinct, Muse, Dots, etc.) for teenagers and also some Google DeepMind engineers who had worked on Gemini for personal shopping.

We demoed at 8pm. The judges asked some standard questions: how we collaborated our swarm of agents together, and whether a real lab would use it.

At 9:40, they announced [1st place: LabTwin](https://cerebralvalley.ai/e/gemini-4-argon-sf/hackathon/gallery/67). Go polar bears!

### The port

Which brings me to the San Francisco Port. At the start of the hackathon, our team had made a bet that if we won, we would jump into the Port. I can confirm that the water in San Francisco Bay in late October is about 60 degrees.

![](/blog/we-won-7500-from-google-deepmind-030a0i3.webp "polars in the bay")

We took the last BART home soaking wet, with $7,500.

## Takeaways

So, what you might be wondering is, how do I go out and win some hackathons for myself? The honest answer is that none of it is the code. Claude Code (or Codex, or Cursor) writes most of that now, and probably will continue to do so. What wins hackathons are two human things[^2]:

- A novel idea, and
- Making the room *feel* something during the demo.

The first part has been spoken about enough. Paul Graham wrote that the best startup ideas come from [living in the future and building what’s missing](https://paulgraham.com/startupideas.html), and that holds for a hackathon too. One reason LabTwin worked is because Dhilen had spent a summer at Lawrence Livermore watching time being wasted on repeated experiments.

The second part is where most teams lose. Pick one feature and one demo. Make the frontend aesthetically pleasing, because judges see your project for three minutes and humans like pretty things. Then practice the pitch out loud with a timer. Eight hours of code and ten minutes of pitch prep is how you lose!

Another differentiator is also the team. Find awesome, ambitious people to work with! Dhilen, Jonathan, and I have experience doing hackathons together ever since the Ventura County Hackathon by the Sea in high school. Find people who are better than you at the things you’re bad at, and keep working with them. You’ll inevitably get stuck and frustrated if you work alone.

### LET’S KEEP GAMBLING

In poker, ace-nine (nicknamed ‘rounders’ or the ‘orthogonal polar bear’) still loses all the time, and you don’t stop playing it. You make the best of what you have.

See you at the next one.

---

Side note: two days after we won, Anthropic published [early results on accelerating drug development with Claude](https://www.anthropic.com/research/early-progress-drug-development), including changes to how wet-lab work gets done. The doing part of biology is about to get much faster, and I’m glad we got to emulate a small piece of it.

## Further reading

If you want to go deeper on the ideas behind LabTwin:

- [Coscientist](https://pmc.ncbi.nlm.nih.gov/articles/PMC10733136) (Boiko et al., *Nature* 2023): an LLM that plans and runs real chemistry experiments.
- [BioPlanner](https://arxiv.org/abs/2310.10632) (O’Donoghue et al., EMNLP 2023): can language models plan lab protocols?
- [LAB-Bench](https://arxiv.org/abs/2407.10362) (FutureHouse, 2024) and [BioProBench](https://arxiv.org/abs/2505.07889) (2025): benchmarks for protocol understanding and reasoning.
- [ExpVid](https://arxiv.org/abs/2510.11606) (2025): how well multimodal models understand lab videos.
- [Self-driving laboratories for chemistry and materials science](https://chemrxiv.org/engage/chemrxiv/article-details/66708e2e5101a2ffa8cbd354) (*Chemical Reviews*, 2024): a survey of autonomous labs.
- [Invalid action masking in policy gradient algorithms](https://arxiv.org/abs/2006.14171) (Huang & Ontañón): the idea behind the masked PPO were trained.

**Links:**

- The GitHub repositree: [benjaminxie1/argon-hacks](https://github.com/benjaminxie1/argon-hacks)
- The demo video: [youtu.be/dGreES9C6a0](https://youtu.be/dGreES9C6a0)
- The project page: [Cerebral Valley gallery](https://cerebralvalley.ai/e/gemini-4-argon-sf/hackathon/gallery/67)

[^1]: We may also have put the hackathon’s Gemini 4 Argon API key to work on a few personal projects afterward…
[^2]: This advice is also generalizable to daily life as well!
