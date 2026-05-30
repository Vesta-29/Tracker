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

Open `http://localhost:3000` and sign in with the pre-filled demo credentials.

## Connect Supabase

1. Create a Supabase project.
2. Run `supabase/migrations/202605300001_initial_schema.sql` in the SQL editor or through the Supabase CLI.
3. Seed the full PSA PSGC location master list and your approved workplace reference values.
4. Copy `.env.example` to `.env.local` and add the Supabase project URL and anon key.
5. Replace the local demo repository calls in `components/tracker-app.tsx` with Supabase queries or server actions.

The browser demo intentionally uses a representative PSGC subset. Production should import the official PSA PSGC master list before launch.
