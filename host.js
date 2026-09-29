// The AI host: writes the scenario and the narration, and speaks it aloud.
// It never decides anything; engine.js does. Public lines are checked so the
// secret place is not given away, and every call has a plain fallback so a
// model hiccup cannot stop a game.
import { leaks } from "./engine.js";
import { chat, chatJson, speak } from "./pollen.js";

const PERSONA =
    "You are the host of a social-deduction party game: theatrical, dry-witted, brief. " +
    "Everything you write is read aloud to the whole table, including the Impostor, so never name or describe the secret place. " +
    "Never invent votes, names or rules.";

const SCENARIO_KEYS = `Return JSON with exactly these keys:
- title: short game title
- place: the secret location, 2-4 words (for example "Orbital Greenhouse")
- premise: two sentences that set the scene without naming the place
- hint: one vague clue about the place for someone who does not know it, using none of its words
- decoys: array of 7 other plausible locations, 2-4 words each, all different from place and from each other
- jobs: array of 10 different jobs people could have at the place, 1-3 words each
- intro: the host's opening, at most 60 words, dramatic, not naming the place`;

// Models like to add markdown; the host is read aloud, so strip it.
const plain = (t) =>
    t
        .replace(/[*_`#]/g, "")
        .replace(/\s+/g, " ")
        .trim();

const text = (v) => typeof v === "string" && v.trim().length > 0;

export function checkScenario(s, count) {
    if (![s?.title, s?.place, s?.premise, s?.hint, s?.intro].every(text))
        return "missing text fields";
    const decoys = Array.isArray(s.decoys)
        ? [...new Set(s.decoys.filter(text))]
        : [];
    if (decoys.length < 7 || decoys.includes(s.place))
        return "needs 7 different decoys";
    if (!Array.isArray(s.jobs) || s.jobs.filter(text).length < count)
        return "not enough jobs";
    if ([s.premise, s.hint, s.intro, s.title].some((t) => leaks(t, s.place)))
        return "public text names the place";
    return null;
}

export async function newScenario({ count, theme }) {
    const prompt =
        `Invent a fresh scenario for ${count} players. Theme: ${theme?.trim() || "surprise me"}.\n` +
        `${SCENARIO_KEYS}\nVariety token: ${Math.random().toString(36).slice(2, 8)}`;
    let problem = "unknown";
    for (let attempt = 0; attempt < 2; attempt++) {
        const s = await chatJson(
            [
                { role: "system", content: `${PERSONA} Reply with JSON only.` },
                { role: "user", content: prompt },
            ],
            { temperature: 1 },
        );
        problem = checkScenario(s, count);
        if (!problem) {
            return {
                ...s,
                decoys: [...new Set(s.decoys.filter(text))].slice(0, 7),
                jobs: s.jobs.filter(text),
            };
        }
    }
    throw new Error(
        `The host could not write a usable scenario (${problem}). Try again.`,
    );
}

// Ask for public prose; retry once if it leaks the place; else use the fallback.
async function publicLine(scenario, prompt, fallback, maxWords) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const line = plain(
                await chat(
                    [
                        { role: "system", content: PERSONA },
                        { role: "user", content: prompt },
                    ],
                    { temperature: 1 },
                ),
            );
            if (
                line &&
                line.split(" ").length <= maxWords * 1.6 &&
                !leaks(line, scenario.place)
            )
                return line;
        } catch (e) {
            if (e.status === 401 || e.status === 402) throw e;
        }
    }
    return fallback;
}

export function narrateRound(scenario, { round, rounds, twist, aliveCount }) {
    return publicLine(
        scenario,
        `Scenario: ${scenario.title}. ${scenario.premise}\n` +
            `Narrate the start of round ${round} of ${rounds} with ${aliveCount} players left. ` +
            `Invent one eerie twist in the story that raises suspicion (mood only; the rule for this round is "${twist}", do not state any rule). ` +
            `At most 40 words, no place words.`,
        `Round ${round} begins. Someone at this table is not who they claim to be.`,
        40,
    );
}

const ROLE_LABEL = {
    insider: "an Insider",
    impostor: "the Impostor",
    jester: "the Jester",
};

// Lead-in and reveal around the code-written vote read-out.
export async function reactToVote(scenario, { accused, role, last, guess }) {
    const fact = accused
        ? `${accused} was voted out and was ${ROLE_LABEL[role]}.`
        : "The vote was tied, so nobody was voted out.";
    const [lead, reveal] = await Promise.all([
        publicLine(
            scenario,
            `The table has cast its votes. Write one tense sentence (at most 20 words) to introduce the read-out. Do not reveal any result.`,
            "The votes are in.",
            20,
        ),
        publicLine(
            scenario,
            `Fact: ${fact}${guess ? " The Impostor now gets one last guess at the place." : last ? " The game ends now." : ""}\nReact in at most 30 words. Do not add facts, names or numbers beyond this one.`,
            accused
                ? `${accused} was ${ROLE_LABEL[role]}.`
                : "Nobody was voted out.",
            30,
        ),
    ]);
    return { lead, reveal };
}

export function epilogue(scenario, { winner, reason }) {
    const who = {
        impostors: "the Impostors",
        insiders: "the Insiders",
        jester: "the Jester",
    }[winner];
    return chat(
        [
            {
                role: "system",
                content: PERSONA.replace(
                    "never name or describe the secret place",
                    "you may now name the secret place",
                ),
            },
            {
                role: "user",
                content: `The game is over. Winner: ${who}. Why: ${reason} The secret place was ${scenario.place}. Write a closing line of at most 50 words.`,
            },
        ],
        { temperature: 1 },
    ).then(
        (line) => plain(line) || reason,
        (e) => {
            if (e.status === 401 || e.status === 402) throw e;
            return reason;
        },
    );
}

// --- speech ------------------------------------------------------------------

let audio = null;
let speech = 0;

export function stopSpeaking() {
    speech += 1;
    audio?.pause();
    audio = null;
    globalThis.speechSynthesis?.cancel();
}

function play(url) {
    return new Promise((resolve) => {
        audio = new Audio(url);
        audio.onended = audio.onerror = () => resolve();
        audio.play().catch(resolve);
    });
}

function browserVoice(line) {
    return new Promise((resolve) => {
        if (!globalThis.speechSynthesis) return resolve();
        const u = new SpeechSynthesisUtterance(line);
        u.onend = u.onerror = () => resolve();
        globalThis.speechSynthesis.speak(u);
    });
}

// Speaks a line and resolves when it ends or is skipped. Falls back to the
// browser voice if the Pollinations voice is unavailable.
export async function say(line, { voice, enabled = true } = {}) {
    if (!enabled || !line) return;
    stopSpeaking();
    const mine = speech;
    try {
        const url = await speak(line, { voice });
        if (mine === speech) await play(url);
    } catch (e) {
        if (e.status === 401 || e.status === 402) throw e;
        if (mine === speech) await browserVoice(line);
    }
}
