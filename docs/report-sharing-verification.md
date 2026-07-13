# Report Sharing Verification Checklist

Canonical sharing state for v1.3.0 product scope: `reports/{REPORT_ID}.isPublic`.

Password sharing is not part of this release.

## 1. Private Report As Owner

- Sign in.
- Run a dashboard scan.
- Open the report from the dashboard.
- Expected: the report loads for the owner.
- Expected: Share settings show `Private` and `reports/{REPORT_ID}.isPublic` is `false`.

## 2. Private Report As Anonymous Visitor

- Copy the canonical report URL: `https://aimodularity.com/agentverify/report/?id=REPORT_ID`.
- Sign out or open an anonymous browser session.
- Load the URL.
- Expected: the report content is not shown.
- Expected: the private-access screen explains that the owner must enable public sharing.

## 3. Public Report As Anonymous Visitor

- Sign in as owner.
- Open the report and enable Public access in Share settings.
- Save settings.
- Open the canonical URL anonymously.
- Expected: the report loads without signing in.
- Expected: the URL remains `/report/?id=REPORT_ID`.

## 4. Public-To-Private Toggle

- Sign in as owner.
- Disable Public access and save.
- Open the canonical URL anonymously.
- Expected: the private-access screen appears.
- Expected: `reports/{REPORT_ID}.isPublic` is `false`.

## 5. Private-To-Public Toggle

- Sign in as owner.
- Enable Public access and save.
- Expected: the UI immediately reflects Public status after save.
- Open the canonical URL anonymously.
- Expected: the report loads.
- Expected: `reports/{REPORT_ID}.isPublic` is `true`.
