# Production Checklist

## Before deploying

1. Confirm the production database has a recent backup or snapshot in Supabase/Postgres.
2. If the schema changed, plan a snapshot before running migrations.
3. Pull production envs locally if needed:
   - `npx vercel env pull .env.production.local --environment=production`
4. Run the controlled migration:
   - `npm run migrate:prod -- --yes`

## Required environment variables

- `NODE_ENV=production`
- `DATA_PROVIDER=postgres`
- `STORAGE_PROVIDER=supabase`
- `DATABASE_URL`
- `MIGRATION_DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `SUPABASE_PRIVATE_STORAGE_BUCKET`
- `AUTH_COOKIE_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SITE_URL`

Generate `TOKEN_ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Storage review

1. Keep `SUPABASE_STORAGE_BUCKET` public only for site images.
2. Keep `SUPABASE_PRIVATE_STORAGE_BUCKET` private for receipts and documents.
3. Confirm receipts do not use public URLs and are downloaded only by:
   - `GET /api/admin/receipts/:id/download`

## Post-deploy smoke test

1. Check health:
   - `GET /health`
2. Open:
   - `/`
   - `/privacidade`
   - `/admin/login`
3. Login in the admin.
4. Open `Configurações > Segurança / Produção`.
5. Confirm the production checklist is green enough for use.

## Functional checks

1. Edit a public content block and confirm the site updates.
2. Upload a public image and confirm it loads in the site.
3. Create a lead and convert it when applicable.
4. Create a patient.
5. Create a session.
6. Mark payment as paid.
7. Generate a receipt.
8. Download the receipt from the admin route.
9. Connect Google Calendar and create a synced session.
10. Review `Auditoria` and confirm the actions were logged.

## Safety review before real patient use

1. `TOKEN_ENCRYPTION_KEY` must be set: without it every clinical route refuses with 500,
   and the prontuário is unusable.
2. Keep the administrative record (`Pacientes`) free of clinical content — hypotheses,
   symptoms and reports belong in the prontuário, which is encrypted.
3. Confirm `/privacidade` is accessible from the public footer.
4. Confirm audit logs do not show tokens, passwords, secrets or raw request bodies.
5. Confirm Google tokens never reach the frontend.
