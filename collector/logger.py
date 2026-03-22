import logging
import sys
import os
from datetime import datetime
from typing import Optional
import json


class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if hasattr(record, "extra"):
            log_entry.update(record.extra)

        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


class TextFormatter(logging.Formatter):
    def format(self, record):
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        base = f"[{timestamp}] [{record.levelname:7}] [{record.name}] {record.getMessage()}"

        if hasattr(record, "extra"):
            extra_str = " ".join(f"{k}={v}" for k, v in record.extra.items())
            base = f"{base} | {extra_str}"

        return base


def setup_logging(
    level: str = "INFO",
    format_type: str = "text",
    log_file: Optional[str] = None,
) -> logging.Logger:
    logger = logging.getLogger("collector")
    logger.setLevel(getattr(logging, level.upper()))

    logger.handlers = []

    handler = logging.StreamHandler(sys.stdout)
    if format_type == "json":
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(TextFormatter())
    logger.addHandler(handler)

    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(JSONFormatter())
        logger.addHandler(file_handler)

    return logger


class LoggerAdapter:
    def __init__(self, logger: logging.Logger):
        self.logger = logger

    def _log(self, level: int, message: str, **kwargs):
        extra = {"extra": kwargs} if kwargs else {}
        self.logger.log(level, message, **extra)

    def debug(self, message: str, **kwargs):
        self._log(logging.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs):
        self._log(logging.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs):
        self._log(logging.WARNING, message, **kwargs)

    def error(self, message: str, **kwargs):
        self._log(logging.ERROR, message, **kwargs)

    def exception(self, message: str, **kwargs):
        extra = {"extra": kwargs} if kwargs else {}
        self.logger.exception(message, **extra)


log: Optional[LoggerAdapter] = None


def get_logger() -> LoggerAdapter:
    global log
    if log is None:
        log = LoggerAdapter(setup_logging())
    return log
