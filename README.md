# Lite-Go-Fish-Webapp-Clone

Simple hot-seat Go Fish web app with:
- Human vs AI play
- AI tournament mode with live winrate visualization
- CLI/JSON simulation runner for fair seat-swapped benchmarking

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
{"cmd":"batch","games":1000,"policyA":"dadslayer-v2","policyB":"clawbuddy-v2"}
{"cmd":"batch_fair","games":1000,"policyA":"dadslayer-v2","policyB":"clawbuddy-v2"}
```

`batch_fair` runs both seat orders (A as P1, then B as P1) and reports combined fair winrates.

Built-in policy IDs currently available:
- `random`
- `dadslayer-v1`
- `dadslayer-v2`
- `clawbuddy-v1`
- `clawbuddy-v2`

Legacy aliases accepted by CLI:
- `dadslayer` (maps to v1 naming path)
- `dad-slayer`
- `clawbuddyv1` / `clawbuddyv2`
- `otherai` (maps to clawbuddy v1 compatibility alias)

Policy format/spec:
- `policies/EXTERNAL_POLICY_FORMAT.md`
- `policies/AI_POLICY_INVITATION.md`

Browser bridge (while GUI remains active):

- `window.GoFishJsonBridge.getState()`
- `window.GoFishJsonBridge.submit({ type: "ask_rank", rank: "7" })`

## Add a New Policy (Drop-in)

1. Create a file in `policies/`, for example `policies/mybot.js`.
2. Export and register it:

```js
function pickMove(state, legalActions, playerIndex) {
  if (!Array.isArray(legalActions) || legalActions.length === 0) return null;
  return legalActions[0];
}

(function (root) {
  var api = { pickMove: pickMove };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GoFishPolicies = root.GoFishPolicies || {};
  root.GoFishPolicies['mybot'] = api;
})(typeof self !== 'undefined' ? self : this);
```

3. Add script include in `index.html` before `app.js`:

```html
<script src="policies/mybot.js"></script>
```

4. Refresh browser. `mybot` will appear in GUI dropdown automatically.

## Rules

- Ask for a rank you already hold.
- If the opponent has any of that rank, they hand them over and you ask again.
- If not, draw one card. If it matches, you go again. Otherwise the turn passes.
- Book a rank when you collect all four cards.
- The game ends when all 13 books are made.
