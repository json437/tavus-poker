# Demo Script

## 30-Second Setup

"I built TavusPoker, a true heads-up poker match where Tavus is the opponent. The point is not poker in a browser. The point is CVI: Tavus can talk, pressure, observe timing and behavior, build reads, and adapt strategy inside a real game."

## Live Walkthrough

1. Open `http://localhost:5173`.
2. Point out Tavus, You, the table, stacks, blinds, and hidden Tavus cards.
3. Start the Tavus room.
4. Say an action out loud.
5. Click the matching legal action, or size a bet/raise with the wager control.
6. Explain that the live brain is private; the app is binding timing/action evidence and Raven tool-call evidence to the current decision window.
7. Continue until fold or showdown.
8. Show the post-hand debrief with evidence IDs.
9. Toggle Replay/Judge mode to reveal the full causal trace after the hand is over.
10. Point out that the match continues with rising blinds until one player busts.

## What To Emphasize

- Tavus is the player, not a video skin.
- The app owns objective poker truth.
- The opponent brain owns memory and uncertainty.
- A real opponent does not reveal live tells; exact proof appears only after the hand.
- Raven is the intended source for visual/audio tells; local timing and committed actions are the baseline engine signal path.
- The app sends live match/brain updates through Daily app messages when a Tavus room is active.
- The debrief cites evidence instead of hand-waving about "AI reads."

## Suggested Loom Structure

0:00 - Product hook.
0:20 - Show the real table and hidden cards.
0:45 - Start Tavus.
1:15 - Make a spoken decision.
1:45 - Show read/evidence update.
2:15 - Resolve the hand and debrief.
2:45 - Toggle Judge trace.
3:10 - Show architecture/evals.

## If Live Readiness Fails

If Tavus minutes, keys, or browser permissions fail:

1. Say the live Tavus seat is not ready.
2. Show the readiness checker output.
3. Show the automated poker, brain, and disclosure evals.
4. Explain which external dependency failed.
5. Do not present the local engine path as the product experience.
