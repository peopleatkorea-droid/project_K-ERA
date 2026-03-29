# Project K-ERA — Agent Instructions

## 핵심 제품 우선순위

- 이 저장소에서 최우선 제품 요구사항은 핵심 케이스 워크플로우의 **체감 속도**입니다.
- 반드시 보호할 순서:
  앱 시작 시 환자 리스트가 최대한 빨리 보여야 함;
  저장된 케이스를 열면 환자 전체 요약/타임라인이 빠르게 뜨고, 저장된 이미지가 있는 모든 방문의 썸네일이 빠짐없이 보여야 함;
  새 케이스 저장은 최대한 빨리 끝나고 다음 화면이 즉시 보여야 함;
  MedSAM / lesion masking / embedding / indexing / similar-case 준비 같은 후속 작업은 그 다음에 돌아도 되며, 앞단 UX를 막으면 안 됨.
- 벡터 인덱싱, 임베딩 리프레시, 백필, 캐시 워밍, 유사 증례 준비 같은 무거운 작업을 환자 리스트 초기 표시, 저장 케이스 오픈, 전체 방문 썸네일 로드, 새 케이스 저장 완료, 다음 화면 전환 경로에 동기적으로 묶지 마세요.
- 아키텍처 정리, 코드 정돈, 캐시 단순화가 목적이더라도 위 플로우를 느리게 만들면 잘못된 변경입니다. 그런 변경은 사용자 명시 승인 없이는 하지 마세요.
- 성능 작업은 UX를 깎아서 해결하지 말고, 비동기화, staged hydration, prefetch, 캐싱, batching, concurrency tuning으로 해결하세요.

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
- 가상환경 경로: repo-root **`.venv/`** (`uv`가 관리)
- repo-root `.venv` 안에서 수동 `pip install`로 환경을 만지지 마세요. 그런 변경은 lockfile 기준 환경 drift로 간주합니다.
- 환경이 꼬였다고 느껴지면 ad-hoc `pip` 패치 대신 `.\scripts\setup_local_node.ps1` 또는 `uv sync --frozen`으로 복구하세요.
- 이전 에이전트/개발자가 `.venv`를 수동으로 오염시켰다면 그 상태를 보존하려 하지 말고, `uv` 기준으로 다시 맞추는 것이 기본입니다.

### 환경 초기화 (fresh clone 후)

```bash
# Create the repo-root virtual environment once
uv venv .venv --python 3.11

# CPU 환경
uv sync --frozen --extra cpu --extra dev

# GPU 환경 (CUDA 12.8)
uv sync --frozen --extra gpu --extra dev
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
