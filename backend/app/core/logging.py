import logging
import re


class SecretFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        message = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9_.-]+", r"\1[REDACTED]", message)
        message = re.sub(r"\b(?:gsk_|sb_secret_)[A-Za-z0-9_-]+", "[REDACTED]", message)
        message = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED]", message)
        record.msg, record.args = message, ()
        return True


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.addFilter(SecretFilter())
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    for logger in ("httpx", "httpcore", "supabase", "gotrue", "groq"):
        logging.getLogger(logger).setLevel(logging.WARNING)
