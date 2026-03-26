# Project K-ERA — Agent Instructions

## Python 환경 규칙

이 프로젝트는 **uv**로 Python 환경을 관리합니다.

| 하지 말 것 | 대신 할 것 |
|---|---|
| `pip install X` | `uv add X` |
| `pip install -r requirements.txt` | `uv sync` |
| `python script.py` | `uv run python script.py` |
| `pytest` | `uv run pytest` |

- 의존성의 단일 출처(source of truth)는 **`pyproject.toml`** 입니다.
- `requirements.txt` / `requirements-cpu.txt` / `requirements-gpu-cu128.txt` 는 레거시 파일입니다. 수정하지 마세요.
- Python 버전은 **3.11** 고정 (`.python-version` 참조).
- 가상환경 경로: `.venv-uv/`

### 환경 초기화 (fresh clone 후)

```bash
# CPU 환경
uv sync --extra cpu --extra dev

# GPU 환경 (CUDA 12.8)
uv sync --extra gpu --extra dev
```

## 프로젝트 구조

- `src/kera_research/` — Python 백엔드 패키지
- `frontend/` — TypeScript/Next.js + Tauri 프론트엔드
- `tests/` — Python 테스트 (pytest)

## 프론트엔드 환경

```bash
cd frontend
npm install
npm run dev
```
