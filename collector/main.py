import os
import asyncio
import argparse
from dotenv import load_dotenv

from config import Config, ConfigLoader
from scheduler import NewsScheduler
from logger import setup_logging, get_logger

load_dotenv()


def create_config(config_path: str = None) -> Config:
    config = ConfigLoader.from_env()

    if config_path and os.path.exists(config_path):
        config = ConfigLoader.merge_sources(config, config_path)

    if not config.sources:
        config.sources = ConfigLoader.get_default_sources()

    return config


async def run_once(config_path: str = None):
    config = create_config(config_path or "sources.json")

    setup_logging(
        level=config.logging.level,
        format_type=config.logging.format_type,
        log_file=config.logging.log_file,
    )

    log = get_logger()
    log.info("Running single collection")

    scheduler = NewsScheduler(config)
    await scheduler.collect_once()

    metrics = scheduler.get_metrics()
    log.info("Metrics", **metrics)


async def run_daemon(config_path: str = None):
    config = create_config(config_path or "sources.json")

    scheduler = NewsScheduler(config)
    await scheduler.start()


def main():
    parser = argparse.ArgumentParser(
        description="Market News Collector Service",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py                      # Single collection
  python main.py --daemon             # Run as daemon
  python main.py --config my.json     # Use custom config
  python main.py --interval 60        # Custom interval (minutes)
        """,
    )

    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run as daemon with scheduled collection",
    )
    parser.add_argument(
        "--config",
        type=str,
        default="sources.json",
        help="Path to config file (default: sources.json)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=None,
        help="Collection interval in minutes (overrides config)",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default=None,
        help="Log level (overrides config)",
    )
    parser.add_argument(
        "--log-format",
        type=str,
        choices=["text", "json"],
        default=None,
        help="Log format (overrides config)",
    )

    args = parser.parse_args()

    if args.interval:
        os.environ["COLLECT_INTERVAL_MINUTES"] = str(args.interval)

    if args.log_level:
        os.environ["LOG_LEVEL"] = args.log_level

    if args.log_format:
        os.environ["LOG_FORMAT"] = args.log_format

    if args.daemon:
        asyncio.run(run_daemon(args.config))
    else:
        asyncio.run(run_once(args.config))


if __name__ == "__main__":
    main()
