# Federation Salt Migration

## Goal

Stop using `KERA_API_SECRET` as a runtime fallback for federation identity salts.

The canonical salts are now:

- `KERA_CASE_REFERENCE_SALT`
- `KERA_PATIENT_REFERENCE_SALT`
- `KERA_PUBLIC_ALIAS_SALT`

For installed runtimes, the resolved values are persisted to:

- `CONTROL_PLANE_DIR/federation_salt.json`

## Runtime Order

Both Python and Tauri now resolve salts in this order:

1. explicit `KERA_CASE_REFERENCE_SALT` / `KERA_PATIENT_REFERENCE_SALT` / `KERA_PUBLIC_ALIAS_SALT`
2. stored `federation_salt.json`
3. one-time migration from legacy `KERA_API_SECRET`
4. default `kera-case-reference-v1`

After resolution, the runtime writes the resulting values back to `federation_salt.json`.

That means `KERA_API_SECRET` is migration-only now. It is no longer part of the steady-state salt lookup path.

## Recommended Rollout

1. On the current environment, set explicit federation salts once.
2. Start the local runtime so it writes `federation_salt.json`.
3. Verify all nodes in the federation produce the same `CASE_REFERENCE_SALT_FINGERPRINT`.
4. Remove `KERA_API_SECRET` from any role related to case/public alias salts.
5. Keep `KERA_LOCAL_API_JWT_SECRET` for local auth if a fixed local signing secret is still required.

## Notes

- `KERA_PATIENT_REFERENCE_SALT` is optional. If omitted, it follows `KERA_CASE_REFERENCE_SALT`.
- `KERA_PUBLIC_ALIAS_SALT` is optional. If omitted, it follows `KERA_CASE_REFERENCE_SALT`.
- Changing `KERA_CASE_REFERENCE_SALT` after federation data already exists will change fingerprints and case reference IDs.
