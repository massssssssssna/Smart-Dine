import csv
import io
from datetime import date
from uuid import UUID

from app.core.exceptions import AppError


def parse_history(csv_text: str) -> list[dict]:
    """Explicit per-item/day observations make zero sales distinct from absent data."""
    reader = csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff")))
    if set(reader.fieldnames or []) != {"day", "menu_item_id", "quantity", "day_status"}:
        raise AppError("invalid_csv", "CSV headers must be day,menu_item_id,quantity,day_status", 422)
    entries = {}
    try:
        for row in reader:
            if len(entries) >= 10000:
                raise ValueError("CSV exceeds 10000 observations")
            day = date.fromisoformat(row["day"])
            item_id = str(UUID(row["menu_item_id"]))
            quantity = int(row["quantity"])
            status = row["day_status"]
            if quantity < 0 or quantity > 1_000_000 or status not in ("complete", "closed"):
                raise ValueError("Invalid quantity or day_status")
            if status == "closed" and quantity != 0:
                raise ValueError("Closed days must have zero quantity")
            entry = {"day": day.isoformat(), "menu_item_id": item_id, "quantity": quantity, "day_status": status}
            key = (day, item_id)
            if key in entries and entries[key] != entry:
                raise ValueError("Conflicting duplicate item/day")
            entries[key] = entry
    except (ValueError, KeyError, TypeError) as exc:
        raise AppError("invalid_csv", str(exc), 422) from exc
    if not entries:
        raise AppError("invalid_csv", "CSV contains no observations", 422)
    return list(entries.values())


async def import_history(gateway, body, key: str):
    return await gateway.command("history_import", {"source_name": body.source_name, "rows": parse_history(body.csv_text)}, key)
