import {
    alive,
    assignRoles,
    checkEnd,
    eliminate,
    MAX_PLAYERS,
    MIN_PLAYERS,
    pickTwist,
    readout,
    resolveGuess,
    roundCount,
    ruleText,
    shuffle,
    tally,
    validateNames,
} from "./engine.js";
import {
    epilogue,
    narrateRound,
    newScenario,
    reactToVote,
    say,
    stopSpeaking,
} from "./host.js";
import {
    balance,
    completeSignIn,
    getSession,
    signIn,
    signOut,
} from "./pollen.js";

const $app = document.getElementById("app");
const ROLE = { insider: "Insider", impostor: "Impostor", jester: "Jester" };
const VOICES = [
    ["bm_george", "George (British)"],
    ["af_heart", "Heart (warm)"],
    ["am_michael", "Michael (deep)"],
    ["bf_emma", "Emma (crisp)"],
];
const SECONDS = [60, 90, 120, 180];

const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );

function load(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(`mole.${key}`)) ?? fallback;
    } catch {
        return fallback;
    }
}
const save = (key, value) => {
    try {
        localStorage.setItem(`mole.${key}`, JSON.stringify(value));
    } catch {}
};

const state = {
    screen: "landing",
    busy: "",
    error: "",
    pollen: null,
    names: load("names", ["", "", "", "", ""]),
    theme: load("theme", ""),
    seconds: load("seconds", 90),
    voice: load("voice", "bm_george"),
    voiceOn: load("voiceOn", true),
    scenario: null,
    choices: [],
    players: [],
    round: 0,
    rounds: 3,
    twist: null,
    narration: "",
    timeLeft: 0,
    timerOn: false,
    votes: {},
    voteIndex: 0,
    voteStage: "pass",
    pick: null,
    result: null,
    ending: null,
    epilogue: "",
    dealIndex: 0,
    dealStage: "pass",
};

let timer = null;

// --- helpers -----------------------------------------------------------------

const speak = (line) =>
    say(line, { voice: state.voice, enabled: state.voiceOn }).catch(fail);

function fail(e) {
    stopTimer();
    state.busy = "";
    state.error = e?.message || "Something went wrong.";
    if (e?.status === 401) state.screen = "landing";
    render();
}

async function run(label, work) {
    state.busy = label;
    state.error = "";
    render();
    try {
        await work();
        state.busy = "";
    } catch (e) {
        return fail(e);
    }
    render();
}

const refreshPollen = async () => {
    state.pollen = await balance();
    const chip = document.getElementById("pollen");
    if (chip && state.pollen != null) {
        chip.textContent = fmtPollen();
        chip.hidden = false;
    }
};
const fmtPollen = () =>
    state.pollen == null ? "" : `${state.pollen.toFixed(2)} Pollen`;

function stopTimer() {
    clearInterval(timer);
    timer = null;
    state.timerOn = false;
}

function beep() {
    try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    } catch {}
}

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// --- screens -----------------------------------------------------------------

function header() {
    const signedIn = !!getSession();
    return `<header>
        <h1>Mole Party</h1>
        <div class="right">
            ${signedIn ? `<span class="chip" id="pollen" title="Your remaining Pollen budget" ${state.pollen == null ? "hidden" : ""}>${fmtPollen()}</span>` : ""}
            ${signedIn ? `<button class="link" data-act="signout">Sign out</button>` : ""}
        </div>
    </header>`;
}

const screens = {
    landing() {
        return `<section class="hero">
            <p class="kicker">A party game for 4 to 10 players, one device</p>
            <h2>Someone at this table doesn't belong.</h2>
            <p>An AI host deals secret roles, tells a new story every game, throws in a twist each round, and reads out the votes. You bring the suspicion.</p>
            <ul class="steps">
                <li><b>Deal.</b> Pass the phone around; everyone peeks at a private role card.</li>
                <li><b>Discuss.</b> The host narrates, a timer runs, everyone bluffs.</li>
                <li><b>Vote.</b> Secret ballots, read aloud. The host reveals who you got.</li>
            </ul>
            <p class="fine">The host runs on Pollinations and is paid with <b>your own Pollen</b>. A whole game costs a few hundredths of a Pollen. You choose the budget when you sign in.</p>
            <button class="btn primary big" data-act="signin">Sign in with Pollen</button>
        </section>`;
    },

    setup() {
        const rows = state.names
            .map(
                (n, i) => `<div class="row">
                <input data-name="${i}" value="${esc(n)}" placeholder="Player ${i + 1}" maxlength="16" autocomplete="off">
                <button class="icon" data-act="remove" data-i="${i}" aria-label="Remove player ${i + 1}" ${state.names.length <= MIN_PLAYERS ? "disabled" : ""}>✕</button>
            </div>`,
            )
            .join("");
        return `<section>
            <h2>Who's playing?</h2>
            <div class="list">${rows}</div>
            ${state.names.length < MAX_PLAYERS ? `<button class="btn ghost" data-act="add">+ Add player</button>` : ""}
            <label>Story theme <span class="fine">(optional; blank means surprise me)</span>
                <input id="theme" value="${esc(state.theme)}" placeholder="a haunted lighthouse, a cruise ship, a bank heist…" maxlength="60">
            </label>
            <div class="two">
                <label>Discussion
                    <select id="seconds">${SECONDS.map((s) => `<option value="${s}" ${s === state.seconds ? "selected" : ""}>${s / 60 >= 2 ? `${s / 60} min` : `${s} sec`}</option>`).join("")}</select>
                </label>
                <label>Host voice
                    <select id="voice">${VOICES.map(([v, l]) => `<option value="${v}" ${v === state.voice ? "selected" : ""}>${l}</option>`).join("")}</select>
                </label>
            </div>
            <label class="check"><input type="checkbox" id="voiceOn" ${state.voiceOn ? "checked" : ""}> Host speaks aloud</label>
            <button class="btn primary big" data-act="start">Deal the roles</button>
        </section>`;
    },

    deal() {
        const p = state.players[state.dealIndex];
        const intro =
            state.dealIndex === 0
                ? `<div class="story"><h3>${esc(state.scenario.title)}</h3><p>${esc(state.scenario.intro)}</p><button class="link" data-act="skip">Skip narration</button></div>`
                : "";
        if (state.dealStage === "pass") {
            return `<section class="center">${intro}
                <p class="fine">Card ${state.dealIndex + 1} of ${state.players.length}</p>
                <h2>Pass the phone to <span class="name">${esc(p.name)}</span></h2>
                <p>Make sure nobody else is looking.</p>
                <button class="btn primary big" data-act="reveal">I'm ${esc(p.name)}, show my card</button>
            </section>`;
        }
        return `<section>${cardFor(p)}
            <button class="btn primary big" data-act="hide">${state.dealIndex + 1 === state.players.length ? "Hide card and start" : "Hide card and pass on"}</button>
        </section>`;
    },

    round() {
        const living = alive(state.players);
        const chips = living
            .map((p) => {
                const tag =
                    state.twist.target === p.name
                        ? state.twist.type === "double"
                            ? " ✌ double vote"
                            : " 🤐 silent"
                        : "";
                return `<span class="chip ${tag ? "mark" : ""}">${esc(p.name)}${tag}</span>`;
            })
            .join("");
        return `<section>
            <p class="kicker">Round ${state.round} of ${state.rounds}</p>
            <div class="story"><p>${esc(state.narration)}</p><button class="link" data-act="skip">Skip narration</button></div>
            <div class="rule ${state.twist.type}"><b>Twist.</b> ${esc(ruleText(state.twist))}</div>
            <div class="chips">${chips}</div>
            <div class="timer" id="timer">${clock(state.timeLeft)}</div>
            <div class="bar"><i id="bar" style="width:${(state.timeLeft / state.seconds) * 100}%"></i></div>
            <div class="two">
                <button class="btn ghost" data-act="timer">${state.timerOn ? "Pause" : state.timeLeft === state.seconds ? "Start discussion" : "Resume"}</button>
                <button class="btn primary" data-act="callvote">Call the vote</button>
            </div>
        </section>`;
    },

    vote() {
        const living = alive(state.players);
        const voter = living[state.voteIndex];
        if (state.voteStage === "pass") {
            return `<section class="center">
                <p class="fine">Ballot ${state.voteIndex + 1} of ${living.length}</p>
                <h2>Pass the phone to <span class="name">${esc(voter.name)}</span></h2>
                <button class="btn primary big" data-act="ballot">I'm ${esc(voter.name)}, open my ballot</button>
            </section>`;
        }
        const options = living
            .filter((p) => p.name !== voter.name)
            .map(
                (p) =>
                    `<button class="btn choice ${state.pick === p.name ? "on" : ""}" data-act="pick" data-name="${esc(p.name)}">${esc(p.name)}</button>`,
            )
            .join("");
        return `<section>
            <h2>${esc(voter.name)}, who is the Impostor?</h2>
            ${state.twist.type === "double" && state.twist.target === voter.name ? `<p class="rule double">Your vote counts double.</p>` : ""}
            <div class="grid">${options}</div>
            <button class="btn primary big" data-act="lock" ${state.pick ? "" : "disabled"}>Lock in vote</button>
        </section>`;
    },

    result() {
        const r = state.result;
        const bars = Object.entries(r.counts)
            .sort((a, b) => b[1] - a[1])
            .map(
                ([name, n]) =>
                    `<div class="tally"><span>${esc(name)}</span><i style="width:${(n / r.max) * 100}%"></i><b>${n}</b></div>`,
            )
            .join("");
        return `<section>
            <p class="kicker">Round ${state.round} result</p>
            <div class="story"><p>${esc(r.lead)}</p><ul>${r.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><button class="link" data-act="skip">Skip narration</button></div>
            ${bars ? `<div class="tallies">${bars}</div>` : ""}
            ${
                r.accused
                    ? `<div class="reveal ${r.role}"><span>${esc(r.accused)} was</span><b>${ROLE[r.role] === "Insider" ? "an Insider" : `the ${ROLE[r.role]}`}</b></div>`
                    : `<div class="reveal"><b>Tied vote. Nobody is out.</b></div>`
            }
            <div class="story"><p>${esc(r.reveal)}</p></div>
            <button class="btn primary big" data-act="next">${r.end.guess ? "The Impostor's last chance" : r.end.over ? "See how it ended" : "Next round"}</button>
        </section>`;
    },

    guess() {
        const who = state.result.accused;
        const options = state.choices
            .map(
                (c) =>
                    `<button class="btn choice" data-act="guess" data-place="${esc(c)}">${esc(c)}</button>`,
            )
            .join("");
        return `<section>
            <p class="fine">Only ${esc(who)} should see this screen</p>
            <h2>${esc(who)}, you were caught. Where were you all along?</h2>
            <p>Name the place and the Impostors still win.</p>
            <div class="grid">${options}</div>
        </section>`;
    },

    finale() {
        const e = state.ending;
        const title = {
            impostors: "The Impostors win",
            insiders: "The Insiders win",
            jester: "The Jester wins",
        }[e.winner];
        const rows = state.players
            .map(
                (p) =>
                    `<li class="${p.role} ${p.alive ? "" : "out"}"><b>${esc(p.name)}</b> <span>${ROLE[p.role]}${p.job ? `, ${esc(p.job)}` : ""}</span></li>`,
            )
            .join("");
        return `<section>
            <p class="kicker">The place was <b>${esc(state.scenario.place)}</b></p>
            <h2>${title}</h2>
            <p>${esc(e.reason)}</p>
            <div class="story"><p>${esc(state.epilogue)}</p><button class="link" data-act="skip">Skip narration</button></div>
            <ul class="roster">${rows}</ul>
            <div class="two">
                <button class="btn primary" data-act="again">Play again</button>
                <button class="btn ghost" data-act="setup">Change players</button>
            </div>
        </section>`;
    },
};

function cardFor(p) {
    const s = state.scenario;
    if (p.role === "impostor") {
        const partners = state.players
            .filter((q) => q.role === "impostor" && q.name !== p.name)
            .map((q) => q.name);
        return `<article class="card impostor">
            <span class="tag">Your secret role</span>
            <h2>Impostor</h2>
            <p>You don't know where you are. Blend in.</p>
            <p class="clue">Clue: ${esc(s.hint)}</p>
            <p><b>It's one of these:</b> ${state.choices.map(esc).join(" · ")}</p>
            ${partners.length ? `<p><b>Your partner:</b> ${esc(partners.join(", "))}</p>` : ""}
            <p class="goal"><b>Goal:</b> avoid being voted out. If you are caught, you get one guess at the place. Get it right and you still win.</p>
        </article>`;
    }
    const goal =
        p.role === "jester"
            ? "Get yourself voted out. If the table sends you home, you win alone. Act suspicious, but not too obviously."
            : "Unmask the Impostor. Show you belong with details only someone here would know, but not so exactly that the Impostor learns the place.";
    return `<article class="card ${p.role}">
        <span class="tag">Your secret role</span>
        <h2>${ROLE[p.role]}</h2>
        <p>You are the <b>${esc(p.job)}</b> at <b>${esc(s.place)}</b>.</p>
        <p class="goal"><b>Goal:</b> ${goal}</p>
    </article>`;
}

// --- rendering ---------------------------------------------------------------

function render() {
    const body = state.busy
        ? `<section class="center"><div class="spinner"></div><h2>${esc(state.busy)}</h2></section>`
        : (screens[state.screen] ?? screens.landing)();
    $app.innerHTML = `${header()}${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ""}${body}`;
}

// --- game flow ---------------------------------------------------------------

function startGame() {
    const problem = validateNames(state.names);
    if (problem) {
        state.error = problem;
        return render();
    }
    state.names = state.names.map((n) => n.trim());
    save("names", state.names);
    run("The host is setting the scene…", async () => {
        const scenario = await newScenario({
            count: state.names.length,
            theme: state.theme,
        });
        state.scenario = scenario;
        state.choices = shuffle([scenario.place, ...scenario.decoys]);
        state.players = assignRoles(state.names, scenario.jobs);
        state.rounds = roundCount(state.players.length);
        state.round = 0;
        state.twist = null;
        state.dealIndex = 0;
        state.dealStage = "pass";
        state.screen = "deal";
        speak(`${scenario.title}. ${scenario.intro}`);
        refreshPollen();
    });
}

function beginRound() {
    stopSpeaking();
    stopTimer();
    state.round += 1;
    state.twist = pickTwist(
        state.players,
        state.round,
        state.twist?.type ?? null,
    );
    run("The host is preparing the round…", async () => {
        state.narration = await narrateRound(state.scenario, {
            round: state.round,
            rounds: state.rounds,
            twist: state.twist.type,
            aliveCount: alive(state.players).length,
        });
        state.timeLeft = state.seconds;
        state.screen = "round";
        speak(`${state.narration} ${ruleText(state.twist)}`);
    });
}

function toggleTimer() {
    if (state.timerOn) {
        stopTimer();
        return render();
    }
    state.timerOn = true;
    timer = setInterval(() => {
        state.timeLeft -= 1;
        const el = document.getElementById("timer");
        if (el) el.textContent = clock(Math.max(state.timeLeft, 0));
        const bar = document.getElementById("bar");
        if (bar)
            bar.style.width = `${(Math.max(state.timeLeft, 0) / state.seconds) * 100}%`;
        if (state.timeLeft <= 0) {
            stopTimer();
            beep();
            speak("Time is up. Call the vote.");
            render();
        }
    }, 1000);
    render();
}

function callVote() {
    stopSpeaking();
    stopTimer();
    state.votes = {};
    state.voteIndex = 0;
    state.voteStage = "pass";
    state.pick = null;
    state.screen = "vote";
    render();
}

function lockVote() {
    const living = alive(state.players);
    state.votes[living[state.voteIndex].name] = state.pick;
    state.pick = null;
    state.voteIndex += 1;
    state.voteStage = "pass";
    if (state.voteIndex < living.length) return render();
    resolveVote();
}

function resolveVote() {
    const result = tally(state.votes, state.twist);
    const lines = readout(state.players, state.votes, state.twist, result);
    const accused = result.eliminated;
    const role = accused
        ? state.players.find((p) => p.name === accused).role
        : null;
    const before = state.players;
    const after = accused ? eliminate(before, accused) : before;
    const end = checkEnd(after, state.round, state.rounds, accused);
    run("The host is counting the votes…", async () => {
        const { lead, reveal } = await reactToVote(state.scenario, {
            accused,
            role,
            last: !!end.over,
            guess: !!end.guess,
        });
        state.players = after;
        state.result = { ...result, lines, accused, role, lead, reveal, end };
        state.screen = "result";
        const verdict = accused ? `${accused} is out.` : "Nobody is out.";
        speak(`${lead} ${lines.join(" ")} ${verdict} ${reveal}`);
        refreshPollen();
    });
}

function finish(ending) {
    stopSpeaking();
    state.ending = ending;
    state.epilogue = "";
    run("The host is wrapping up…", async () => {
        state.epilogue = await epilogue(state.scenario, ending);
        state.screen = "finale";
        speak(state.epilogue);
        refreshPollen();
    });
}

// --- events ------------------------------------------------------------------

const actions = {
    signin: () => signIn().catch(fail),
    signout() {
        signOut();
        stopSpeaking();
        state.screen = "landing";
        state.pollen = null;
        render();
    },
    add() {
        state.names.push("");
        render();
    },
    remove({ i }) {
        state.names.splice(Number(i), 1);
        render();
    },
    start: startGame,
    reveal() {
        stopSpeaking();
        state.dealStage = "card";
        render();
    },
    hide() {
        state.dealIndex += 1;
        state.dealStage = "pass";
        if (state.dealIndex >= state.players.length) return beginRound();
        render();
    },
    skip: () => stopSpeaking(),
    timer: toggleTimer,
    callvote: callVote,
    ballot() {
        state.voteStage = "ballot";
        render();
    },
    pick({ name }) {
        state.pick = name;
        render();
    },
    lock: lockVote,
    next() {
        const { end } = state.result;
        if (end.guess) {
            state.screen = "guess";
            return render();
        }
        if (end.over) return finish(end);
        beginRound();
    },
    guess: ({ place }) => finish(resolveGuess(state.scenario.place, place)),
    again: startGame,
    setup() {
        state.screen = "setup";
        render();
    },
};

$app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (el && !el.disabled) actions[el.dataset.act]?.(el.dataset);
});

$app.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.name !== undefined) {
        state.names[Number(t.dataset.name)] = t.value;
    } else if (t.id === "theme") {
        state.theme = t.value;
        save("theme", t.value);
    }
});

$app.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "seconds") {
        state.seconds = Number(t.value);
        save("seconds", state.seconds);
    } else if (t.id === "voice") {
        state.voice = t.value;
        save("voice", t.value);
    } else if (t.id === "voiceOn") {
        state.voiceOn = t.checked;
        save("voiceOn", t.checked);
    }
});

// --- boot --------------------------------------------------------------------

(async () => {
    try {
        await completeSignIn();
    } catch (e) {
        state.error = e.message;
    }
    if (getSession()) {
        state.screen = "setup";
        refreshPollen();
    }
    render();
})();
