# TavusPoker Validation Matrix

This doc keeps the prototype honest: TavusPoker has a local deterministic game, a live Tavus integration path, and a Raven/persona design. Not every layer is proven by the same kind of evidence.

## Implemented And Automated

Verified by `npm test`, `npm run eval`, `npm run lint`, and `npm run build`:

- True 1v1 heads-up no-limit hold'em with blinds, button alternation, legal actions, streets, folds, all-ins, showdown, rising blinds, and match winner.
- Chip conservation across hero actions, Tavus responses, folds, all-ins, and full seeded matches.
- Tavus hole cards stay hidden in the player UI until a real showdown.
- Hands ending by fold keep Tavus cards mucked.
- Human hole cards are not included in the live Tavus context before showdown.
- Tavus river equity is range-based and does not use hidden human cards before showdown.
- Short-stack calls are labeled as all-in for the actual remaining stack.
- Blind-post all-ins resolve without offering bogus action.
- Spoken commands from browser mic and final Tavus/Daily user utterances parse through the same legal action validator as backup controls.
- Amount-only raise clarification, pot, and all-in speech are handled; incomplete or illegal spoken raises are rejected instead of silently clamped.
- Tavus context and persona instructions prohibit telling the player to click buttons, use sliders, or play through UI controls.
- Opponent brain creates evidence-backed reads from timing, action, speech, and Raven-style signals.
- Same cards plus different observed behavior can change Tavus strategy.
- Tavus decision traces cite evidence IDs when behavioral reads affect strategy.
- Learning-only hands bank evidence without pretending Tavus spent the read.
- Post-hand proof is scoped to the completed hand instead of borrowing previous-hand reads, traces, or signals.
- Tavus conversation and persona payload builders include the expected replica, persona, private-room, and Raven tool-call fields.
- Live Tavus start preflights browser camera and microphone access before creating the room, so the app does not deal a fake live hand when Tavus cannot watch or hear.

## Implemented And Browser-Smoked

Verified through the local app at `http://localhost:5173`:

- The first screen is a focused player challenge, and `/play` opens the pre-deal table seat before any cards are exposed.
- Tavus is present as the live CVI opponent beside a visible, playable poker table.
- The human seat shows cards, stack, legal actions, spoken-action prompt, and wager sizing.
- No fake local self-video panel is used as perception proof.
- Proof/Judge mode is unavailable until the hand is complete.
- Live player mode does not render raw opponent-brain context, read confidence, evidence IDs, or strategy bias.
- Tavus cards render as card backs during live play.
- No obvious desktop horizontal overflow or console errors on the smoke viewport.

## Prototype Security Boundary

This local prototype keeps hidden information sealed from the player UI and from Tavus context before showdown, but it is not a production anti-cheat architecture. The browser owns the deck and game state so the demo can run locally. A production version would move deck custody, legal-action validation, and settlement to a server-authoritative game service.

## Requires A Live Tavus/Raven Run

These are implemented as integration paths, but must be validated with a real Tavus room, camera, mic, and a Raven-enabled persona before claiming live production behavior:

- `npm run verify:tavus -- --probe` passes, proving the local proxy can reach Tavus and the account has conversational credits.
- Tavus creates an active Daily room with the configured replica/persona.
- The Tavus account has conversational credits available; if the API reports exhausted credits, local validation can continue but live Tavus/Raven validation cannot be claimed.
- Browser camera and microphone permissions are granted by the user; without this, the app stays out of the live Tavus path.
- Daily mounts the live Tavus room in the opponent seat.
- If Tavus returns an active conversation without a joinable URL, the UI says no room was joined instead of implying live media.
- `conversation.overwrite_llm_context` updates are accepted by the live conversation during play.
- Tavus final user utterance events arrive and bind to the active decision window.
- Spoken player actions in the live Tavus room commit legal poker actions without the player using backup controls.
- Raven `conversation.perception_tool_call` events arrive from real visual/audio perception and update the opponent brain.
- The status pill and voice prompt say the room is live only after the Daily room is actually active.
- Tavus table talk feels natural, competitive, and does not reveal exact live tells.
- Tavus runs the hand through in-world dealer/opponent language and never tells the user to click, press, tap, drag, or use the UI.
- Live latency is acceptable for a poker decision loop.

## Demo Claim Boundary

Safe claim:

```text
The app implements the full poker engine, private opponent brain, proof ledger, Tavus proxy, Daily room mount, context sync path, and Raven persona/tool-call ingestion. Automated tests and evals verify the game integrity and sealed-information rules. A final live run validates the actual Tavus/Raven media path.
```

Do not claim without a live run:

```text
Raven successfully read my face and voice in this environment.
```

Do claim after a live run only if observed:

```text
In the live room, Tavus/Raven emitted perception and utterance events that entered the same opponent-brain evidence ledger as timing and poker actions.
```

## Readiness Command

Run this before recording a live demo:

```bash
npm run verify:tavus -- --probe
```

Expected ready state:

```text
PASS Local API health
PASS Tavus config
PASS Tavus API test-mode probe
```

If the probe reports exhausted credits, the local poker demo and automated evals are still valid, but the live Tavus/Raven media claim is blocked until credits are restored.
