from __future__ import annotations

SUPPORTED_LANGUAGES = {
    "ko": "한국어",
    "en": "English",
}


def t(lang: str, ko: str, en: str) -> str:
    return ko if lang == "ko" else en
