# Mole Party

A pass-and-play social-deduction party game for 4 to 10 players on one phone. An AI host deals secret roles, tells a new story every game, throws in a twist each round, speaks the narration aloud, and reads out the votes.

**Play:** https://tomdacatto.github.io/pollinations-mole-party/

The host runs on [Pollinations](https://pollinations.ai) and is paid with the player's own Pollen through [Bring Your Own Pollen](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md). There is no backend: the page talks to `gen.pollinations.ai` directly and the key lives in `sessionStorage` for that tab only. A whole game costs about 0.001 Pollen for text plus about 0.0004 with the spoken host.

## How a game goes

1. **Setup.** Enter the players' names, optionally a story theme ("a haunted lighthouse"), a discussion length and a host voice.
2. **Deal.** The host writes a scenario: a secret place, a scene, 7 decoy places and 10 jobs. Pass the phone around; each player peeks at a private card.
   - **Insider:** has a job at the secret place. Goal: unmask the Impostor without giving the place away.
   - **Impostor:** doesn't know the place, only a vague clue and eight possible places. Goal: blend in. If caught, they get one guess at the place and still win if they are right. From 8 players there are two Impostors.
   - **Jester** (from 5 players): knows the place, wants to be voted out. If the table sends them home, they win alone.
3. **Rounds** (3, or 4 from 8 players). The host narrates the round and announces a twist; a timer runs while everyone talks.
   - Round 1 is always an open vote. Later rounds add one twist: **secret ballot** (only totals are read out), **double vote** (one player's vote counts twice) or **silence** (one player may not speak).
4. **Vote.** Each living player votes on a private ballot screen. The host reads out the votes, and the table sees the tally. Most votes is out, a tie eliminates nobody.
5. **End.** The Impostors win if they match the rest of the table or survive the last round. The Insiders win if the last Impostor is caught and guesses wrong.

## How the AI is used

| Job | Endpoint / model |
| --- | --- |
| Scenario (JSON: place, decoys, jobs, clue, intro) | `POST /v1/chat/completions`, `openai/gpt-5.4-nano` with `response_format: json_object` |
| Round narration, vote reactions, epilogue | same model, short prompts |
| Spoken host | `POST /v1/audio/speech`, `hexgrad/kokoro-82m` (falls back to the browser voice) |

The host only tells the story. **Every rule is plain code** in [`engine.js`](engine.js): role assignment, twists, vote tallies, the read-out lines, win checks. So the AI can never miscount a vote or leak who is who. Public lines are also checked so the secret place is not named ([`leaks`](engine.js)), with a retry and a plain fallback, so a model hiccup cannot stop a game.

## Run it

Serve the folder with any static server, for example `npx serve .`. Sign-in needs the deployed URL (the App Key's redirect URI is `https://tomdacatto.github.io/pollinations-mole-party/`); to run your own copy, create an App Key at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys), register your URL as its redirect URI and put the key in `config.js`.

```bash
node --test engine.test.js
```

## Files

- `engine.js`, `engine.test.js`: the rules and their tests
- `host.js`: prompts, checks, fallbacks, speech
- `pollen.js`: Bring Your Own Pollen sign-in (OAuth code + PKCE) and the Pollinations client
- `app.js`, `index.html`, `style.css`: the game UI

MIT licensed.
