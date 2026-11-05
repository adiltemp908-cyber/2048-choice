# Security review — 29 October 2026

The game has basic app and leaderboard protections. It is not a cheat-proof competition system, and this review is not a penetration-test certification.

## Checks performed

- Read the game engine, local save layer, Firebase client, supplied Firestore rules and Android WebView shell.
- Successfully read the live project `choice-54ecd` through a temporary anonymous login. An unauthenticated leaderboard query was rejected with HTTP 403. The temporary login was deleted afterward; no live scores were changed.
- Tested the revised rules in the official local Firestore emulator. Valid owner submissions succeeded; signed-out writes/reads, another user's writes, deletion, decreasing scores, malformed fields, non-power-of-two tiles and scores above a grid's theoretical limit were rejected. Valid maximum scores on all six grids and exact large-score ordering passed.
- Browser regression tests mock Firebase, so synthetic gameplay fixtures never upload to the shared leaderboard.

## Protections in this code

- Firebase Auth provides a guest identity. The supplied rules restrict writes to that identity's own score document, validate fields and prevent lowering/deleting a stored best.
- The revised rules add mathematical score ceilings and valid tile checks. They also accept an exact, sortable format for values too large for ordinary JavaScript integers or Firestore's 64-bit integer field.
- Network requests use HTTPS. The Android app permits Internet access but requests no camera, contacts, location or shared-storage access. Cleartext traffic and Android app backup are disabled.
- The WebView loads packaged content from its local HTTPS origin, blocks external navigation, disables file/content URL access and restricts scripts and outbound services with a Content Security Policy. The native bridge exposes only theme colour and app exit operations.
- Player nicknames are inserted as text, not HTML.
- App updates are signed with the same private signing key; the key is not included in the APK.

## Limits

- Scores are computed on the phone. A modified client can claim a fabricated score inside the allowed range. Authentication and score ceilings do not prove legitimate gameplay. Strong competitive integrity would require server-validated moves or replays, plus abuse controls.
- Anonymous registration is open to players. Someone can create multiple identities or consume service quotas; there is no app-specific rate limiting or App Check integration.
- Authenticated players can read leaderboard nicknames and scores. These are shared leaderboard data, not private profiles.
- Clearing app data or uninstalling loses the local guest identity and saves. There is no account recovery or cross-device sign-in. Rooted/compromised phones can expose local data and tokens.
- The public Firebase API key identifies the project; it is not an administrator credential or the access-control boundary. See [Firebase API key guidance](https://firebase.google.com/docs/projects/api-keys).

## Required Firebase update

The revised `firebase/firestore.rules` is tested locally but **not deployed**. The public app key cannot inspect or publish the deployed rules. The live 403 check confirms signed-out reads are blocked; it does not prove that all other live rules match the supplied file.

In Firebase Console, open the `choice-54ecd` project, go to **Firestore → Rules**, replace the editor contents with `firebase/firestore.rules`, then click **Publish**. This preserves normal score compatibility and enables exact extreme scores for 7×7 and 8×8. Do not replace it with public read/write access.
