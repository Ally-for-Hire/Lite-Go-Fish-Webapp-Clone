# Lite-Go-Fish-Webapp-Clone

Simple hot-seat Go Fish web app for two players on one computer.

## Run

- Open `index.html` in a browser.
- Use the Opponent toggle in the header to switch between Human and AI.
- Table talk keeps the latest moves in a scrollable list.

## New: Engine + CLI/JSON

This project now includes a pure rules engine and a JSON CLI runner:

- `engine.js` → pure game state + action transitions
- `cli.js` → stdin/stdout JSON protocol for headless play and batch simulation

Start CLI:

```bash
node cli.js
```

Example commands (one JSON object per line):

```json
{"cmd":"init"}
{"cmd":"legal"}
{"cmd":"step","action":{"type":"ask_rank","rank":"7"}}
{"cmd":"state"}
{"cmd":"batch","games":1000,"policyA":"dad-slayer","policyB":"baseline"}
{"cmd":"batch_fair","games":1000,"policyA":"dad-slayer","policyB":"otherai"}
```

`batch_fair` runs both seat orders (A as P1, then B as P1) and reports combined fair winrates.

Batch policies currently available:
- `random`
- `baseline`
- `dad-slayer`
- `otherai` (loaded from `policies/otherai.js`)

`otherai` contract:
```js
function pickMove(state, legalActions, playerIndex) {
  return { type: "ask_rank", rank: "7" }; // must be one of legalActions
}
module.exports = { pickMove };
```

Browser bridge (while GUI remains active):

- `window.GoFishJsonBridge.getState()`
- `window.GoFishJsonBridge.submit({ type: "ask_rank", rank: "7" })`

## Rules

- Ask for a rank you already hold.
- If the opponent has any of that rank, they hand them over and you ask again.
- If not, draw one card. If it matches, you go again. Otherwise the turn passes.
- Book a rank when you collect all four cards.
- The game ends when all 13 books are made.
