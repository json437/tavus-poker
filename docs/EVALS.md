# TavusPoker Tests And Evals

## Evaluation Philosophy

The product is only good if the causal loop is real:

```text
speech/perception/action signal -> opponent read -> Tavus strategy -> poker action -> evidence-backed debrief
```

Normal tests protect the poker engine. Product evals protect the Tavus-native thesis.

## Automated Checks

### Unit Tests

Command:

```bash
npm test
```

Coverage:

- Heads-up hands start with unique cards, blinds, private hands, and legal action.
- Live Tavus context includes Tavus private cards but never includes the human player's hole cards before showdown.
- Hero actions plus Tavus responses conserve total chips.
- Blinds rise and the engine refuses to restart after a match winner.
- Opponent brain creates evidence-backed reads.
- Same cards with different observed behavior produce different strategy bias.
- Tavus decision traces cite behavioral evidence when a read is active.
- Legacy spot evaluator still covers older poker helpers.

### Static Checks

Command:

```bash
npm run lint
npm run build
```

Coverage:

- React/TypeScript compile.
- No lint failures.
- Production build succeeds.

### Product Eval Harness

Command:

```bash
npm run eval
```

Coverage:

- Generated deck states have no duplicate cards.
- Betting actions use positive sizes.
- Heads-up hold'em hands enforce blinds, legal actions, and chip conservation.
- Short-stack all-ins stay legally bounded: call-only stacks cannot raise, unmatched chips are returned, and Tavus cannot bet into an all-in opponent.
- Raise history uses the target amount (`raises to $X`) while preserving incremental chips in the action note.
- Blind schedule escalates so the match can reach a winner.
- Deterministic full-match simulations reach a winner without chip drift, illegal empty hero turns, or stuck Tavus turns.
- Seeded full-match simulations are reproducible; Tavus equity sampling must use the provided seeded RNG, not global randomness.
- Tavus line mix includes deception.
- Tavus context includes poker state plus opponent brain state.
- Opponent brain creates evidence-backed reads.
- Different behavior on the same cards changes Tavus strategy.
- Tavus behavioral decisions cite evidence.
- Every Tavus action receives its own strategy trace, including cases where auto-play crosses from one street to the next in a single hero action.
- Raven perception events feed the opponent brain without creating fake poker actions.
- Final Tavus user utterance events bind spoken words to the current poker decision.
- Spoken poker actions from the Tavus room and browser mic parse through the legal engine; all-in, pot, and amount-only clarification are supported.
- Incomplete or illegal spoken actions ask for clarification instead of silently clamping to a different move.
- Tavus context/persona instructions forbid telling the player to click buttons, use sliders, or operate the UI to play.
- Behavior signals bind to concrete decision windows with pot, facing bet, action, and latency.
- Learning-only hands bank evidence without claiming Tavus spent the read on an action.
- Post-hand proof is scoped to the resolved hand; it must never show a previous hand's Tavus trace, debrief, read, or evidence signal when the current hand did not produce it.
- The opening screen poses the player challenge before the match starts.
- Product docs exist and explain scope, architecture, validation, and live Tavus boundaries.
- The UI source keeps Tavus embodied as the opponent across the table and rejects live telemetry panels.
- The far-seat surface is either the real Tavus/Daily video frame or an honest empty seat; product evals reject fake Tavus avatars.
- Live player view gates proof and never renders raw opponent-brain context.
- The first viewport remains playable on desktop by keeping wager controls compact and avoiding fake self-video panels.
- Narrow mobile/tablet viewports keep the table readable by compacting the action dock instead of covering the game.
- Mid-width post-action states stack wager controls before preset buttons can create horizontal overflow.

## Manual Browser Evals

### Opening Screen

Pass criteria:

- The first screen makes the challenge legible: Tavus can see, hear, bluff, remember, and pressure decisions until one stack is gone.
- The opening screen has one obvious entry action into the match.
- It feels like a game title/onboarding screen, not a marketing landing page.
- No horizontal overflow on desktop, the current in-app browser width, or mobile phone width.

### Match Viewport

Pass criteria:

- Tavus, You, and the real table are visible.
- Tavus appears as the live CVI opponent across the felt, not as a dashboard coach or generic metrics panel.
- Your cards, stack, spoken-action prompt, legal backup actions, and wager sizing are visible without replacing the video-call interaction.
- The app does not show a fake local camera placeholder as proof of perception.
- The primary interaction is a playable match, not a telemetry dashboard.
- Start Tavus is visible.
- If no Tavus API key is configured, the local game remains playable and the Tavus room control is disabled instead of making a doomed API call.
- Hidden Tavus cards are card backs.
- The player can act without reading the docs.
- No horizontal overflow on desktop, the current in-app browser width, or mobile phone width.
- The action dock does not bury the table on mobile or the current in-app browser width.
- After a live action that changes bet sizing, wager presets remain inside the viewport at desktop, mid-width, tablet, and phone sizes.

### Live Hand

Pass criteria:

- Spoken legal actions and backup buttons match the current betting state.
- Tavus asks for poker actions in-world and never tells the player to click, press, tap, drag, or use UI controls.
- A clear spoken action can play the hand through the call; ambiguous raises ask for an amount.
- Raise labels, history, and debrief language use poker-standard target sizing rather than only the newly paid chips.
- Short stacks see all-in/call-only actions with the actual remaining stack amount instead of impossible raises, blind all-ins resolve immediately, and uncalled chips return before showdown.
- Hands that end by fold keep Tavus cards mucked and do not treat completion as showdown.
- Tavus river equity is range-based and does not use the human player's hidden cards before showdown.
- The big blind option is modeled as check-or-raise, not as an illegal bet into an existing blind.
- Wager controls support legal bet/raise sizing.
- Timing/action signals create evidence in automated engine tests without requiring a live Tavus room.
- Raven perception tool-call events create evidence when a Raven persona is active.
- Final Tavus user utterances become speech evidence for the active decision window.
- Tavus may act differently after a strong tell.
- During the live hand, exact reads, confidence, evidence IDs, and strategy bias stay sealed even if replay controls are visible.
- After completion, the debrief cites evidence IDs.
- Replay/history must account for every Tavus decision in the hand, not only the final Tavus action.
- If the hand ended before Tavus acted on the new read, the debrief says the read was banked for later.
- If the current hand has no Tavus decision trace, debrief read, or evidence, replay/proof must not borrow traces, reads, or signals from an earlier hand.
- Replay/Judge proof is unavailable until the hand is complete.

### Match

Pass criteria:

- Stacks persist hand to hand.
- Button alternates.
- Blinds rise after the configured interval.
- Match ends when one player has all chips.
- Automated match seeds prove the above path reaches real winners while preserving the original chip total.
- New match resets cleanly.

### Live Tavus

Pass criteria:

- Start Tavus creates an active `tavus.daily.co` room.
- The app mounts the room through Daily.
- The conversation payload includes `replica_id` plus `persona_id` when a persona is configured.
- If private rooms are enabled, the payload requests `require_auth` and the returned `meeting_token` is passed to Daily join.
- The app sends updated match/brain snapshots with `conversation.overwrite_llm_context`.
- Tavus table talk can be echoed into the room.
- Tavus final user utterance events are captured without using partial streaming text as settled evidence.
- Raven `conversation.perception_tool_call` events are ingested into the opponent brain.
- Tavus `test_mode` conversations are treated as API verification and are not mounted as live Daily rooms when Tavus returns them ended.
- Test-mode or ended rooms must not show copy that implies Tavus is listening through a mounted Daily room.
- End Tavus closes the room without breaking the local match.

Evidence boundary:

- Automated tests verify the payload builders, event parsers, and local brain ingestion path.
- Browser smoke verifies the room mount surface and sealed player UI.
- A real camera/mic run is required before claiming Raven successfully perceived the reviewer in the live environment.

## Persona Evals

Pass:

- Tavus speaks as the opponent.
- Tavus jokes, needles, probes, and reacts naturally.
- Tavus treats tells as probabilistic.
- Tavus uses live reads privately and does not reveal the exploit while the hand is playable.
- Tavus never reveals private cards before showdown.
- Tavus can admit a read was weakened.

Fail:

- Tavus behaves like a coach.
- Tavus gives generic poker advice instead of playing.
- Tavus claims certainty from facial or voice cues.
- Tavus references hidden cards or read traces before they should be revealed.

## Pre-Submission Checklist

Run:

```bash
npm test
npm run eval
npm run lint
npm run build
```

Then record a Loom:

1. Start on `http://localhost:5173`.
2. State the thesis: Tavus is the poker opponent that learns the player.
3. Run `npm run verify:tavus -- --probe` before recording the live Tavus version.
4. Start Tavus.
5. Play at least one hand with a spoken action and committed wager/action.
6. Show the post-hand debrief and evidence IDs.
7. Toggle Judge mode to show the full trace.
8. Mention the match continues until a winner with rising blinds.
9. Mention which items were automated, browser-smoked, and live-validated using `docs/LIVE_VALIDATION.md`.
