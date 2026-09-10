"""Generate labelled synthetic CSV locally. Never connects to any database."""
import argparse
import csv
from datetime import date, timedelta
from pathlib import Path
import random
from uuid import UUID


def generate(output: Path, menu_ids: list[str], start: date, days: int):
    rng = random.Random(42)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["day", "menu_item_id", "quantity", "day_status"])
        writer.writeheader()
        for offset in range(days):
            day = start + timedelta(days=offset)
            for index, item in enumerate(menu_ids):
                quantity = max(0, round(12 + index * 4 + (5 if day.weekday() >= 5 else 0) + rng.gauss(0, 3)))
                writer.writerow({"day": day.isoformat(), "menu_item_id": item,
                                 "quantity": quantity, "day_status": "complete"})
    output.with_suffix(".README.txt").write_text(
        "SYNTHETIC DEMO DATA. Not actual restaurant sales. Import only into an isolated demo/test project.\n",
        encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("demo-output/synthetic_sales.csv"))
    parser.add_argument("--menu-item-id", type=UUID, action="append", required=True)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2026, 1, 1))
    parser.add_argument("--days", type=int, default=243)
    args = parser.parse_args()
    if not 180 <= args.days <= 730:
        parser.error("--days must be between 180 and 730")
    generate(args.output, [str(item) for item in args.menu_item_id], args.start, args.days)
    print(f"Synthetic CSV written to {args.output.resolve()}; no database was changed.")
