# Post-refactor review — VDaAgent

This review covers the working-tree replacement of the TypeScript monorepo with the
FastAPI/PostgreSQL backend, shared execution sandbox, React/Vite frontend and Docker stack.

## Corrections

- Standardized the product name to **VDaAgent** in the UI, API titles, provider headers,
  packages, assets, fixtures, prompts and English/Vietnamese documentation. The old server
  directory spelling remains only in the deployment migration step so existing configuration
  can be retained. The documented internal `contoso` namespace remains the backend identifier.
- Applied the execution folder boundary to Git snapshots and backend Git commands. Disabled
  hooks/fsmonitor and global/system Git configuration; bounded Git subprocess lifetime.
  Regression tests exercise both repository hooks and configured filters.
- Scoped notification events and in-flight responses to the active account. Expire revoked
  frontend sessions and reject stale restore/login responses without replacing a newer identity.
- Rebuild a contiguous chat history window after reconnect and discard obsolete pagination.
  Poll unfinished builder jobs so missed realtime events do not leave them stuck.
- Validate domain YAML and starter fields before import writes, sanitize parse errors and
  detect seed IDs shared by multiple domains. Correct preflight's checked/unchecked state.
- Port stale domain/provisioning tests to async database fixtures. Use explicit synchronization
  for routine ordering; keep production password parameters separate from API test fixture cost.
- Publish the workspace image and all runtime assets in CI/CD, deploy matching commit tags,
  retain existing installation configuration and serialize deployment jobs.
- Separate legacy frontend domain tests from the TypeScript suite. Run browser tests against
  a dedicated server instead of accidentally reusing another project's Vite process.

## Verification

- Backend: 679 tests passed, with 7 service-dependent tests skipped in the ordinary run and
  verified through the real integration service run below; 5 live-provider tests deselected.
- Frontend: 393 tests passed; legacy domain suite: 77 tests passed.
- Browser: 6 pre-authentication, responsive, accessibility and demo-login journeys passed.
- Sandbox: 66 tests passed.
- Real integration services: 10 tests passed, including PostgreSQL, execd, provisioning,
  package/skill installation and snapshot round trips.
- Group-flow tests observe worker replies before the final completion deadline; health boot
  tests explicitly select FakeModel so cleared environment fixtures cannot call a real provider.
- Python and frontend lint, TypeScript/Vite build, workflow validation and source secret scan
  were checked during the review. The source scan found no secrets; installed dependencies
  were excluded from that source-only scan.

Live model-provider tests require credentials and were not invoked. The existing `.gitignore`
content was preserved byte for byte during this review.

## CI follow-up

The first pushed run passed both test jobs and published all three images. EC2 deployment
failed with `missing server host`: the repository had no deployment secrets configured.
The workflow now checks the three EC2 secret names before remote actions. Missing or blank
configuration skips those actions with an explicit notice and job summary; configured
deployments retain their existing validation and failure behavior.
