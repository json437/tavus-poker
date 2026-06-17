# TavusPoker

**The table watches back.**

AlphaGo won in public. Every stone sat on the board for both players to see. Poker hides everything. The cards are face down. The talk is a weapon. The opponent is a person first and a range second.

That gap is the point. Most AI demos put the model off to the side, a calculator you query and wait on. TavusPoker drops it into the seat across from you. It plays with hidden information, acts under a clock, and tries to read you while you are still in the room.

## The old game was too clean

Board games made AI legible because the whole world fit on the board. Nothing was hidden. Nothing had to be inferred about the person on the other side.

Poker removes that comfort. You never see the full state. You act on partial information against someone who is learning you. That is a harder problem, and a better test of a conversational video interface than another assistant call. A poker opponent has to listen, wait, bluff, remember, and decide while you sit across from it.

## How it works

The architecture is split by trust. The engine owns game truth. Phoenix owns presence. Sparrow owns timing. Raven owns perception. The LLM owns strategy.

The engine owns the truth. It shuffles, posts blinds, validates legal actions, resolves all-ins, awards pots, and runs the match until one stack is gone. The model never touches the deck. It plays the same game you do, blind to your cards.

Phoenix is the face across the felt. It renders the opponent in real time over WebRTC, so the seat is held by something that reacts instead of buffers.

Sparrow runs the clock. It decides when to speak, when to wait, and when to let the silence sit on you. In poker that is not a UX nicety. Timing is information. A snap-call and a long pause say different things, and the opponent gets to use both.

Raven supplies the read. It watches expression, gaze, and tone, and only fires while you are facing a decision. Cues outside a decision window are noise, and get dropped.

Raven's observations arrive as tool calls. The model ties them to the hand, the price, the timing, and the result. Over time that becomes a private table image: how often you fold to pressure, which spots make you talk, which pauses are real, and where Tavus can push.

## The rule that makes it honest

A real opponent does not announce your tell while using it. Neither does TavusPoker. During the hand, the read stays sealed. After the pot moves, the app opens the evidence trail: what it saw, which decision it belonged to, and whether the model actually spent the read.

```text
Voice and camera
  plus Raven and Sparrow
  plus timing and action
  plus showdown result
  equals evidence

Evidence updates a private hypothesis.
The hypothesis moves strategy.
The proof freezes when the hand ends.
```

Uncertainty is the hard boundary. A glance is not a tell. A tense phrase is not a diagnosis. A pattern only counts when it attaches to a real decision and survives what happens next.

## Why I built it this way

The interesting part of CVI is not video wrapped around a chatbot. It is software in the room with you, acting on what happens there. Poker forces every layer to earn its place. Raven has to perceive something that matters. Sparrow has to time a response a human would time. Phoenix has to hold a face that gives nothing away. The LLM has to decide under hidden information instead of answering a question.

A support agent or a tutor lets you fake most of that. A poker opponent does not. It has a face, a voice, a seat, private information, memory, and a reason to watch.

When it works, you stop feeling like you are prompting a model. You feel like you are trying to beat someone who is watching back.
