# AI Clinic LLM Setup

AI Clinic workflow recommendation reads its API key from the server process environment.

## Supported variables

- `KERA_AI_CLINIC_OPENAI_API_KEY`
- `OPENAI_API_KEY`
- `KERA_AI_CLINIC_LLM_MODEL`
- `KERA_AI_CLINIC_LLM_BASE_URL`
- `KERA_AI_CLINIC_LLM_TIMEOUT_SECONDS`

`KERA_AI_CLINIC_OPENAI_API_KEY` is preferred for this app because it is scoped to AI Clinic.

## Recommended local setup

1. Copy `.env.example` to `.env.local`.
2. Set `KERA_AI_CLINIC_OPENAI_API_KEY=...`.
3. Start the API with `.\scripts\run_api_server.ps1`.

Both `scripts/run_api_server.ps1` and `scripts/run_web_frontend.ps1` load the root `.env.local`.

## Exposure risk

- Do not store the key in frontend code.
- Do not use a `NEXT_PUBLIC_` prefix for the key.
- Do not commit `.env.local`.
- Prefer OS-level environment variables over `.env.local` on shared or production machines.
- Rotate the key periodically and keep it separate from any browser-exposed settings.
