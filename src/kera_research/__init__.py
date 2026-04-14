"""K-ERA research workflow platform."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

__all__ = ["__version__"]

try:
    __version__ = version("kera-research")
except PackageNotFoundError:
    __version__ = "1.0.0"
