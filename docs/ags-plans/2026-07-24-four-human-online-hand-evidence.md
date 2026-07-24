# Four-Human Online Hand Evidence — 2026-07-24

- Status: Complete
- Plan: [Four-human online hand](./2026-07-24-four-human-online-hand.md)
- Namespace: `gameswithout-mahjong`
- Pool: `mahjong-test-pool`
- Session template: `mahjong-test-none`
- Client source baseline: `ccd9a92` plus the current four-human harness and
  reload-resume working-tree integration

## Player journey

The verified player-facing path is:

```text
Continue as Guest
  -> Lobby connected
  -> Find a table
  -> Searching for players
  -> automatic shared Session join
  -> wait for four-member roster
  -> automatic runtime entry
  -> live private table
  -> same-seat reconnect
  -> complete hand
  -> result
  -> Return to Lobby
```

There is no intermediate **Join table** or **Connect test hand** action in the
online journey. Manual Session controls remain inside the developer disclosure.

## Live game-flow evidence

`npm run test:four-human` builds the client, copies `dist` into an isolated
temporary snapshot, serves that immutable snapshot, and launches four separate
Playwright browser contexts. Each context has isolated local storage and
therefore receives a distinct Device ID guest.

The final live run proved:

- Four visible **Find a table** actions created four real guest queue entries.
- All four clients automatically entered one shared match.
- Seats were distinct and complete: East, South, West, and North.
- Each browser rendered its own visible hand and concealed opponent-hand
  placeholders.
- A forced runtime sync network failure recovered automatically.
- The reconnecting player retained East.
- The four clients drove 137 accepted legal UI actions through draw, discard,
  claim response, and result states.
- All four clients rendered the hand result.
- Every **Return to Lobby** action observed a successful AGS Session
  `DELETE .../leave` response.
- All four clients returned to a state where **Find a table** was enabled.

The successful match ID was `90593226…eda2`. No access token, device ID, ticket
ID, or user ID was written to the evidence output.

## Service evidence

- IAM: four separate Public-client guest logins succeeded, including the
  authenticated current-user verification performed by the existing login
  adapter.
- Lobby: all four clients reached visible `Lobby connected`.
- Matchmaking: all four tickets formed one match in `mahjong-test-pool`.
- Session: the automatic handoff waited for a four-member roster; all four
  Session joins succeeded and all four leave responses succeeded.
- Extend runtime: four distinct authoritative seat views joined the deployed
  service; 137 commands advanced the shared hand to one result.
- Authorization: browser calls used player user access tokens from the Public
  client. The deployed backend retained its existing Confidential client and
  Session-read permission. No secret entered the browser and no permission
  mutation was required.

## Local verification

```text
npm test
  16 files passed
  113 tests passed

npm run build
  TypeScript and Vite production build passed

(cd mahjong-match-service && go test ./...)
  all service packages passed

git diff --check
  passed
```

The four-human runner itself completed with:

```json
{
  "status": "passed",
  "players": 4,
  "seats": ["E", "N", "S", "W"],
  "reconnectSeat": "E",
  "legalActions": 137,
  "cleanup": "four Session leave responses succeeded; returned to lobby"
}
```

## Harness hardening

Early diagnostic runs were invalidated by unrelated source edits triggering
Vite development-server hot reloads during a long live hand. The runner now
tests an immutable copy of the production build through an in-process static
server. Source edits in the shared checkout cannot reload an in-flight run.

The legal-action driver also treats a checked claim such as `Pass ✓` as already
submitted, so it advances to the other eligible seats instead of repeatedly
revising one response.

## Game-flow integration status

```text
Game-flow integration status

  - Flow status:        Complete
  - Game trigger:       Find a table
  - UI evidence:        queue, cancel, automatic join/wait/enter, private table,
                        reconnect, result, and Return to Lobby states verified
  - Intended end state: four humans complete one shared online hand and leave
  - Authorization:      Public browser client + player user tokens; Confidential
                        backend client + existing Session read permission
  - Service evidence:   IAM, Lobby, Matchmaking, Session join/roster/leave, and
                        deployed runtime command flow verified
  - Game-flow evidence: four isolated real browser guests completed 137 legal
                        actions through the intended player path
  - Remaining gap:      none for M3A; persistent Jade, ranked progression,
                        social/rematch, and production rollout remain deferred
```
