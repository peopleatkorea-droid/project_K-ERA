from __future__ import annotations

import sys

from alembic.config import CommandLine

from kera_research.db import build_control_plane_alembic_config


def main(argv: list[str] | None = None) -> None:
    cli = CommandLine()
    options = cli.parser.parse_args(argv)
    if not hasattr(options, "cmd"):
        cli.parser.error("too few arguments")
    config = build_control_plane_alembic_config()
    config.cmd_opts = options
    cli.run_cmd(config, options)


if __name__ == "__main__":
    main(sys.argv[1:])
