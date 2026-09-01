# Firestore Security Rules Tests

Runs `firestore.rules` against the real Firestore emulator (not a mock) via
`@firebase/rules-unit-testing`. No live Firebase project or credentials are required — the
emulator runs entirely locally.

```bash
npm run test:rules
```

Covers: cross-account read/write isolation, report verdict/score/findings immutability after
creation, API key index enumeration (blocked) vs. single-key lookup (allowed, for the Worker's
validation path), public report sharing and revocation, billing entitlement write protection,
and that legitimate owner actions still work.

## Requirements

- **Java 21+** for the latest `firebase-tools`. If only Java 17 is available (check with
  `java -version`), this script pins to `firebase-tools@13`, the last major version compatible
  with Java 17 — no separate install needed, `npx` fetches it on demand.
- Nothing else — this never touches a real Firebase project.
