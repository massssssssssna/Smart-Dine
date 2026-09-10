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
