# TavusPoker Product Scope

## One-Line Pitch

Play a real heads-up no-limit hold'em match against a Tavus CVI opponent that talks, bluffs, watches for tells, remembers you, and adapts until there is a winner.

## Why This Project

Poker makes CVI product-critical. A normal chatbot can calculate pot odds, but it cannot sit across from you, wait through your silence, notice your timing, pressure you verbally, or make a read feel embodied.

TavusPoker makes Tavus central:

- Tavus is the opponent.
- Raven is the intended perception layer.
- The opponent brain converts perception into uncertain reads.
- The poker engine keeps objective truth fair and auditable.

## Core Experience

1. Start a heads-up sit-and-go with equal stacks.
2. Start the Tavus room.
3. Play legal no-limit hold'em hands with hidden Tavus cards.
4. Say actions out loud through the Tavus call; backup controls commit through the same legal engine path.
5. The app binds Raven perception, timing, words, and committed action to the exact poker decision window.
6. The opponent brain records evidence and maps behavior to poker tendencies.
7. Tavus policy privately uses cards, pot odds, and active reads.
8. Post-hand debrief shows the evidence-backed read.
9. The match continues with rising blinds until one player has all chips.

## MVP Scope

In scope:

- One human vs one Tavus opponent.
- Real heads-up no-limit Texas hold'em.
- Button alternation, blinds, rising blind levels, stacks, legal actions, folds, streets, showdown, and match winner.
- Hidden Tavus hole cards until showdown.
- Tavus bluff/value/trap/semi-bluff/thin-value behavior.
- Opponent brain with perception signals, reads, confidence, strategy bias, traces, and debriefs.
- Decision windows that bind signals to street, pot, facing bet, stacks, latency, speech, and committed action.
- Raven perception tool-call ingestion.
- Local timing and committed-action signals as baseline engine evidence.
- Live Tavus room mounting with Daily.
- Live `conversation.overwrite_llm_context` state snapshots to Tavus.
- Server-side Tavus API proxy.
- Raven-enabled persona creation endpoint with poker tell tools.

Out of scope:

- Real-money gambling.
- Multiplayer tables.
- Persistent accounts.
- Full hand-history database.
- Production anti-cheat or server-authoritative deck custody.
- Solver-perfect GTO poker.
- Deterministic claims that a facial/audio tell proves a bluff.

## Product Principles

- Tavus is a player, not a coach.
- The table is the product surface.
- Tavus must feel physically present and important across the felt, never a fake avatar or a generic meeting tile.
- The prototype app owns truth locally: cards, stacks, pot, legality, and winner.
- The brain owns memory: signals, reads, confidence, and evidence.
- Tavus owns presence: table talk, pressure, reaction, and embodied interaction.
- Live reads stay private; proof appears only after the hand or in post-hand Judge/replay mode.
- A hand ending is not the experience ending; it must resolve the pot, show the consequence, offer proof, and continue the match unless a stack is gone.

## Success Criteria

- Reviewer can play without setup friction.
- Reviewer can start a Tavus room when credentials are present.
- The app proves hidden information stays sealed.
- The app proves live reads stay private while the hand is playable.
- A post-hand debrief cites evidence IDs.
- `npm run eval` proves behavior changes can alter Tavus strategy.
