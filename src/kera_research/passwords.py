from __future__ import annotations

import base64
import hashlib
import hmac
import os

import bcrypt

PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = max(1, int(os.getenv("KERA_PASSWORD_PBKDF2_ITERATIONS", "").strip() or "210000"))
PASSWORD_KEY_LENGTH = 32
_BCRYPT_MAX_PASSWORD_BYTES = 72


def _pbkdf2_digest(password: str, salt: str, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)


def _pbkdf2_salt() -> str:
    return base64.urlsafe_b64encode(os.urandom(16)).decode("ascii").rstrip("=")


def hash_password(password: str) -> str:
    normalized = str(password or "")
    if not normalized:
        raise ValueError("Password is required.")
    encoded = normalized.encode("utf-8")
    if len(encoded) <= _BCRYPT_MAX_PASSWORD_BYTES:
        return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")
    salt = _pbkdf2_salt()
    digest = _pbkdf2_digest(normalized, salt, PASSWORD_ITERATIONS)
    return f"{PASSWORD_SCHEME}${PASSWORD_ITERATIONS}${salt}${base64.b64encode(digest).decode('ascii')}"


def is_bcrypt_hash(value: str) -> bool:
    return str(value or "").startswith(("$2b$", "$2a$", "$2y$"))


def is_pbkdf2_sha256_hash(value: str) -> bool:
    return str(value or "").startswith(f"{PASSWORD_SCHEME}$")


def verify_bcrypt_password(password: str, encoded: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), encoded.encode("utf-8"))
    except ValueError:
        return False


def verify_pbkdf2_sha256_hash(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt, expected_hash = str(encoded or "").split("$", 3)
    except ValueError:
        return False
    if algorithm != PASSWORD_SCHEME:
        return False
    try:
        iterations = int(iteration_text)
    except (TypeError, ValueError):
        return False
    candidate = _pbkdf2_digest(password, salt, iterations)
    try:
        expected = base64.b64decode(expected_hash)
    except Exception:
        return False
    return hmac.compare_digest(candidate, expected)
