# Setup and credentials

## Requirements

- Python 3.12 and uv; alternatively Docker for the supplied Compose setup.
- Supabase project with the versioned SQL migrations applied in filename order.
- Supabase publishable and server secret keys. The secret belongs only in backend `.env`.
- Groq API key for review analysis and the assistant. Forecasting is statistical and does not use Groq.

The connected project is SmartDine AI in Massna, region ap-south-1. The creation quote was 0 per month; usage and future pricing follow the provider account. This implementation does not enable a paid plan.

## Configure

Open `backend/.env`. Keep the populated Supabase URL and publishable key. Set `SUPABASE_SECRET_KEY` from the project's API-key settings and `GROQ_API_KEY` from your Groq account. Do not paste keys into source code or commit `.env`.

In Supabase Auth settings, disable **Allow new users to sign up**. Supplied local configuration already does this. Verify the hosted dashboard flag separately. The database rejects new Auth accounts without the server-controlled `app_metadata.managed_account` marker as an additional guard; clients cannot set this application metadata through signup.

Run `uv sync --frozen` in `backend`, then `uv run python scripts/validate_config.py --live`. The script reports only configuration booleans and safe statuses, never key values.

## First manager

Run `uv run python scripts/bootstrap_manager.py`. Enter the email, full name and a password of at least 12 characters at the hidden prompts. Passwords are not saved or logged. This uses Supabase Auth's admin API and a database bootstrap transaction.

If account creation succeeds but activation fails, the account remains inactive. Repeating bootstrap with the same managed email reconciles the existing account. It does not reset an existing password. Further users are created through the authenticated manager API. The final active manager cannot be removed.

## Runtime

Run the API and worker separately as shown in README. The worker requires the admin secret. Review-analysis jobs also require Groq. Failed jobs retain their outcome for manager inspection and retry after configuration is fixed.

`/health/live` checks process health. `/health/ready` requires the database/admin configuration and an actual schema health RPC. Groq configuration is reported separately so an AI outage does not make restaurant operations unavailable.

## Migrations and testing

Migration files under `supabase/migrations` are the source of truth. Create future files using `supabase migration new <name>`. Apply validated files to the authorized hosted project using the Supabase migration tool, preserving order and history. Never edit an already-applied migration; add a corrective migration.

Test locally with Supabase CLI/Docker, or the documented isolated PostgreSQL harness. A PostgreSQL Auth shim tests SQL permissions/transactions only; actual Supabase Auth must be checked separately. Demo scripts never connect to a database automatically.

## Deployment boundaries

This delivery runs locally. Before a public multi-instance deployment, configure HTTPS ingress, shared rate limiting, backups, monitoring and appropriate CORS origins. No frontend, payment gateway, refunds, tenant separation or cloud deployment is included.
