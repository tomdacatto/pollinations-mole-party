import assert from "node:assert/strict";
import test from "node:test";
import {
    alive,
    assignRoles,
    checkEnd,
    eliminate,
    impostorCount,
    leaks,
    pickTwist,
    readout,
    resolveGuess,
    roundCount,
    ruleText,
    tally,
    validateNames,
} from "./engine.js";

const JOBS = [
    "Cook",
    "Pilot",
    "Medic",
    "Clerk",
    "Guard",
    "Diver",
    "Baker",
    "Tailor",
    "Monk",
    "Scout",
];
const seeded = (seed) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};
const names = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
const count = (players, role) => players.filter((p) => p.role === role).length;

test("roles scale with the table", () => {
    for (const [n, imps, jesters, rounds] of [
        [4, 1, 0, 3],
        [5, 1, 1, 3],
        [7, 1, 1, 3],
        [8, 2, 1, 4],
        [10, 2, 1, 4],
    ]) {
        const players = assignRoles(names(n), JOBS, seeded(n));
        assert.equal(count(players, "impostor"), imps, `${n} impostors`);
        assert.equal(count(players, "jester"), jesters, `${n} jesters`);
        assert.equal(impostorCount(n), imps);
        assert.equal(roundCount(n), rounds);
        assert.equal(
            players.map((p) => p.name).join(),
            names(n).join(),
            "table order is kept",
        );
        assert.ok(players.every((p) => p.alive));
    }
});

test("only the Impostor has no job, and jobs are not repeated at a small table", () => {
    const players = assignRoles(names(8), JOBS, seeded(3));
    assert.ok(
        players
            .filter((p) => p.role === "impostor")
            .every((p) => p.job === null),
    );
    const jobs = players.filter((p) => p.job).map((p) => p.job);
    assert.equal(new Set(jobs).size, jobs.length);
});

test("names are validated", () => {
    assert.match(validateNames(["a", "b", "c"]), /4 to 10/);
    assert.match(validateNames(["a", "b", "c", " "]), /name/);
    assert.match(validateNames(["a", "b", "c", "A"]), /different/);
    assert.equal(validateNames(["a", "b", "c", "d"]), null);
    assert.throws(() => assignRoles(["a", "a", "b", "c"], JOBS), /different/);
});

test("round 1 is an open vote and twists never repeat back to back", () => {
    const players = assignRoles(names(6), JOBS, seeded(1));
    assert.deepEqual(pickTwist(players, 1, null, seeded(9)), {
        type: "open",
        target: null,
    });
    let previous = "open";
    for (let round = 2; round < 40; round++) {
        const twist = pickTwist(players, round, previous, seeded(round));
        assert.notEqual(twist.type, previous);
        if (twist.type === "double" || twist.type === "silence") {
            assert.ok(players.some((p) => p.name === twist.target));
        } else {
            assert.equal(twist.target, null);
        }
        previous = twist.type;
    }
});

test("rule text names the target", () => {
    assert.match(
        ruleText({ type: "double", target: "Ana" }),
        /Ana's vote counts double/,
    );
    assert.match(
        ruleText({ type: "silence", target: "Ben" }),
        /Ben must stay silent/,
    );
    assert.match(ruleText({ type: "secret", target: null }), /totals/);
});

test("tally: most votes is eliminated, a tie eliminates nobody", () => {
    const open = { type: "open", target: null };
    assert.deepEqual(tally({ A: "B", B: "C", C: "B", D: "B" }, open), {
        counts: { B: 3, C: 1 },
        max: 3,
        eliminated: "B",
    });
    assert.equal(tally({ A: "B", B: "A" }, open).eliminated, null);
    assert.equal(tally({}, open).eliminated, null);
});

test("tally: a double vote counts twice", () => {
    const twist = { type: "double", target: "A" };
    const result = tally({ A: "C", B: "D", D: "B" }, twist);
    assert.equal(result.counts.C, 2);
    assert.equal(result.eliminated, "C");
    assert.equal(
        tally(
            { A: "C", B: "D", D: "D", C: "B" },
            { type: "double", target: "B" },
        ).counts.D,
        3,
    );
});

test("readout comes from the votes, in table order", () => {
    const players = names(4).map((name) => ({ name }));
    const votes = { P3: "P1", P1: "P2", P2: "P1", P4: "P1" };
    const open = { type: "open", target: null };
    assert.deepEqual(readout(players, votes, open, tally(votes, open)), [
        "P1 votes for P2.",
        "P2 votes for P1.",
        "P3 votes for P1.",
        "P4 votes for P1.",
    ]);
    const secret = { type: "secret", target: null };
    assert.deepEqual(readout(players, votes, secret, tally(votes, secret)), [
        "P1 received 3 votes.",
        "P2 received 1 vote.",
    ]);
    assert.deepEqual(readout(players, {}, secret, tally({}, secret)), [
        "Nobody was accused.",
    ]);
});

const table = () => [
    { name: "A", role: "impostor", alive: true },
    { name: "B", role: "insider", alive: true },
    { name: "C", role: "insider", alive: true },
    { name: "D", role: "jester", alive: true },
    { name: "E", role: "insider", alive: true },
];

test("voting out the Jester ends the game for the Jester", () => {
    const players = eliminate(table(), "D");
    assert.deepEqual(checkEnd(players, 1, 3, "D").winner, "jester");
});

test("catching the last Impostor triggers a guess, which decides the winner", () => {
    const players = eliminate(table(), "A");
    assert.deepEqual(checkEnd(players, 2, 3, "A"), {
        over: false,
        guess: true,
    });
    assert.equal(
        resolveGuess("Orbital Greenhouse", "Orbital Greenhouse").winner,
        "impostors",
    );
    assert.equal(
        resolveGuess("Orbital Greenhouse", "Closed Planetarium").winner,
        "insiders",
    );
});

test("a second Impostor keeps the game going after the first is caught", () => {
    const players = eliminate(
        [
            { name: "A", role: "impostor", alive: true },
            { name: "B", role: "impostor", alive: true },
            ...["C", "D", "E", "F", "G", "H"].map((name) => ({
                name,
                role: "insider",
                alive: true,
            })),
        ],
        "A",
    );
    assert.deepEqual(checkEnd(players, 1, 4, "A"), { over: false });
});

test("Impostors win when they match the table or the rounds run out", () => {
    const two = eliminate(eliminate(table(), "B"), "C");
    assert.deepEqual(
        checkEnd(two, 2, 4, "C"),
        { over: false },
        "A vs D+E is not parity yet",
    );
    const players = eliminate(table(), "B");
    assert.deepEqual(checkEnd(players, 1, 3, "B"), { over: false });
    assert.equal(checkEnd(players, 3, 3, "B").winner, "impostors");
    const three = eliminate(eliminate(table(), "B"), "C");
    const last = eliminate(three, "E");
    assert.equal(
        checkEnd(last, 3, 4, "E").winner,
        "impostors",
        "A vs D is parity",
    );
    assert.equal(alive(last).length, 2);
});

test("leaks spots the secret place in public narration", () => {
    assert.ok(leaks("The greenhouse door creaks open.", "Orbital Greenhouse"));
    assert.ok(leaks("Something orbital hums.", "Orbital Greenhouse"));
    assert.ok(
        !leaks("The lights hesitate and someone lies.", "Orbital Greenhouse"),
    );
    assert.ok(
        !leaks("The night is long.", "The Old Inn"),
        "stopwords and short words are ignored",
    );
});
