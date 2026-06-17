# TavusPoker

TavusPoker is a real heads-up no-limit hold'em match where the Tavus CVI is the opponent.

The product idea: poker is a strong test for Conversational Video Interface because speech alone is not enough. The opponent needs presence, timing, pressure, bluffing, interruption, and visual/audio tell-reading. Tavus becomes the player across the table, while the app owns deterministic card state, pot state, scoring, and opponent memory.

## What It Shows

- A Tavus-native title screen built around the player challenge: can you beat Tavus at poker?
- Tavus as an active poker opponent, not a sidecar coach.
- A table-first match room: Tavus is visually across the felt as the opponent, while Raven/brain signals stay hidden until post-hand proof.
- A player action rail that keeps your stack, cards, spoken-action prompt, legal actions, and wager sizing in view.
- No fake local self-video panel; perception proof comes from Tavus/Raven events and the post-hand evidence chain.
- Hidden Tavus hole cards, blinds, button, stacks, legal actions, streets, folds, showdown, rising blinds, and match winner.
- A local poker engine that conserves chips and advances betting rounds.
- An opponent brain that turns Raven perception, timing, and action signals into evidence-backed reads and Tavus strategy bias.
- Final Tavus user utterance events are captured as speech evidence for the active poker decision.
- Decision windows that bind behavior and words to the exact poker spot: street, pot, facing bet, action, and latency.
- A private live brain that uses tells to compete, with proof revealed only after the hand.
- Honest post-hand proof: reads are either spent on a Tavus action or banked for future spots, and the proof drawer only shows reads tied to that completed hand.
- Daily-based Tavus room mounting with live `conversation.overwrite_llm_context` state sync.
- A secure Tavus API proxy that keeps API keys server-side.
- A persona design that uses Raven perception for probabilistic tells.
- A polished demo surface plus product docs for architecture, validation, and live-read boundaries.
- A blog-post style writeup that tells the project story, product thesis, and architecture.
- A validation matrix that separates automated proof from live Tavus/Raven checks.

## Run It

```bash
cd /Users/jason/tavus-poker
npm install
cp .env.example .env
npm run dev:all
```

Open `http://localhost:5173`.

Routes:

- `/` opens the title/onboarding screen.
- `/play` opens the playable heads-up match.
- `/blog` opens the reviewer-facing project writeup inside the app.

From `/`, choose **Play with Tavus** to reach the playable table.

For the full Tavus room, add these to `.env`:

```bash
TAVUS_API_KEY=tvsk_...
TAVUS_REPLICA_ID=rbe2c395e725
TAVUS_PERSONA_ID=your_raven_enabled_persona_id
TAVUS_TEST_MODE=false
TAVUS_REQUIRE_AUTH=false
```

The app can still run the local poker engine during development, but the full live path assumes a Tavus key and Raven-enabled persona.

Set `TAVUS_TEST_MODE=true` when you only want to verify the Tavus API payload path. Tavus returns an ended test conversation in that mode, and the app will show it as verified without trying to join a Daily room.

Set `TAVUS_REQUIRE_AUTH=true` if you want Tavus to create private Daily rooms. When Tavus returns a `meeting_token`, the app passes it into Daily during join.

## Validation Boundary

The local app verifies the poker engine, UI/Tavus-context hidden-information rules, opponent brain, read-disclosure guard, proof ledger, Tavus API payloads, and browser UI. It is not a production anti-cheat architecture because the browser owns the local deck and game state for demoability. A full Tavus/Raven claim still needs one live room run with camera and mic permissions granted. See [Live Validation](./docs/LIVE_VALIDATION.md) for the exact matrix.

Important learner boundary: Raven perception is banked as evidence first. It does not become active Tavus strategy until it binds to a committed poker decision. This keeps the demo honest: the app shows evidence-backed hypotheses, not magic certainty.

## Tavus Integration

- `server.ts` exposes a local API proxy.
- `api/**` exposes the same Tavus proxy shape for Vercel deployment.
- `POST /api/tavus/conversations` creates a Tavus conversation for the current hand.
- `POST /api/tavus/conversations/:conversationId/end` closes the active room.
- `POST /api/tavus/personas/table-player` creates a Raven-enabled table-player persona with poker tell tools.
- `src/domain/holdem.ts` builds sealed game context with Tavus private cards and poker boundaries.
- `src/domain/opponentBrain.ts` builds the live opponent-brain context: signals, reads, evidence IDs, and strategy traces.
- `src/lib/daily.ts` overwrites live match/brain snapshots in the active Tavus room and echoes Tavus table talk.
- Private Tavus rooms are supported with `TAVUS_REQUIRE_AUTH=true`; returned `meeting_token` values are passed into Daily join.
- `src/lib/tavusEvents.ts` parses Tavus interaction events for final user speech and Raven perception evidence.

Tavus docs used:

- [Create conversation](https://docs.tavus.io/api-reference/conversations/create-conversation)
- [CVI overview](https://docs.tavus.io/sections/conversational-video-interface/overview-cvi)
- [Interaction Events](https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview)
- [Overwrite conversational context](https://docs.tavus.io/sections/event-schemas/conversation-overwrite-context)
- [Perception layer](https://docs.tavus.io/sections/conversational-video-interface/persona/perception)
- [Perception tool calling](https://docs.tavus.io/sections/conversational-video-interface/persona/perception-tool)

## Product Docs

- [Blog Post](./docs/BLOG_POST.md)
- [Product Scope](./docs/PRODUCT_SCOPE.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Tavus Persona](./docs/TAVUS_PERSONA.md)
- [Tests And Evals](./docs/EVALS.md)
- [Live Validation](./docs/LIVE_VALIDATION.md)
- [Demo Script](./docs/DEMO_SCRIPT.md)

## Verification

```bash
npm test
npm run eval
npm run verify:tavus
npm run lint
npm run build
```

`npm run verify:tavus` checks the local API and safe Tavus config without touching Tavus credits. To verify Tavus API reachability and conversational credits, run:

```bash
npm run verify:tavus -- --probe
```

The probe prints only sanitized readiness fields. It does not join a Daily room or request camera/mic permissions.

## Deploy

The app is Vercel-ready. Configure the same server-side env vars in Vercel, then deploy from the repo:

```bash
vercel
vercel --prod
```

`vercel.json` rewrites `/play` and `/blog` to the Vite app while `/api/**` stays server-side.
