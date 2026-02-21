# External Policy Format

Use this exact format for policy files.

## File
- `policies/otherai.js`

## Required export
```js
function pickMove(state, legalActions, playerIndex) {
  // return one legal action object OR null
  return legalActions[0] || null;
}

module.exports = { pickMove };
```

## Inputs
- `state`: current game state object
- `legalActions`: array of legal actions for current turn
  - each action shape: `{ type: "ask_rank", rank: "A|2|...|K" }`
- `playerIndex`: current player index (`0` or `1`)

## Output
Must return exactly one legal action from `legalActions`:
```js
{ type: "ask_rank", rank: "7" }
```

## Hard rules
1. Never mutate `state`.
2. Never return ranks not present in `legalActions`.
3. Return `null` only if `legalActions` is empty.
