// The rules of Mole Party. Pure functions: no DOM, no network, no AI.
// The host (AI) only tells the story; everything that decides who wins is here.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
export const TWISTS = ["open", "secret", "double", "silence"];

export const impostorCount = (n) => (n >= 8 ? 2 : 1);
export const roundCount = (n) => (n >= 8 ? 4 : 3);

export function shuffle(list, rng = Math.random) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function validateNames(names) {
    const clean = names.map((n) => n.trim());
    if (clean.length < MIN_PLAYERS || clean.length > MAX_PLAYERS) {
        return `Mole Party needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`;
    }
    if (clean.some((n) => !n)) return "Every player needs a name.";
    const seen = new Set(clean.map((n) => n.toLowerCase()));
    if (seen.size !== clean.length) return "Player names must be different.";
    return null;
}

// Roles: 1 Impostor (2 from 8 players), 1 Jester from 5 players, the rest
// Insiders. Everyone but the Impostor gets a job at the secret place.
export function assignRoles(names, jobs, rng = Math.random) {
    const problem = validateNames(names);
    if (problem) throw new Error(problem);
    const n = names.length;
    const order = shuffle(names, rng);
    const impostors = new Set(order.slice(0, impostorCount(n)));
    const jester = n >= 5 ? order[impostorCount(n)] : null;
    const pool = shuffle(jobs.length ? jobs : ["Guest"], rng);
    let next = 0;
    return names.map((name) => {
        if (impostors.has(name)) {
            return { name, role: "impostor", job: null, alive: true };
        }
        const job = pool[next++ % pool.length];
        return {
            name,
            role: name === jester ? "jester" : "insider",
            job,
            alive: true,
        };
    });
}

export const alive = (players) => players.filter((p) => p.alive);

// Round 1 is always an open vote so the table learns the rules. After that the
// host picks any twist except the one just used.
export function pickTwist(players, round, previous, rng = Math.random) {
    const living = alive(players);
    const type =
        round === 1
            ? "open"
            : shuffle(
                  TWISTS.filter((t) => t !== previous),
                  rng,
              )[0];
    const target =
        type === "double" || type === "silence"
            ? living[Math.floor(rng() * living.length)].name
            : null;
    return { type, target };
}

export function ruleText({ type, target }) {
    return {
        open: "Open vote: every vote is read out, name by name.",
        secret: "Secret ballot: only the totals are read out.",
        double: `${target}'s vote counts double this round.`,
        silence: `${target} must stay silent during the discussion, but still votes.`,
    }[type];
}

// votes: { voterName: accusedName }. Ties eliminate nobody.
export function tally(votes, twist) {
    const counts = {};
    for (const [voter, accused] of Object.entries(votes)) {
        const weight =
            twist.type === "double" && twist.target === voter ? 2 : 1;
        counts[accused] = (counts[accused] ?? 0) + weight;
    }
    const max = Math.max(0, ...Object.values(counts));
    const top = Object.keys(counts).filter((name) => counts[name] === max);
    return { counts, max, eliminated: top.length === 1 ? top[0] : null };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the host reads out. Numbers and names come from here, never from the AI.
export function readout(players, votes, twist, result) {
    const order = players.map((p) => p.name);
    if (twist.type === "secret") {
        const lines = Object.keys(result.counts)
            .sort(
                (a, b) =>
                    result.counts[b] - result.counts[a] ||
                    order.indexOf(a) - order.indexOf(b),
            )
            .map(
                (name) =>
                    `${name} received ${plural(result.counts[name], "vote")}.`,
            );
        return lines.length ? lines : ["Nobody was accused."];
    }
    return order
        .filter((name) => votes[name])
        .map((name) => `${name} votes for ${votes[name]}.`);
}

export function eliminate(players, name) {
    return players.map((p) => (p.name === name ? { ...p, alive: false } : p));
}

// After a vote. Returns { over, winner, reason } or { over: false } or
// { guess: true } when the last Impostor was caught and gets one guess.
export function checkEnd(players, round, maxRounds, eliminatedName) {
    const out = players.find((p) => p.name === eliminatedName);
    if (out?.role === "jester") {
        return {
            over: true,
            winner: "jester",
            reason: `${out.name} the Jester got voted out and wins alone.`,
        };
    }
    const living = alive(players);
    const impostors = living.filter((p) => p.role === "impostor").length;
    if (impostors === 0) return { over: false, guess: true };
    if (impostors >= living.length - impostors) {
        return {
            over: true,
            winner: "impostors",
            reason: "The Impostors now match the rest of the table.",
        };
    }
    if (round >= maxRounds) {
        return {
            over: true,
            winner: "impostors",
            reason: "The last round ended with an Impostor still hiding.",
        };
    }
    return { over: false };
}

export function resolveGuess(place, guess) {
    return guess === place
        ? {
              over: true,
              winner: "impostors",
              reason: `The caught Impostor still named ${place}.`,
          }
        : {
              over: true,
              winner: "insiders",
              reason: `The Impostor was caught and guessed wrong. The place was ${place}.`,
          };
}

const STOPWORDS = new Set([
    "the",
    "and",
    "of",
    "a",
    "an",
    "in",
    "on",
    "at",
    "to",
    "de",
    "la",
]);

// Public narration must not give the place away.
export function leaks(text, place) {
    const lower = text.toLowerCase();
    return place
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
        .some((w) => lower.includes(w));
}
