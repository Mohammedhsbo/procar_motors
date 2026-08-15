# Pro Motors Backend

NestJS modular monolith for **Pro Motors — Vehicle Service Management System**.

Architecture docs (workspace root):

- [`docs/BACKEND_ARCHITECTURE.md`](../docs/BACKEND_ARCHITECTURE.md)
- [`docs/BACKEND_IMPLEMENTATION_PLAN.md`](../docs/BACKEND_IMPLEMENTATION_PLAN.md)
- [`docs/IMPLEMENTER_CHECKLIST.md`](../docs/IMPLEMENTER_CHECKLIST.md)

## Stack (Phase 0)

- Node.js 22 · NestJS 11 · TypeScript (strict)
- PostgreSQL 16 · Redis 7 (via root Docker Compose)
- OpenAPI at `/api/docs`
- REST prefix `/api/v1` (health/ready excluded)

## Local development

### 1. Start infrastructure + stack (from workspace root)

```bash
cd "d:\procar app"
docker compose up -d postgres redis
```

Or full stack (api + web):

```bash
docker compose up -d
```

### 2. Run API on the host

```bash
cd promotors-backend
cp .env.example .env
npm install
npm run start:dev
```

### 3. Verify

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
# Swagger: http://localhost:3000/api/docs
```

Expected health response:

```json
{
  "success": true,
  "data": { "status": "ok" },
  "meta": { "requestId": "..." }
}
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Watch mode |
| `npm run build` | Compile |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests |
| `npm run test:e2e` | E2E tests |

## Approved conventions

- **OQ-07:** API fields `nameEn` / `nameAr` → DB `name_en` / `name_ar`
- **OQ-08:** This folder lives at `promotors-backend/` under the workspace Git root

## Phase status

- **Phase 0:** Complete (scaffold, Docker compose, health/ready, CI)
- **Phase 1:** Complete — migrate + seed applied against local Docker Postgres
- **Phase 2:** Complete — Auth (login/refresh/logout/me) + JWT + RBAC guards
  - Demo password: `Password123!`
  - Login: `POST /api/v1/auth/login`
  - Profile: `GET /api/v1/auth/me`
- **Phase 3:** Core org/users/branches/settings (next)
