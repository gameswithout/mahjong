# Xsolla email-code sign-in

## Diagnosis

Guest entry already authenticates with Xsolla Login and exchanges that token through the game-service `xsolla` platform integration. The old email/password form instead called AGS-native registration, verification-code and password-grant APIs. A 204 response from that unrelated verification endpoint did not demonstrate Xsolla email delivery.

The correct project is `a32b1c64-9071-4bfb-bdf0-ceabebacd1ef`. A live code request to Xsolla for the user-specified inbox returned HTTP 422 with `003-056`: passwordless email authentication is disabled. In Publisher Account → Mahjong Online → Players → Login → Mahjong → Configure, select **Change Login method** in the Classic login banner, choose Passwordless and enable Email. Confirm callback URLs and save.

## Current implementation

- A single email-code flow handles existing and new email identities, without passwords.
- Email access collects only the email address and one-time code. Birth-date collection and age confirmation are removed by product direction; KYC is deferred.
- `POST https://login.xsolla.com/api/login/email/request?projectId=…&with_logout=0` sends `{email, send_link:false}` and requires an `operation_id` response.
- `POST …/login/email/confirm?projectId=…` submits matching email, code and operation ID. Only the token is consumed from the returned `login_url`; the application never navigates to that URL.
- The token is exchanged through the existing `xsolla` game-service platform login. Game-service APIs continue to use that session. Xsolla performs authentication and mail delivery; game-service IAM remains the token bridge, not the email identity provider.
- Code/session state remains in memory. No email, code or token is added to telemetry or local storage. Disabled provider methods, throttling, invalid codes and network errors do not report successful sign-in.
- The existing custom game styling is reused; no hosted Login widget is introduced.
- Legacy AGS-native email/password and guest-upgrade transport calls fail closed. Guest-to-email linking is **not implemented**: it must link the existing Xsolla guest identity without silently creating a second player or moving progress. A separate email sign-in is not a guest conversion.

## Verification

Unit/integration checks cover provider endpoint routing, operation-ID binding, malformed responses, disabled method, throttling, wrong/expired code, retries/resends, changing address, game token exchange and verified game-user lookup. Live delivery and full sign-in require enabling passwordless Email and completing a real code challenge in the browser. They are not proven by mocked tests.

References: [Start authentication by email](https://developers.xsolla.com/api/login/passwordless/jwt-start-auth-by-email), [Complete authentication by email](https://developers.xsolla.com/api/login/operation/jwt-complete-auth-by-email/).

After the user enabled Passwordless Email in Publisher Account, the same Xsolla code-request endpoint returned HTTP 200 with an operation ID. Inbox delivery and code completion remain pending user verification. The local login screen was inspected and shows the unified email-code form without password fields. Client checks: 635 tests passed; production build passed.

The user confirmed receipt of the diagnostic email after enabling Passwordless Email. Full browser sign-in and the game-service token exchange still require end-to-end confirmation.
