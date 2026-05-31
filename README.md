# FieldTrack

Internal satellite and internet installation tracker for contractor field work across Philippine locations.

## Included

- Responsive Next.js operations dashboard
- Demo sign-in and seeded installation records
- Filtered dashboard, installation registry, and CSV export
- Installation form with unique site names, lifecycle status, PSGC-style cascading locations, detailed components, and photo selection
- Installation ownership metadata and immutable change-log timelines
- Structured contractor service visits with optional ticket references, configurable visit types, visit photos, and operational filters
- Equipment replacement history with retained removed components and template-driven replacement identifiers
- Admin-defined equipment templates with required text or normalized MAC-address fields
- Unified reusable equipment-field library with global edits, guarded deletion, and component-type attachments
- Excel workbook template download, import preview validation, CSV export, and XLSX export
- Admin settings for contractors, unit types, component types, and configurable installation fields
- Supabase PostgreSQL migration with RLS, indexes, audit trail, and private photo storage policies

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000` and sign in after connecting a hosted Supabase project.

## Connect Supabase

1. Create a hosted Supabase project and disable public email signup in Authentication settings.
2. Copy `.env.example` to `.env.local` and add the project base URL ending in `.supabase.co` without `/rest/v1`, anon key, service-role key, project ref, database password, and first administrator email.
3. Run:

```powershell
.\scripts\setup-hosted.ps1
```

The setup runner links the project, applies every migration, seeds the PSGC hierarchy twice, seeds operational references twice, and invites the initial administrator. Repeated seeds are intentional idempotency checks.

FieldTrack uses Supabase Auth, RLS, database audit triggers, signed photo URLs, and RPC-backed aggregate saves. The app pins `@jobuntux/psgc@0.2.1` and uses its PSA 2025 Q2 dataset for the location cascade.
