# SmartDine AI

Single-restaurant FastAPI backend with Supabase Auth/PostgreSQL, inventory accounting, financial reports, customer feedback, demand forecasts and an evidence-linked Groq assistant.

Currency: PKR. Business dates: Asia/Karachi. Public signup is disabled in the supplied local Supabase configuration; the database additionally rejects unmanaged account creation.

## Start locally

Install Python 3.12 and [uv](https://docs.astral.sh/uv/). From the project folder:

```powershell
cd backend
uv sync --frozen
# Edit .env: add SUPABASE_SECRET_KEY and GROQ_API_KEY.
uv run python scripts/validate_config.py
uv run python scripts/bootstrap_manager.py
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

In a second terminal, from `backend`:

```powershell
uv run python -m app.jobs.worker
```

Open [API documentation](http://127.0.0.1:8000/docs). Log in, copy the access token into Swagger's **Authorize** field, then use the endpoints. Manager/staff permissions are enforced by both the backend and database routines.

Docker alternative: `docker compose up --build` from the project root. The API binds only to localhost. Run one API instance until rate limiting is moved to a trusted shared ingress.

## Configuration and connected project

The local `.env` contains the connected project's actual URL and publishable key. Secret credentials remain blank until supplied. The admin secret is needed for account provisioning, public review ingestion and internal jobs; Groq is needed for AI text processing. Missing Groq credentials do not disable order or stock operations.

[Supabase project](https://supabase.com/dashboard/project/azpfnqmjamvcanacxayq) · [Setup](docs/setup.md) · [API guide](docs/api.md) · [Architecture](docs/architecture.md) · [Database](docs/database.md) · [Verification report](docs/verification.md)

## Verification

```powershell
cd backend
uv run pytest
uv run ruff check app scripts tests
uv run python scripts/validate_config.py --live
```

Database tests require an explicitly isolated PostgreSQL/Supabase test database; see the verification report for the exact tested setup. Never point destructive test fixtures at the hosted project.

The example CSV has placeholder IDs and only illustrates the format. Demo generation is local-only and labelled synthetic; replace IDs with test-project menu IDs. Six complete months of real daily history are required for real forecasts.
