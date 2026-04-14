from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from kera_research.services.secrets_manager import SecretsManager


class SecretsManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.manager = SecretsManager(
            control_plane_dir=root / "control_plane",
            storage_dir=root / "storage",
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_local_api_secret_round_trip_uses_secure_store(self) -> None:
        with patch.dict(
            os.environ,
            {"KERA_LOCAL_API_JWT_SECRET": "", "KERA_API_SECRET": ""},
            clear=False,
        ):
            saved = self.manager.save_local_api_secret("super-secret-value")
            loaded = self.manager.load_local_api_secret()

        self.assertEqual(saved, "super-secret-value")
        self.assertEqual(loaded, "super-secret-value")

    def test_node_credentials_round_trip(self) -> None:
        saved = self.manager.save_node_credentials(
            control_plane_base_url="https://k-era.org/control-plane/api",
            node_id="node-1",
            node_token="token-123",
            site_id="SITE_A",
        )
        loaded = self.manager.load_node_credentials()

        self.assertEqual(saved["node_id"], "node-1")
        self.assertEqual(loaded, saved)

    def test_public_key_derives_from_private_key_when_public_env_missing(self) -> None:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        with patch.dict(os.environ, {"KERA_LOCAL_API_JWT_PRIVATE_KEY_PEM": private_pem}, clear=False):
            public_pem = self.manager.load_control_plane_jwt_public_key()

        self.assertIn("BEGIN PUBLIC KEY", public_pem)


if __name__ == "__main__":
    unittest.main()
