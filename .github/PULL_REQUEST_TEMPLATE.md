## What this changes

<!-- One or two sentences. Why first, what second. -->

## Notes for reviewers

<!-- Anything non-obvious: trade-offs considered, follow-up work intentionally deferred, areas you'd like sharper eyes on. -->

## Manual verification

- [ ] `npm run lint` clean
- [ ] `npm run build` clean (this also runs the typecheck)
- [ ] Exercised the affected flow on `npm run dev` (golden path + at least one error path)
- [ ] No new env var without a corresponding entry in `.env.example`
- [ ] No new third-party domain without a deliberate update to the CSP in `src/proxy.ts`
- [ ] No content-bearing data added to the `src/lib/log.ts` payload allowlist

## Linked issue

<!-- Closes #N, or "n/a". -->
