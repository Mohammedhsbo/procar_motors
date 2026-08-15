# Optional Kubernetes

Primary production path is Docker Compose (`docker-compose.prod.yml`).

These manifests are a starting point only:

- Liveness: `GET /health`
- Readiness: `GET /ready` (PostgreSQL + Redis)
- Provide secrets via a `promotors-api` Secret (not in git)
- Run `prisma migrate deploy` as an init Job/container before rolling the API
- Scale API replicas freely; BullMQ `upsertJobScheduler` uses stable IDs. Set `JOB_SCHEDULER_ENABLED=false` on extra replicas if you want a single scheduler instance.
