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

## Receipt review QR

The paid receipt prints a high-resolution black-and-white QR code at a fixed 52 mm size. The URL inside the QR comes from `NEXT_PUBLIC_SITE_URL`, so it must be an address the guest's phone can reach.

For a temporary same-Wi-Fi test, put the computer's LAN address in `frontend/.env.local`, for example:

```env
NEXT_PUBLIC_SITE_URL=http://192.168.1.25:3000
```

Then run `npm run dev:lan` inside `frontend`. Keep the computer and phone on the same Wi-Fi network, open the LAN address once on the phone, and print a fresh receipt. Existing printed QR codes keep their old address.

For real guest use, deploy the frontend to a public HTTPS domain and set the deployment environment variable, for example `NEXT_PUBLIC_SITE_URL=https://app.yourrestaurant.com`. Restart or redeploy the frontend and print a fresh paid receipt. A QR containing `127.0.0.1` or `localhost` only works on the computer that generated it and cannot open on a guest's phone.

## Verification

```powershell
cd backend
uv run pytest
uv run ruff check app scripts tests
uv run python scripts/validate_config.py --live
```

Database tests require an explicitly isolated PostgreSQL/Supabase test database; see the verification report for the exact tested setup. Never point destructive test fixtures at the hosted project.

The example CSV has placeholder IDs and only illustrates the format. Demo generation is local-only and labelled synthetic; replace IDs with test-project menu IDs. Six complete months of real daily history are required for real forecasts.
