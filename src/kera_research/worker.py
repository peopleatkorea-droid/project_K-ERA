from __future__ import annotations

import argparse

from kera_research.services.job_runner import SiteJobWorker


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m kera_research.worker")
    parser.add_argument("--queue", action="append", dest="queues", help="Queue name to process. Repeatable.")
    parser.add_argument("--site-id", help="Restrict processing to a single site.")
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--worker-id")
    parser.add_argument("--max-jobs", type=int)
    parser.add_argument("--once", action="store_true", help="Process available jobs and exit.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    worker = SiteJobWorker(
        worker_id=args.worker_id,
        queue_names=args.queues or ["training", "validation"],
    )
    if args.once:
        worker.run_until_idle(max_jobs=args.max_jobs, site_id=args.site_id)
        return 0
    worker.run_forever(poll_interval=args.poll_interval, site_id=args.site_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
