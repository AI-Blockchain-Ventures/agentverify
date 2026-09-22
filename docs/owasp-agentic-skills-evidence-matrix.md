# OWASP Agentic Skills Top 10 — evidence matrix (DRAFT, step 1)

Status: design draft for review. Nothing here is implemented. It defines what Agent Verify may and
may not conclude for each control before any detector or report code is written.

Agent Verify reports an **assessment against / mapping to** the OWASP Agentic Skills Top 10. It is not
an OWASP certification or endorsement, and this document never uses "compliant", "certified" or
"passed" for a control.

## 1. Pinned upstream

| Field | Value |
|---|---|
| framework | `OWASP_AGENTIC_SKILLS_TOP_10` |
| upstream repo | `OWASP/www-project-agentic-skills-top-10` |
| upstream_commit | `d6f7d7d0de314f52a83a85d1828e06ab096e595c` (2026-08-12) |
| upstream_status | project page: public review (v1); `universal-skill-format.md` labels itself "v1.0", last updated April 2026 |
| agentverify_profile_version | `1.0.0` (proposed) |

Files read at the pinned commit: `top10.md`, `ast01.md`–`ast10.md`, `checklist.md`,
`universal-skill-format.md`. Control titles used below are the ones in `top10.md` and `checklist.md` at
that commit. `proposal.md` at the same commit uses older shortened titles ("Supply Chain",
"Prompt Injection" for AST05, "Cross-Platform"), so the pin matters. A claim that the repo also
contains "Insufficient Input Validation / Improper Error Handling / Insecure Storage / MAESTRO
Misalignment" labels was **not** reproduced at this commit (none of the files above contain them).

Licensing: GitHub reports the repo licence as `NOASSERTION`, but `checklist.md` at the pinned commit
states it is licensed under CC-BY-SA-4.0. The mapping therefore references OWASP checklist items by
number (e.g. "checklist 3.7") and uses our own implementation wording rather than copying OWASP text
(avoiding ShareAlike obligations on our product text), and keeps clear OWASP attribution in docs and
report output: "Assessed against the OWASP Agentic Skills Top 10 (CC-BY-SA-4.0), commit `<sha>`. Not an
OWASP certification or endorsement."

## 2. Governing rules

1. A declaration is evidence that something was declared, not that it is true.
2. Absence of evidence is `NOT_ASSESSED`, never `EVIDENCE_OBSERVED`.
3. `VERIFIED` / `NOT_VERIFIED` remain the whole-scan verdict; they are never used per control.
4. Per-control status reuses the existing engine vocabulary: `EVIDENCE_OBSERVED`, `GAP_IDENTIFIED`,
   `NOT_ASSESSED` (and `NOT_APPLICABLE` where a control cannot apply to the submitted artifact type).
5. A real gap always overrides inferred clean evidence for the same control (existing engine rule).

### Evidence provenance (tracked per piece of evidence, under the status)

| Provenance | Meaning | May support `EVIDENCE_OBSERVED`? |
|---|---|---|
| `DECLARED` | A field in the artifact says so | No. Shown as context only. |
| `STATICALLY_OBSERVED` | Agent Verify found it in submitted content | Yes |
| `RECOMPUTED` | Agent Verify recomputed a value and it matched | Yes |
| `CRYPTOGRAPHICALLY_VERIFIED` | Signature verified. Provenance additionally needs a trusted key | Integrity: yes. Provenance: only with a trusted key |
| `EXTERNAL_EVIDENCE` | Supplied by the user, and validated by Agent Verify | Yes, only once validated |
| `INFERRED` | Derived from other signals | Yes, confidence capped at `medium` |
| `BEHAVIORALLY_OBSERVED` | Seen at runtime | Reserved. Agent Verify is static-only today and never emits this. |

Confidence stays `high | medium | low`. Only `GAP_IDENTIFIED` from a definite pattern or a failed
recomputation may be `high`.

### Declared vs. verified, per field

| Field | Present only | Verifiable and consistent | Verifiable and contradicted |
|---|---|---|---|
| `content_hash` | declared, `NOT_ASSESSED` | `RECOMPUTED` → evidence | `GAP_IDENTIFIED` |
| `signature` | declared, `NOT_ASSESSED` | valid, unknown key → integrity only, provenance `NOT_ASSESSED`. Valid, trusted key → evidence | invalid → `GAP_IDENTIFIED` |
| `scan_status.result` | declared, `NOT_ASSESSED` | validated referenced scan report → `EXTERNAL_EVIDENCE` | contradicted → `GAP_IDENTIFIED` |
| `risk_tier` | declared, context only | consistent with observed capability | declared tier below observed tier → `GAP_IDENTIFIED` |
| `permissions.*` | declared | matches what code/instructions actually do | code/instructions exceed the declaration → `GAP_IDENTIFIED` |

## 3. Upstream spec gaps, and the decisions taken (review of step 1)

Top-line rule for the implementation spec: **Agent Verify reports only what its evidence supports.
Declared metadata is context, not proof; unverifiable claims never become assurance.**

1. **`content_hash` has no canonicalization** (the spec says "canonical hash" of the "complete skill
   package" but never defines the bytes). *Decision:* do not invent OWASP semantics. For v1.5 the OWASP
   `content_hash` stays `DECLARED` / `NOT_ASSESSED` wherever verification depends on the undefined
   procedure. Agent Verify separately computes **its own namespaced package digest**
   (`avpkg-sha256:<hex>`, scheme `agentverify-skill-package-digest/v1`) for scan identity and
   attestation integrity; it is deliberately not in OWASP's `sha256:` format and must never be
   presented as the OWASP `content_hash`. Propose the missing canonicalization upstream in parallel.
2. **`signature` has no signed-bytes definition.** *Decision:* minimal **trusted-key support, no
   trust-on-first-use**. A signer key counts as a trust anchor only if a workspace explicitly supplies
   or approves it. Outcomes: absent → no evidence; cryptographically valid → integrity evidence only;
   valid but signer not trusted → provenance stays `NOT_ASSESSED`; valid against an explicitly trusted
   key → provenance evidence; invalid → `GAP_IDENTIFIED`. All of this is blocked from `EVIDENCE_OBSERVED`
   until the signed-bytes procedure is defined, so signature verification ships as `NOT_ASSESSED`
   with the declaration shown, unless we adopt an explicit, versioned Agent Verify rule. The
   manifest's own `signing_key` is author-supplied and is never a trust anchor.
3. **`risk_tier` levels are labels, not criteria.** `L0=safe, L1=low, L2=elevated, L3=destructive`
   appears in the `ast10.md` example comment (not in `universal-skill-format.md`), with no rules for
   assigning a tier. *Decision:* Agent Verify owns the observed-risk rubric, versioned independently
   (`agentverify_risk_rubric: 1.0.0`) and labelled as an Agent Verify interpretation, not OWASP's. The
   rubric will not be a complete deterministic tiering engine; it only needs to be able to say a
   declared tier *understates* observed capability (e.g. declared `L0` with `shell: true`, which OWASP's
   own checklist 4.5 flags as a red flag).
4. **Submission unit is a skill package, not a single file.** *Decision:* the CLI/API ultimately accept
   a directory/repository snapshot or archive, normalized into an internal package (relative paths,
   manifests, dependencies, platform variants). AST02, AST07 and AST10 need this. Ingestion applies
   hostile-archive protections (see §9).
5. **Normalization stays behind the private scanner boundary.** The web app receives only typed,
   normalized findings, evidence provenance, mapping results and attestation data. Untrusted
   YAML/package parsing never moves into the presentation layer.
6. **AST08 refinement.** Agent Verify's own scan may legitimately evidence *specific* items ("an
   agent-skill-aware scan occurred"). It must not give itself a blanket AST08 pass, and must not
   imply an organization has adequate layered scanning because Agent Verify ran (OWASP: no single
   scanner; use multiple layers). See the AST08 entry in §4.
7. The spec's own validation rules are `SHOULD`s (e.g. `network.deny: "*"`, `signature` for production
   distribution). Missing `signature` on a skill not marked production is not by itself a gap.

## 4. Per-control matrix

Legend for "artifact-assessable": **Static** = decidable from submitted files; **Cond.** = decidable
only if the user supplies extra evidence (prior version, sibling manifests, scanner report, lockfile);
**External** = a property of an organization/runtime, not of the artifact.
Checklist numbers refer to OWASP `checklist.md` at the pinned commit.

### AST01 — Malicious Skills (Critical) — checklist 1.1–1.6
- Static: hidden/encoded payloads and calls to unknown endpoints in scripts and instructions (1.4);
  identity-file writes (1.6, shared with AST03); recomputation/signature failures (1.3, once §3 is resolved).
- `GAP_IDENTIFIED`: hash or signature check fails; a definite malicious-pattern detector fires.
- `EVIDENCE_OBSERVED`: only for the specific sub-checks actually run, e.g. "no encoded payload found in
  scanned files" — worded as a scoped observation, never as "skill is not malicious".
- `NOT_ASSESSED`: source/publisher trust (1.1), behavioral analysis (1.2), canary testing (1.5).

### AST02 — Supply Chain Compromise (Critical) — 2.1–2.7
- Static: version ranges (`^`, `~`, `*`, `latest`) in `package.json` / `requirements.txt` (2.3); lockfile
  present; repo config that auto-executes (hooks, `.claude/settings.json`) (2.5); SBOM file present (2.4,
  presence only).
- Cond.: publisher identity (`did:web` resolution) (2.1) needs a network lookup and a trust anchor.
- `GAP_IDENTIFIED`: unpinned dependency ranges; auto-executing repo config with no gate. `EVIDENCE_OBSERVED`:
  all dependencies exactly pinned and lockfile present (scoped to the files scanned).
- `NOT_ASSESSED`: transitive tree (2.6), installer receipts (2.7).

### AST03 — Over-Privileged Skills (High) — 3.1–3.8
- Most statically assessable control. `GAP_IDENTIFIED`: no permission manifest (3.1); `shell: true` (3.3);
  wildcard file globs (3.4); network not a domain allowlist or `deny` not default-deny (3.7);
  write access to identity files (3.6); reads of credential stores/`.env`/SSH keys beyond stated
  function (3.8); code/instructions exceeding declared permissions.
- `EVIDENCE_OBSERVED`: a scoped manifest is present **and** consistent with observed code/instructions.
- `NOT_ASSESSED`: per-skill scoped credentials (3.5) and runtime enforcement.
- Overlaps existing checks (wildcard permissions, broad tool access, secrets); reuse those findings
  rather than duplicating them.

### AST04 — Insecure Metadata (High) — 4.1–4.12
- Static: zero-width/ASCII-smuggling Unicode and base64 blobs in `SKILL.md`/manifest (4.2); unsafe YAML tags
  (4.7); unexpected keys vs. the format's key allowlist (4.4/4.9); `risk_tier` vs. permission scope (4.5);
  permissive defaults (4.3).
- `GAP_IDENTIFIED` for any of the above firing. Description-vs-behavior (4.1) is `INFERRED`, capped at
  `medium`. Brand impersonation (4.6) is `NOT_ASSESSED` unless a maintained brand list is added.
- `NOT_ASSESSED`: loader-side sandboxing/privilege drop (4.8, 4.10–4.12) — those are properties of the
  installer, not the skill.

### AST05 — Untrusted External Instructions (High) — 5.1–5.6
- Static: inventory of URLs / remote files referenced in `SKILL.md` and bundled files (5.1); references
  to mutable targets such as `releases/latest` or unpinned branches; fetch targets outside
  `network.allow` (5.4).
- `GAP_IDENTIFIED`: runtime-fetched external instructions with no content-hash pin; references outside the
  declared allowlist. `EVIDENCE_OBSERVED`: no external references found, or every one pinned/inlined.
- `NOT_ASSESSED`: transitive chains (5.5) and fleet-wide visibility (5.6).

### AST06 — Weak Isolation (High) — 6.1–6.7
- Mostly runtime/host properties. Static: `0.0.0.0` binds or unauthenticated control interfaces in code
  (6.3); hot-reload/workspace-override configuration (6.7); declared sandbox settings.
- Default `NOT_ASSESSED`. `GAP_IDENTIFIED` only on a definite static pattern.
  `EVIDENCE_OBSERVED` never claims "runs isolated" — only e.g. "no wildcard bind found".

### AST07 — Update Drift (Medium) — 7.1–7.6
- Static: exact pins vs. ranges (7.1); auto-update / hot-reload settings (7.2, 7.5); changelog present and
  consistent with `version`.
- Cond.: **drift itself needs a prior version.** The existing scan-to-scan comparison can supply it:
  version changed with no changelog entry, permissions widened between versions, or hash changed under
  an unchanged version → `GAP_IDENTIFIED`.
- `NOT_ASSESSED`: signed-update policy (7.3), re-scan pipeline (7.4), advisory subscription (7.6).

### AST08 — Poor Scanning (Medium) — 8.1–8.7
- This control is about the consumer's scanning pipeline. Agent Verify scanning a skill is one layer.
  It may evidence narrowly-worded items only (e.g. "an agent-skill-aware scan of this package
  occurred", checklist 8.7, with scanner/version/date), and never a blanket AST08 result — layered
  coverage (8.1, 8.2, 8.4–8.6) is not established by Agent Verify having run.
- Static `GAP_IDENTIFIED` only on internal contradictions: `scan_status.last_scanned` malformed, in the
  future, or older than the newest changelog entry (stale scan).
- `EXTERNAL_EVIDENCE` only if a referenced scanner report is supplied and validated.
- Otherwise `NOT_ASSESSED`, with the `scan_status` declaration shown as context.

### AST09 — No Governance (Medium) — 9.1–9.7
- Static: declared `risk_tier` present (9.2) and compared against observed capability (declared L1 vs.
  observed L3 → `GAP_IDENTIFIED`, "declared risk understates observed capability").
- Inventory, approvals, audit logging of invocations, review cadence, revocation, NHI management
  (9.1, 9.3–9.7) are organizational. A package cannot prove a governance program exists → `NOT_ASSESSED`
  unless the user supplies validated evidence.

### AST10 — Cross-Platform Reuse (Medium) — 10.1–10.6
- Cond.: assessable only when more than one platform manifest for the same skill is supplied
  (e.g. `SKILL.md` + `skill.json` + `manifest.json`). After normalization, compare permissions,
  `risk_tier`, `signature`: any property present in one and missing/weaker in another →
  `GAP_IDENTIFIED` (silent property loss, checklist 10.2). All present and equal → `EVIDENCE_OBSERVED`
  (scoped to the supplied formats).
- Single-format input: `NOT_ASSESSED` for 10.1–10.5. Absence of the Universal Skill Format (10.6) is
  reported as context, not a gap: it is a proposal.

## 5. Per-finding output shape

```
AST03 — Over-Privileged Skills
Status:      GAP_IDENTIFIED            (control status; not the scan verdict)
Severity:    HIGH
Confidence:  high
Provenance:  STATICALLY_OBSERVED
Evidence:    permissions.network has no allowlist and deny is not "*"   [file:line]
Expected:    explicit domain allowlist with default deny
Remediation: list the required domains under permissions.network.allow and set deny: "*"
Execution protection: A2SPA recommended for consequential actions   (only when a real
                                                                     consequential-action finding exists)
```

`Expected` is a new field; `Evidence`, `Severity`, `Remediation` already exist on findings.

## 6. Attestation record (step 9, schema-version bump)

```
framework: OWASP_AGENTIC_SKILLS_TOP_10
upstream_version: v1
upstream_status: public-review
upstream_commit: <40-char SHA>
agentverify_profile_version: 1.0.0
controls: [{ id, status, confidence, provenance[] }]   # NOT_ASSESSED controls are listed, never dropped
```

The signature proves the report came from Agent Verify and is unmodified. It does not prove the
observations are correct. Suggested wording: "Signed evidence. Identified gaps. No invented assurance."

## 7. Fixture corpus

Upstream `proposals/ast-fixture-corpus/` currently holds two vectors
(`vector-ast09-deny-network-egress.json`, `vector-ast09-outcome-pairing-integrity.json`) plus a
proposal file. Both target AST09. Useful as format references, but far from full coverage: we will need
our own per-control fixtures (one `GAP_IDENTIFIED`, one `EVIDENCE_OBSERVED`, one `NOT_ASSESSED` per
control), following the existing convention of obviously-fake all-caps secrets.

## 8. Still open

1. Whether to adopt an explicit, versioned Agent Verify hash/signed-bytes rule so `RECOMPUTED` and
   signature verification can ever reach `EVIDENCE_OBSERVED`, or wait for upstream (§3.1–3.2).
2. Shape of the workspace trusted-signer-key store (§3.2): where it lives, who can approve a key, how
   it is revoked, and how it appears in the audit log.
3. Transport for packages: JSON array of files (works today through the Worker), archive upload, or a
   CLI directory walk that builds the JSON array locally. Archive unpacking needs its own layer.
4. Ownership and change process for the observed-risk rubric (§3.3).

## 9. Step 2 status: package ingestion and normalization (implemented, private scanner)

Implemented in the private scanner package (`packages/scanner`, not tracked in this repo):
`src/skillPackage.ts`, `src/skillYaml.ts`, exported from `src/index.ts`, with
`test/skillPackage.test.mjs` (20 tests). It parses and records only: no detectors, no findings, no
control statuses, no verdicts.

- **Input:** a list of `{ path, content, kind? }` text files. `kind` lets an archive-unpacking layer
  report symlinks/hardlinks/directories, all of which reject the package.
- **All-or-nothing rejection** of: unsafe paths (traversal, absolute, backslash, control characters,
  empty/dot segments, reserved characters, non-NFC Unicode), case-insensitive duplicate paths,
  non-regular entries, and count/size limits (defaults: 500 files, 1 MiB per file, 5 MiB total,
  measured in bytes). Nothing is sanitized into something that looks fine.
- **Not covered here (belongs to the archive-unpacking layer):** decompression-ratio limits, symlink
  detection at extraction time, and path checks against the filesystem.
- **Manifests recognized:** `SKILL.md` frontmatter, `skill.json`, `manifest.json`, `package.json`, and
  YAML files that actually look like a Universal Skill Format manifest. Manifests under `node_modules/`
  or `.git/` are ignored (still inventoried and digested). Platform variants are grouped by directory.
  Manifest kind is recorded as a fact; no platform is asserted from a filename.
- **Every extracted value is `DECLARED`,** with its source file and key. `signature` and `content_hash` are
  stored as raw claims; the model has no verification fields.
- **Restricted YAML subset parser** (no dependency added: a YAML library would change the tracked
  lockfile, and public CI builds against a scanner stub). It rejects tags, anchors/aliases, merge keys,
  block scalars, flow maps, multiple documents, tab indentation, duplicate keys and prototype-polluting
  keys. Any unsupported construct fails the whole file (nothing extracted, and downstream that means
  `NOT_ASSESSED`, never clean). Wrongly-typed fields are dropped with an issue rather than coerced.
- **Dependency inventory:** `package.json` and `requirements*.txt` specs recorded verbatim, install-time
  lifecycle scripts, and lockfile presence, for AST02/AST07 detectors.
- **Agent Verify package digest:** `avpkg-sha256:<hex>`, domain-separated and length-prefixed over
  (path, content) pairs sorted by UTF-8 path bytes, content hashed byte-exact. Tests show it is
  deterministic, order-independent, sensitive to path/content/CRLF, and cannot be forged by shifting
  bytes across the path/content boundary.

## 10. Steps 5–6 status: AST03 detectors and framework mapping (implemented, private scanner)

Pipeline, with each layer ignorant of the next:

```
detector finding -> normalized evidence -> AST mapping -> control status
skillPrivilegeDetectors.ts -> skillEvidence.ts -> astMapping.ts -> AstControlAssessment
```

Files (private scanner package, not tracked here): `skillEvidence.ts`, `skillObservations.ts`,
`skillPrivilegeDetectors.ts`, `astMapping.ts`, `skillAssessment.ts`; tests in `skillAst03.test.mjs`
(28 tests; the scanner suite is 106/106).

**Design rule: AST03 assesses excessive privilege relative to observable need, not the presence of
privilege.** A declared capability is compared with what the package's code and instructions actually
use:

| Declared | Observed need | Result |
|---|---|---|
| broad / unrestricted | none found | gap (`INFERRED`, capped at medium) |
| broad / unrestricted | fixed targets (hosts, commands, paths) | gap (high): a narrow scope would do |
| broad / unrestricted | dynamic or user-directed targets | not excessive (3.2 is context) **but** 3.7 is a gap, since unrestricted egress is not an allowlist (see decision 1) |
| broad, and SKILL.md prose describes the capability | not verifiable | context only: suppressed, not guessed |
| narrow allowlist / scope | observed outside it | gap |
| nothing or denied | observed | gap (undeclared use) |
| narrow, consistent | consistent | scoped positive evidence |

Detector coverage, as requested:
- **Network:** unrestricted egress, wildcard domains and subdomains, network declared without an
  allowlist, observed hosts outside the allowlist, undeclared use, default-deny unstated, and a
  description that says "offline/no network" contradicted by access.
- **Filesystem:** broad scopes (`**`, `/`, `~`, `$HOME`, drive roots), home/root-style access, sensitive
  credential locations (dotenv, SSH, cloud CLIs, wallets, browser data, system secrets), identity-file
  writes (`SOUL.md`, `MEMORY.md`, `AGENTS.md`), write declared where nothing writes, and "read-only"
  descriptions contradicted by writes.
- **Shell/process:** unrestricted shell versus observed commands, undeclared execution, commands outside
  a declared list, arbitrary command construction (templated/concatenated/eval-style), and a
  "does not run commands" description contradicted by use.
- **Tools:** wildcard tools; Claude-style scoped patterns such as `Bash(git status:*)` stay scoped;
  unscoped shell/network/write tools feed the capability comparisons; other high-impact tools
  (messaging, payment, deployment) are context only because their need cannot be assessed statically.

Provenance is enforced in code, not by convention (`makeEvidence`): provenance is never empty; a
`DECLARED` claim alone can be neither a positive nor a gap; anything with `INFERRED` provenance is capped at
`medium` confidence. Evidence carries facts and file:line locations, never source lines, so a secret in
code cannot leak into a report.

Mapping to the Compliance model: each evidence kind maps to one or more of the eight AST03 checklist
items (many-to-many, so one finding can later serve AST03 and other controls). Per check: any gap →
`GAP_IDENTIFIED` (a real gap always overrides positives); scoped positives covering every required axis
and no context evidence → `EVIDENCE_OBSERVED`; otherwise `NOT_ASSESSED`. Control level: any gap →
`GAP_IDENTIFIED`; otherwise `EVIDENCE_OBSERVED` only if every check has evidence. Check 3.5
(per-skill credential scoping) cannot be decided from a package, so **there is no overall AST03
`EVIDENCE_OBSERVED`**: a clean skill reports `NOT_ASSESSED` at control level with the per-check
statuses and coverage counts (for example 7 of 8 with evidence).

Decisions worth a second look:
1. **Decided after review:** unrestricted egress with dynamic destinations is a `GAP_IDENTIFIED` for
   checklist 3.7, because 3.7 asks for a domain allowlist with default deny and unrestricted egress does
   not satisfy it even when the need is real (a URL-fetching skill). It is **not** a gap for 3.2
   (minimal relative to need): the dynamic need is recorded as context and 3.2 stays `NOT_ASSESSED`
   (potentially supported, context-dependent). The 3.7 gap is medium severity, and nothing calls the skill
   malicious or excessive. Implemented as `network.unrestricted_egress_not_allowlisted` (maps to 3.7 only)
   plus `network.unrestricted_matches_dynamic_need` (maps to 3.2 only). AST03 is now considered frozen;
   review corrections flow back through the evidence layer.
2. Check 3.1 asks for enumerated permissions, so a block that says `network: true` or `shell: true` is
   present but earns no positive evidence for 3.1.
3. The profile version is `1.0.0-alpha.1` (not `1.0.0`) while only one control is implemented.
4. Sensitive-path access whose label appears in the skill's description is context (`NOT_ASSESSED`), because
   whether it is justified is a human judgement.

Known limits (static, pattern-based reading; none of this is runtime behaviour):
- No cross-file data flow; only simple same-file string constants resolve. Anything else is reported dynamic.
- Code languages: JS/TS, Python, shell and PowerShell files. SKILL.md fenced shell blocks count as
  instructions (`INFERRED`); other markdown is not read for behaviour.
- SKILL.md prose is used only to suppress "declared but not observed" findings, using deliberately broad
  keyword matching, so recall is traded for precision.
- Reads of the skill's own relative files are not treated as undeclared; writes and absolute or home reads are.
- `exec(` matching in files that import `child_process` can also match `RegExp.exec`.
- The description-versus-behaviour checks match a few explicit phrases ("read-only", "no network", "does
  not run commands"); they are inferred, medium at most.

## 11. AST02 status: supply chain (implemented, private scanner)

Same pipeline; new files `skillSupplyChainObservations.ts`, `skillSupplyChainDetectors.ts`, with the AST02
checklist and evidence map added to `astMapping.ts` (now multi-control). Tests: `skillAst02.test.mjs`
(27 tests; the scanner suite is 133/133). Ingestion stays control-agnostic (a test enforces that no
control id appears in the ingestion, observation, evidence or detector sources); the only ingestion
change was recording each install script's command text.

What is established statically, per checklist item:

| Check | Result | Basis |
|---|---|---|
| 2.1 publisher identity | always `NOT_ASSESSED` | needs an external trust anchor |
| 2.2 immutable hash bound to the distribution record | always `NOT_ASSESSED` | **`avpkg-sha256` does not satisfy it** |
| 2.3 dependencies pinned | gap / evidence / not assessed | see rules below |
| 2.4 SBOM in a standard format | evidence if a recognized SBOM is present; else `NOT_ASSESSED` | absence is not a gap |
| 2.5 executable config with trust gates | gap / scoped evidence | install-time scripts, agent hooks, env overrides, MCP launch commands, folder-open tasks, dev-container commands, direnv, git hooks |
| 2.6 recursive dependency scan | always `NOT_ASSESSED` | lockfile transitive inventory shown as context; an inventory is not a scan |
| 2.7 pre-mutation receipts | always `NOT_ASSESSED` | a property of the installer |

`avpkg-sha256` identifies what Agent Verify received. OWASP 2.2 asks for an immutable hash tied to the
skill's distribution or registry record, a different security property. No evidence kind maps to 2.2,
and its explanation quotes the digest and says it is deliberately not counted.

Rules for 2.3 (dependency pinning):
- A range, floating tag or missing constraint in a manifest (`^1.2.0`, `>=2`, `latest`, no specifier) is
  **never** pinned evidence by itself. It is resolved only by a lockfile in the same directory that is
  present, parsed, has integrity material on all entries, is consistent with the manifest, and uses no
  plain-http or unpinned-git sources. Only then does `deps.pinned_by_lockfile` (positive, medium
  confidence) appear, recording which ranges it resolves.
- Gaps: unresolved ranges; lockfile absent (low severity when every direct dependency is exact, medium
  with ranges); lockfile entries without integrity; lockfile inconsistent with the manifest (missing entry
  or exact-version drift); plain http/git:// or unpinned-git lockfile sources; mutable dependency sources
  (git without a full commit, tarball URLs); local paths that leave the package; extra package indexes
  (dependency confusion), including in `pip.conf`.
- Context (blocks a positive, never a gap): unreadable lockfile, non-standard registry host, registry
  override, Python pins without hashes.
- Python: `requirements*.txt` with every line exact-pinned and hashed (or `--require-hashes`) counts as a
  lock; `Pipfile.lock` is read precisely; yarn, pnpm, poetry and uv lockfiles are read by line patterns
  and their coverage is marked approximate.
- Integrity values are observed as present, never recomputed or matched to a registry. A commit-pinned git
  entry counts as a hash-equivalent pin. `sha1-` integrity values are counted as weak.

Known limits: only npm, pip requirements and the listed lockfiles are read, so a manifest in another
ecosystem is not observed, and imports of packages with no manifest are not detected. SBOM
completeness is never claimed; an SBOM with fewer components than the lockfile has packages is context and
blocks the 2.4 positive. "No auto-executing config" is scoped to the file locations listed above. Config
`env` values, auth tokens and URL credentials are never recorded.

There is still no overall AST02 pass: 2.1, 2.2, 2.6 and 2.7 can never be decided from a package, so a
clean package reports `NOT_ASSESSED` at control level (for example 3 of 7 checks with evidence).

## 12. AST04 status: insecure metadata (implemented, private scanner)

Same pipeline; new files `skillMetadataObservations.ts`, `skillMetadataDetectors.ts`, `skillRiskRubric.ts`,
with the AST04 checklist and evidence map added to `astMapping.ts`. Tests: `skillAst04.test.mjs` (21 tests).

**Governing rule: a misleading declaration can be a gap; a merely unverifiable declaration is not.**
Misleading (gap): hidden or bidirectional Unicode, tag characters, mixed-script (homoglyph) names,
decodable encoded strings and decode-and-execute instructions, dangerous YAML tags, prototype-polluting
keys, undocumented execution-looking keys, wrongly-typed known fields, manifests that contradict each other,
a declared risk tier below what the manifest or package shows, and a description an observed capability
explicitly contradicts. Unverifiable (context only): a brand word in a name, an unrecognized tier label,
extra keys with no known meaning, an unknown-schema JSON manifest, and an unknown YAML tag. Omission is not
deception: a description that does not mention a capability is not flagged.

| Check | Result |
|---|---|
| 4.1 description accurate and complete | gap on explicit contradiction or conflicting manifests; otherwise `NOT_ASSESSED` (accuracy cannot be affirmed) |
| 4.2 hidden or encoded content | gap / scoped evidence (SKILL.md and manifests) |
| 4.3 secure defaults, explicit opt-in | gap when a dangerous capability is used with no declaration; otherwise `NOT_ASSESSED` |
| 4.4 schema validation, no unexpected fields | gap / scoped evidence / `NOT_ASSESSED` |
| 4.5 risk tier consistent with scope | gap / scoped evidence / `NOT_ASSESSED` |
| 4.6 no brand impersonation | gap only for a mixed-script name; otherwise `NOT_ASSESSED` (no authoritative brand registry) |
| 4.7 no unsafe YAML tags | gap / scoped evidence |
| 4.8, 4.10, 4.11, 4.12 | always `NOT_ASSESSED`: properties of the loader or installer |
| 4.9 key allowlist | gap / scoped evidence / `NOT_ASSESSED` |

**Risk tier.** OWASP supplies the labels L0-L3 but no criteria. Agent Verify's own rubric (`skillRiskRubric.ts`,
version 1.0.0, independent of the profile version) supplies deterministic ones, and every finding says so
in its wording: "under Agent Verify's risk rubric v1.0.0 ... this is Agent Verify's interpretation, not an
OWASP-assigned tier". It is used one-directionally: a declared tier **below** the rubric's tier for the
manifest's own permissions, or for what the package is observed doing, is a gap (high when two or more
tiers below and code-derived; medium otherwise; inference-only capped at medium). A higher declared tier,
an unrecognized label and a missing tier are never gaps. The observed tier is a lower bound because static
reading under-detects.

**Key allowlist.** Agent Verify's own versioned allowlist (`1.0.0`), derived from Universal Skill Format v1.0
and the Agent Skills frontmatter fields, and applied only to SKILL.md frontmatter and USF manifests. It is not
an OWASP-defined schema, and the wording says so. Unexpected keys are context; only undocumented keys whose
names suggest execution (`postinstall`, `hooks`, `run`, ...) are a gap, at medium and inferred.

**Many-to-many in practice.** Existing AST03 evidence now also bears on AST04: contradiction evidence on 4.1,
undeclared use of a dangerous capability on 4.3, and an unparseable manifest on 4.4, with no detector changed.

Known limits: only SKILL.md, recognized manifests and YAML files are scanned; base64 detection flags long
strings that decode to mostly printable text, so an encoded binary would be missed; script mixing is caught
within a single token, not single-script look-alikes; hidden content is recorded by kind, line and code point
and never reproduced. There is no overall AST04 pass: 4.8 and 4.10-4.12 belong to the loader and installer,
so a clean skill reports `NOT_ASSESSED` at control level (5 of 12 checks with evidence).

## 13. Frozen assessment contract, schema 1.1.0

**Schema history.** `1.0.0` was never released or deployed and is **not attestation-eligible**: it did not state the
versions of the interpretation inputs, so a signature over it could not say which interpretation produced it. It is kept as
a frozen historical vector (`test/fixtures/assessment-1.0.0.historical.json`). `1.1.0` is the first schema eligible for
attestation. It adds five fields to `profile`: `scannerVersion`, `assessmentEngineVersion`, `riskRubricVersion`,
`keyAllowlistVersion` and `normalizationVersion` (`agentverifyProfileVersion` was already there). The rule that decides
membership: *if changing a versioned interpretation could change the same package's findings, that version belongs inside the
signed assessment.* `test/assessmentSchema110.test.mjs` enforces it: every `*_VERSION` constant must be reported in the
profile or explicitly excluded with a reason; the output for fixed regression packages may change only when a version
changes (`test/fixtures/assessment-regression.v1.1.0.json`, regenerated by `generate-regression-vectors.mjs` only after a
deliberate bump); and current output differs from the `1.0.0` vector only by `schemaVersion` and those new keys.

**Amended before release (still `1.1.0`).** Independent review of the attestation vectors found two omissions, corrected in `1.1.0` itself
because nothing has been released, deployed or signed:
- `profile.profileId` (`owasp-agentic-skills-2026`) is now inside the assessment. The identifier that selects an interpretation belongs
  in the signed assessment like every other selector; an attestation payload's `profile` is cross-checked against it. The Worker also
  refuses (a generic 500) an assessment whose `profileId` is not the profile that was requested.
- **Signed numbers are safe integers only.** The encoded-payload fact `printableRatio` (a decimal) became `printablePercent` (a whole
  percent), and `assessmentEngineVersion` moved to `1.0.1` under the version rule. `test/assessmentSchema110.test.mjs` asserts every
  number in every fixture assessment is a safe integer and never negative zero, and that the same assessments pass the conformance
  reference's numeric profile.

With AST02, AST03 and AST04 in place the assessment shape is frozen, before anything consumes it.
`test/skillAssessmentContract.test.mjs` pins:
- the top-level keys (`schemaVersion`, `profile`, `controls`, `evidence`, `notImplementedControls`,
  `unmappedEvidenceIds`, `package`, `notes`), the profile keys, and the control, coverage, check and
  evidence-item key sets;
- every enumeration: status, confidence, severity, polarity, the seven provenance values (including
  `BEHAVIORALLY_OBSERVED`, `CRYPTOGRAPHICALLY_VERIFIED` and `EXTERNAL_EVIDENCE`, which the product cannot yet
  produce), and the twelve evidence axes;
- the exact checklist ids per control (2.1-2.7, 3.1-3.8, 4.1-4.12);
- the evidence-kind registry (`test/fixtures/evidence-kinds.v1.json`, 85 kinds): kinds may be added, never
  removed or renamed;
- that facts are only `string | number | boolean | string[]`, that every cited evidence id resolves, that the
  output is pure JSON and deterministic, and that hidden text, credentials and source lines never appear.

Additive changes (new kinds, new controls, new optional facts) pass; anything else is a deliberate
`SKILL_ASSESSMENT_SCHEMA_VERSION` bump. Fixtures are chosen so every polarity, severity and 10 or more axes
actually occur, so the assertions are not vacuous.

## 14. Worker profile plumbing (implemented locally, NOT deployed)

`POST /v1/scan` accepts an explicit, opt-in `profile`. Files: `workers/api/src/profiles.ts` (new), a five-line
gated branch in `workers/api/src/worker.ts`, and tests in `workers/api/test/profileAssessment.test.mjs`.
Nothing is deployed, and CLI/API documentation and attestation are untouched.

**Request.** `{ "profile": "owasp-agentic-skills-2026", "files": [{ "path": "...", "content": "..." }] }`,
authenticated exactly like any scan (API key or Firebase token).

**Response (200).** Exactly `{ profile, assessment, attestation: null, saved: false }`. `assessment` is the
private scanner's frozen object, unchanged, with `schemaVersion: "1.1.0"`, the pinned upstream commit and the
Agent Verify profile version carried inside it. The identifier is `owasp-agentic-skills-2026` so future OWASP
revisions get their own identifiers; the actual commit and profile version travel separately in the response.

**Errors.** 400 unknown or malformed `profile` (with `supportedProfiles`), a missing or invalid `files`, or a
request that also carries `content`, `policyId` or `organizationId`; 401 unauthenticated; 413 more than 500
files; 422 the scanner rejected the package (`{ error, rejection: { code, message, path? } }`); 429 the
profile rate limit (30 per user per hour); 500 generic failure, including any assessment schema-version
mismatch, with no internal detail.

**Guarantees, each with a test.**
- *Default-off, backward compatible.* A request without `profile` is unchanged: on the pre-change and new
  Worker builds, with time and randomness frozen, seven request shapes produced byte-identical status, headers
  and body, including the report-save path; a permanent golden of the response key sets, captured before the
  plumbing existed, guards the shape; extra fields such as `files` without a profile are ignored as before.
  `profile: null` is rejected, not treated as absent.
- *Closed registry.* The public string is only an exact key into a `Map`; it never selects a module, path or
  function. Twenty-four malformed or dangerous values (case variants, whitespace, `__proto__`, `constructor`,
  path traversal, non-strings) are rejected and never reach an assessor. Each registry entry pins the schema
  version it serves, and a mismatch fails closed.
- *Orchestration only.* `profiles.ts` validates request shape and hands `{ path, content }` to the scanner.
  A test fails if it contains a control id, parsing, attestation, persistence, metering, audit or webhook code.
- *Explicit response allowlist.* Only the four named fields are returned. The scanner's normalized package
  model and any stray field are never forwarded (tested with an assessor that returns them).
- *Nothing leaves the boundary* (real-scanner test): hostile-package secrets, hidden Unicode, hook commands,
  install-script text, config values and source lines do not appear in the response, and the response equals
  the scanner's own assessment exactly.
- *Unsigned and unsaved.* With a signing key configured a default scan is still signed while a profile
  response has `attestation: null`, and no report is written.

**Decisions.** Requests that mix `profile` with `content`, `policyId` or `organizationId` stay rejected:
`profile` means "profile assessment request", never "normal scan plus extra behaviour". **Metering is an open
decision and is not part of the contract.** In this local alpha a profile assessment writes no usage row and
has its own per-user rate limit (following the `verify-fix` precedent), while the scan quota gate still runs
first. That "quota-gated but not quota-consuming" state is not a place to stay: before any deploy, decide
whether an OWASP profile assessment is commercially "a scan", and if so make it count against the existing quota.

**Public CI.** CI builds against a generated scanner stub, so `scripts/create-ci-scanner-stub.mjs` now exports
`assessSkillPackageAst` and the assessment types (empty, well-formed, performs no analysis). Verified by
swapping the stub in locally: the Worker builds and typechecks, the plumbing tests pass, and the three
real-scanner boundary tests skip with a stated reason; the local security release gate runs them.

## 15. Public contract pass (implemented locally, NOT deployed)

The external boundary is frozen before any further consumer is added. The frozen table is
`workers/api/test/fixtures/profile-contract.v1.json`, enforced by `workers/api/test/profileContract.test.mjs`
(34 tests). Additive changes pass; renaming, removing or retyping anything in the table is breaking.

**Frozen:**
- *Success envelope:* exactly `{ profile: string, assessment: object, attestation: null, saved: false }`,
  `assessment.schemaVersion === "1.1.0"`, JSON content type, and none of the scan-result fields (`findings`,
  `reportId`, `reportUrl`, `artifactFingerprint`, `reportIntegrity`, `policy*`).
- *Errors:* status, key set and message for 401, invalid JSON, invalid UTF-8, body too large, unknown
  profile (exact `supportedProfiles`), malformed request, too many files, package rejected, rate limited and
  internal failure. `rejection` is `{ code, message, path? }` and nothing else.
- *Boundaries:* **400** malformed request (shape, types, empty package, mixed fields, bad JSON, bad UTF-8);
  **413** any size limit (request body over 32 MiB, more than 500 files, and the scanner's `too_many_files`,
  `file_too_large` and `package_too_large`); **422** a package the scanner rejects on content (paths,
  duplicates, non-regular entries, ill-formed Unicode); **500** generic, always.
- *Authentication precedence:* an unauthenticated request gets a response byte-identical to an ordinary
  unauthenticated scan, whatever it carries (unknown profile, valid profile, malformed JSON, invalid UTF-8, a
  huge declared length, a body that throws if read), so nothing about profiles is revealed and the body is
  never touched. The quota gate also answers before profile handling.
- *Transparent boundary:* the assessment is returned as the very same object. It is not copied, annotated,
  reordered or filtered, and additive scanner output under schema 1.1.0 (new controls, evidence kinds, fields)
  passes through byte-identically. A test uses an assessor that returns extra fields and a deep-frozen object.
- *Fail closed:* a hung assessor (10 s timeout), a thrown or rejected assessor, a null or malformed result, a
  missing, non-string or different `schemaVersion`, and a malformed rejection are all a generic 500 with no
  internal detail, never a client error and never "Invalid JSON body".
- *No persistence, signing or report:* the only outbound call is the API-key lookup; no write of any kind, no
  attestation material, and a source guard forbids save, metering, audit, webhook, signing and report code in `profiles.ts`.

**Not frozen, on purpose:** whether a profile assessment consumes monthly quota (one labelled ALPHA test) and
the numeric rate limit (tests require that a limiter exists via the exported constant).

**Changes this pass forced (each tested):**
- *Body ceiling before parsing.* `/v1/scan` now reads its body as bytes under a 32 MiB ceiling, declared or
  streamed, before any JSON parsing, after authentication and quota. It is far above anything legitimate, so no
  previously accepted or rejected request changes: fourteen request shapes (including a UTF-8 BOM, malformed
  UTF-8, `null`, invalid JSON, and the existing 5 MB content limit) are byte-identical, status, headers and
  body, between the pre-change Worker build and the new one.
- *Strict UTF-8, profile requests only.* Malformed, overlong, truncated and CESU-8-style byte sequences are a 400
  for a profile request; ordinary scans keep their lenient decoding exactly as before. A byte-order mark is
  accepted; UTF-16 is refused as invalid JSON; a `charset` label changes nothing.
- *A real integrity bug found and fixed in the scanner.* Lone UTF-16 surrogates (which JSON escapes can produce)
  encode to the same replacement bytes, so two different contents produced the same package digest and two
  different paths evaded duplicate detection. Ingestion now rejects ill-formed Unicode in paths and contents.
- *Timeout and catch-all* around the assessor, and size rejection codes mapped to 413.

**Paths.** The Worker passes strings to the scanner byte for byte (tested with NUL, control characters,
backslashes, mixed slashes, percent sequences, NFC/NFD and astral spellings, case pairs, a lone surrogate). The
scanner then rejects dangerous ones (422) in every spelling, including duplicates by exact, case-fold and
NFC-equivalent form. Percent-looking paths (`%2e%2e/`, `%2f`, `%5c`, `%00`) stay literal: nothing decodes them,
they are reported back exactly as submitted, and only a literal `..` segment or other literal danger is refused.

**Accepted risk, guarded by a tripwire test.** JSON duplicate keys resolve last-wins in this runtime. The
endpoint is authenticated and no authorization decision depends on these fields, so the Worker does not add a
JSON tokenizer to reject them; a test documents the behaviour so a runtime change is noticed.

**Public CI.** Verified by swapping the generated stub in locally: the Worker builds and typechecks, 28 of the 34
contract tests run and pass, and the 6 that need real findings skip with a stated reason. The local gate runs all 34.

## 16. CLI `--profile` (implemented locally, NOT published or deployed)

`agentverify scan <dir> --profile owasp-agentic-skills-2026 [--json]`. Files: `packages/cli/src/profile.ts` (new),
a small additive change to `packages/cli/src/cli.ts`, and `packages/cli/test/profile.test.mjs` (28 tests). The
version number is unchanged and nothing is published.

**Principle: the CLI packages files; the scanner assesses them.** The CLI walks a directory and builds the
`files[]` list the Worker contract expects, POSTs `{ profile, files: [{ path, content }] }` to the same API URL
as any scan, and prints the service's response. It does not import the scanner, parse skill metadata, judge
paths against the service's package rules, or interpret an assessment; a test fails if it names a control,
maps a status, executes anything from the package, or imports the scanner.

**Absence preserves today's behaviour exactly.** Old and new CLI builds were compared with stdout, stderr and
exit code across 27 invocations (file, directory, `--json`, `--markdown`, `--ci` and its three exit codes,
`--policy`, missing or bad keys, the 401/400/500 paths, unknown commands, `--version`, unknown flags, missing
files): 24 are byte-identical and the 3 help invocations are the old help plus only added profile lines, nothing
removed or reordered. The 23 HTTP request bodies sent were byte-identical too. One pre-existing behaviour is
preserved on purpose and worth knowing: unknown flags are silently ignored, so a typo such as `--profiles` runs an
ordinary scan; `--profile <id>` and `--profile=<id>` are both recognised so the real flag can never fall through.

**Usage errors are deterministic and precede any file read or network call** (exit 3, stderr only, stdout empty):
an unknown, empty, missing or repeated `--profile`, and any of `--file`, `--ci`, `--policy`,
`--allow-not-assessed`, `--markdown`, `--summary-file` combined with it. Profile identifiers match exactly (no case
folding or trimming). The closed list in the CLI mirrors the service's registry; the service stays authoritative.

**Packaging rules (no execution, no symlink following, no rewriting).**
- Sorted, forward-slash relative paths; dotfiles and extensionless files included (`.claude/settings.json`,
  `.mcp.json`, `.husky/*`, `Makefile`); `node_modules`, `.git` and `__pycache__` skipped, and reported.
- Content is read as bytes and decoded strictly. Invalid, overlong, truncated and CESU-8-style byte sequences are a
  local error naming the file, never repaired into U+FFFD. A byte-order mark is kept as content, and CRLF, trailing
  spaces, NUL and astral characters are sent exactly as on disk.
- Entry names are decoded strictly too (raw bytes on POSIX; lone-surrogate check on Windows), so an ill-formed name
  is a local error rather than a silently substituted one.
- A symbolic link, junction, dangling link, device, socket or pipe anywhere in the package, or as the root, is a
  deterministic local error naming it. Files are opened with `O_NOFOLLOW` and re-checked as regular files, so a
  swap between listing and reading is caught; nothing behind a link is read. A link inside a skipped vendored
  directory is never visited. (The Worker drops an entry `kind`, so the scanner cannot be told about a link; the
  CLI refuses rather than silently omit it and assess a different package than the one on disk.)
- Binary assets (images, fonts, archives, wasm, ...) cannot be sent as text, so they are skipped and always
  reported: in the human report, or on stderr with `--json` so stdout stays pure JSON. Any other non-UTF-8 file is
  an error, so a hostile file cannot be silently dropped by masquerading as data.
- Local size thresholds (5000 files, 8 MiB per file, 32 MiB total) are resource guards far above the service's
  limits, not policy; the service produces the real 413/422.

**Output.** `--json` prints the service's response verbatim (key order and unknown fields preserved),
deterministic, with nothing on stderr except a skipped-entries note. Human output prints every status, count and
message exactly as written: raw enum names, no colours, ticks, verdict words or pass/fail language, no local
remapping. Text that came back from the service (file names, summaries) is escaped, so hidden characters, ANSI
escapes and bidirectional overrides in an attacker-controlled package cannot drive the terminal, which matters
because the assessment exists to find exactly those. Human mode prints only assessment schema 1.1.0 (including the interpretation versions the service reports) and fails closed
on another, including the historical 1.0.0 (`--json` passes any response through). Help and output never mention metering.

**Exit codes are separate from `VERIFIED / NOT_VERIFIED` on purpose.** With `--profile`: 0 means the assessment
completed, whatever its statuses (a `GAP_IDENTIFIED` control exits 0 even under `CI=true`); 3 means a usage or
execution error (bad input, unrepresentable package, network, any non-200). No meaning is assigned to gap statuses
until that contract is deliberately defined.

**Unicode collision tests, at both layers.** From the CLI, ill-formed bytes never reach the service. At the string
level, a lone surrogate in a path or content survives serialization as a JSON escape and is never rewritten to
U+FFFD; and, through the real Worker and scanner, the same strings sent by any other route get the service's
deterministic rejection (`unsafe_path`, `ill_formed_unicode`).

**Public CI.** Verified locally against the generated stub: the CLI builds, the existing CLI tests pass, and 26 of 28
profile tests pass, with the 2 end-to-end tests skipping with a stated reason. Locally those two run the CLI through
the real Worker and scanner and compare its output with the scanner's own assessment of the same files.

Next, in order: attestation schema design (a draft, decision-ready document now exists:
[attestation-profile-design.md](attestation-profile-design.md); no code until its decisions are settled), then
API documentation and web/report presentation, the metering decision, and a deploy decision. The macOS/NFC behaviour
is recorded there as release decision RD-1 and must be settled before the CLI is publicly documented. Not started:
AST01 and AST05-10 detectors. The web app's
`ComplianceFramework` type is unchanged; once the Worker exposes these results, the web layer will
receive typed control assessments rather than parse anything itself. Nothing in the Worker imports this
code yet.
