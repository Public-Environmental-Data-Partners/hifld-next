# Portolan production compatibility cutover

## Goal

Move production catalog readers and publishing to the Portolan catalog without breaking existing public `/storage/<legacy-key>` download URLs. Keep the candidate bucket reversible during a monitored transition.

## Routing

The existing PEDP load balancer continues serving `/storage/*` from `hifld-next-datasets-prod`. More-specific path rules serve `/storage/hifld/*`, `/storage/releases/*`, `/storage/_catalog/*`, and `/storage/catalog.json` from `hifld-next-portolan-published`, rewriting only the `/storage/` prefix. An exact `/storage/catalog.json` rule is needed alongside the prefix rules. Legacy unprefixed object URLs remain unchanged; new Portolan URLs are available on the PEDP domain and directly on GCS.

The route split is temporary. Removing the old bucket requires either copying compatibility objects into the final bucket at their existing unprefixed keys or a separately approved URL migration. Do not treat the two-bucket state as a single source of truth.

## Release sequence

1. Record the production URL map, Helm revisions/images, Dagster writer targets, active Portolan pointer, and representative download responses.
2. Publish a new Portolan release with the current publisher; complete strict validation with an explicit exception register and exercise GCS A→B→A pointer rollback. No production publisher writes to the Portolan bucket during this rehearsal.
3. Publish and smoke-test pinned pointer-aware webapp and feature-server images. Deploy consumers to a shadow environment before promoting them to production. Keep the old dataset API/discovery available during transition.
4. Apply the additive compatibility routes and verify legacy and Portolan object paths through the public domain.
5. Suspend competing catalog writers; configure the production publisher to target the Portolan bucket; enable pointer-aware production readers, then verify STAC metadata, listings, map/data previews, feature server, and downloads.
6. Observe. Roll back by pausing the candidate publisher, restoring previous reader Helm revisions/config, and removing candidate-only routing if necessary. Reconcile writes before resuming a publisher. Never point `/storage/*` wholesale at the candidate bucket.

## Safety gates

- Legacy download URL remains byte-equivalent and HTTP 200 after routing change.
- New Portolan release and pointer resolve consistently; two-release promotion and rollback passes on GCS.
- Published image digests and production Helm revisions are recorded, with a tested restore path.
- Strict validator exceptions are documented; unresolved errors are not claimed as conformance.
- Production write targets are singular and explicit before enabling schedules/sensors.
