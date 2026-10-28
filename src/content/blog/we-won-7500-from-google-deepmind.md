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

After nabbing a tray of burritos and hoarding some energy drinks, we couldn’t agree on an idea. Dhilen had worked on some finance thing, there was Scrabblebot, and we went back and forth for a while without landing on anything.

### Jane Street Poker

So we did what any reasonable team does when it can’t pick an idea: we went and played poker instead. Jane Street, one of the [Cal Hacks sponsors](https://www.calhacks.io), was running a poker tournament that night, and it went on until about 2am.

I finished 10th, which earned me a $15 Amazon gift card and a deck of Jane Street playing cards. It also earned me a problem. BART stops running [around midnight](https://www.bart.gov/schedules), so by the time the tournament ended, the last train back across the Bay was long gone.

![Ben standing beneath the lit dome of the Palace of Fine Arts rotunda at night](/blog/palace-of-fine-arts-3am.webp#small "3:43am at the Palace of Fine Arts. The last BART was long gone.")

Eventually I made it home and went to sleep.

## At Argon Hacks

That Sunday, we went to the [Gemini 4 Argon Hackathon](https://cerebralvalley.ai/e/gemini-4-argon-sf), run by Cerebral Valley and Google DeepMind to show off their new model, [Gemini 4 Argon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/).

The idea came on the BART ride over. I’d been reading Anthropic’s write-up on [how Claude designed protein binders against scorpion neurotoxins](https://www.anthropic.com/research/claude-scorpion-toxin-binder-design): of 211 designs it proposed, 17 bound their targets in the lab. Models are getting good at the *thinking* half of biology. The bottleneck is the *doing* half: wet-lab work is slow, expensive, and a single wrong step (a reused pipette tip, a skipped mix) can quietly ruin a week of experiments.

So: what if you could run an experiment before you run the experiment? Reinforcement learning for biolabs. Give an agent a simulated copy of a real lab bench and a real protocol, and let it find the mistakes before a human makes them.

### LabTwin

That became [LabTwin](https://github.com/benjaminxie1/argon-hacks). You give it three things: a lab protocol (PDF or Markdown), a photo or video of the bench, and what each well should end up containing. Gemini 4 Argon reads all of it and builds a digital twin of the bench, using the standard 96-well plate in the photo as a ruler for everything else.

![A real lab bench photo next to LabTwin's 3D reconstruction of the same bench](/blog/real-vs-twin.webp#wide "Left: a real bench. Right: the bench LabTwin rebuilt from that photo.")

Under the hood, five Gemini agents work in parallel: one builds the scene, one tracks the state of every tube and well, one writes the reward, one builds the RL environment, and one generates variations. Together they produce a physics simulation in [MuJoCo](https://ieeexplore.ieee.org/document/6386109) and a [Gymnasium](https://gymnasium.farama.org) environment where an RL agent can pick up tips, aspirate, dispense, mix, and eject.

The part I’m proudest of is that Argon never grades its own homework. A deterministic validator checks every step: did the tip collide with something, did it stay inside the well, did every well end up with exactly the right volume and concentration? When a step fails, the failure goes back to whichever agent owns it, Argon rewrites the protocol, and the simulation runs again to prove the fix actually works.

We used real experiment protocols and real lab photos to build it. For the demo, we planted a mistake in a simple serial dilution: reuse the same pipette tip between two transfers. It’s the kind of error a tired grad student makes at 11pm, and it contaminates every well after it. LabTwin caught it, explained it, and rewrote the step.

![A serial dilution protocol with the planted error highlighted: the same pipette tip is reused between transfers 3 and 4](/blog/demo-protocol-planted-error.webp "The demo protocol. Spot the error.")

<div class="embed embed-youtube"><iframe src="https://www.youtube-nocookie.com/embed/dGreES9C6a0" title="YouTube video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>

Somewhere in there, I hit my Claude usage limit, and with a few hours left I shelled out $200 for [Claude Max 20x](https://support.claude.com/en/articles/11049741-what-is-the-max-plan) on the spot. I also spent some of the day talking with Google DeepMind engineers working on recursive self-improvement: models that help build better models. Fascinating, and a little scary.

(We may also have put our hackathon Gemini 4 Argon API key to work on a few personal projects. Allegedly.)

Then we demoed, and they announced [1st place: LabTwin](https://cerebralvalley.ai/e/gemini-4-argon-sf/hackathon/gallery/67).

## Takeaways

I have the AK offsuit.

In poker, ace-king offsuit is one of the best starting hands there is, and it is still not a made hand. It wins when you play it well, and it loses more often than people like to admit. Most of the time it’s a good start and nothing more.

That’s what an idea is at a hackathon. Going in, we had a strong hand: three people who’d won together before, a problem we actually cared about, and a model that was good at exactly the thing we needed. None of that wins anything by itself. What won was the boring part: cutting scope until the demo did one thing perfectly, and building the validator so we could trust what the model told us.

The other thing I learned is to trust the feeling. Somewhere on that BART ride, before we had written a line of code, I “had a feeling” about this idea. You can’t plan for that feeling. You can only notice it, and then work hard enough that it turns out to be right.

Two days after we won, Anthropic published [early results on accelerating drug development with Claude](https://www.anthropic.com/research/early-progress-drug-development), including changes to how wet-lab work and protocols get done. The doing half of biology is about to get a lot faster. I’m glad we got to build a small piece of it.

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
