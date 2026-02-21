# Go Fish Policy Integration Packet (Zero-Ambiguity)

This document is for an external AI tasked with authoring `policies/otherai.js`.

Your output must be correct on the first try.

---

## 1) Objective

Create **one file**:

- `policies/otherai.js`

This file defines a single function used by the game engine to pick a legal move.

---

## 2) Hard Interface Contract (Must Match Exactly)

Your file must export exactly this symbol:

- `module.exports = { pickMove }`

Your function signature must be:

```js
function pickMove(state, legalActions, playerIndex)
```

Where:

- `state` = full current game state object
- `legalActions` = array of currently legal actions for this turn
- `playerIndex` = current player index (`0` or `1`)

---

## 3) Legal Action Shape

Every move must be this exact shape:

```js
{ type: "ask_rank", rank: "7" }
```

`rank` must be one of:

- `"A"`, `"2"`, `"3"`, `"4"`, `"5"`, `"6"`, `"7"`, `"8"`, `"9"`, `"10"`, `"J"`, `"Q"`, `"K"`

You must return an action that exists in `legalActions`.

---

## 4) Non-Negotiable Rules

1. **Do not mutate** `state`.
2. If `legalActions` is empty, return `null`.
3. If your chosen action is not legal, fallback to `legalActions[0]`.
4. Return plain JSON-like objects only (no classes, no side channels).
5. No async, no network, no filesystem calls.

---

## 5) Current State Schema (Relevant Fields)

Use these fields safely:

```js
state = {
  currentPlayer: 0 | 1,
  deck: [{ rank, suit }, ...],
  players: [
    { name, hand: [{ rank, suit }, ...], books: ["A", ...] },
    { name, hand: [{ rank, suit }, ...], books: ["K", ...] }
  ],
  phase: "play" | "gameover",
  winner: string | null,
  log: [string, ...]
}
```

You usually need:

- `state.players[playerIndex].hand`
- `state.players[(playerIndex + 1) % 2].hand.length`
- `state.players[*].books`
- `state.deck.length`

---

## 6) Required Output File Template (Use This)

```js
function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;

  // TODO: strategy here
  const choice = legalActions[0];

  const isLegal = legalActions.some(
    (a) => a.type === choice.type && a.rank === choice.rank
  );

  return isLegal ? choice : legalActions[0];
}

module.exports = { pickMove };
```

---

## 7) Strategy Guidance (Strong but Safe)

Preferred strategy order:

1. Prioritize ranks where own hand count is 3, then 2, then 1.
2. Estimate opponent likely possession using known cards/books + opponent hand size.
3. Favor moves with highest expected immediate gain.
4. In low-deck situations, increase weight on near-book completion and deny pressure.
5. Deterministic tie-breaker (e.g., highest own count, then fixed rank order).

---

## 8) Validation Checklist (Before Finalizing)

- [ ] File path is exactly `policies/otherai.js`
- [ ] Export is exactly `module.exports = { pickMove }`
- [ ] Signature is exactly `(state, legalActions, playerIndex)`
- [ ] Returns `null` only when no legal actions
- [ ] Never returns an illegal action
- [ ] No mutation of `state`
- [ ] No external dependencies required

---

## 9) Correct vs Incorrect Examples

### ✅ Correct (minimal legal)

```js
function pickMove(state, legalActions, playerIndex) {
  if (!legalActions?.length) return null;
  return legalActions[0];
}
module.exports = { pickMove };
```

### ✅ Correct (validated choice)

```js
function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;

  const choice = legalActions.find((a) => a.rank === "A") || legalActions[0];
  return legalActions.some((a) => a.type === choice.type && a.rank === choice.rank)
    ? choice
    : legalActions[0];
}
module.exports = { pickMove };
```

### ❌ Incorrect

```js
// WRONG: exports function directly (contract mismatch)
module.exports = pickMove;
```

```js
// WRONG: illegal return shape
return { rank: "7" };
```

```js
// WRONG: mutates state
state.players[playerIndex].hand = [];
```

---

## 10) Final Delivery Instruction

Return **only** the full contents of `policies/otherai.js`.

No markdown fences. No explanation text. No extra files.
