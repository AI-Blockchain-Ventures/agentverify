# Contributing to Agent Verify

## Adding Detection Rules
Detection signals live in packages/scanner/src/signals.ts
Finding definitions live in packages/scanner/src/findings.ts

To add a new signal:
1. Add detection function to signals.ts
2. Add finding definition to findings.ts  
3. Wire it in engine.ts
4. Test with a sample agent config

## Pull Requests
- All new signals must include evidence extraction
- Test with both secure and insecure agent examples
- Do not modify the scoring algorithm without discussion
