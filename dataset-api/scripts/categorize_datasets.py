"""Script to categorize datasets using Pydantic AI based on name, description, and alias."""

import asyncio
import csv
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic import BaseModel, Field
from pydantic_ai import Agent

# Load environment variables from .env.local and .env files
# Get the dataset-api directory (parent of scripts directory)
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")  # Load defaults first
load_dotenv(BASE_DIR / ".env.local", override=True)  # Override with local settings

# Get and validate OPENAI_API_KEY
openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    raise ValueError(
        "OPENAI_API_KEY not found. Please set it in your .env.local file or as an environment variable."
    )

model = OpenAIChatModel("gpt-5-mini", provider=OpenAIProvider(api_key=openai_api_key))


# HIFLD Open categories from the screenshot
Category = Literal[
    "Agriculture",
    "Borders",
    "Boundaries",
    "Chemicals",
    "Commercial",
    "Communications",
    "Education",
    "Emergency Services",
    "Energy",
    "Finance",
    "Food Industry",
    "Geonames",
    "Government",
    "Law Enforcement",
    "Mail Shipping",
    "Mining",
    "National Flood Hazard",
    "Natural Hazards",
    "Public Health",
    "Public Venues",
    "Transportation Air",
    "Transportation Ground",
    "Transportation Water",
    "Water Supply",
]


class DatasetCategory(BaseModel):
    """Category classification for a dataset."""

    categories: list[Category] = Field(
        min_length=1,
        description="List of one or more categories this dataset belongs to",
    )
    confidence: float = Field(
        ge=0.0, le=1.0, description="Confidence score between 0 and 1"
    )
    reasoning: str = Field(description="Brief explanation for the categorization")


# Initialize the Pydantic AI agent with explicit API key
agent = Agent(
    model,
    output_type=DatasetCategory,
    system_prompt=(
        "You are categorizing datasets for HIFLD Open. "
        "Based on the dataset name, alias, and description, assign it to one or more of these categories: "
        "Agriculture, Borders, Boundaries, Chemicals, Commercial, Communications, Education, "
        "Emergency Services, Energy, Finance, Food Industry, Geonames, Government, "
        "Law Enforcement, Mail Shipping, Mining, National Flood Hazard, Natural Hazards, "
        "Public Health, Public Venues, Transportation Air, Transportation Ground, "
        "Transportation Water, or Water Supply. "
        "Some datasets may belong to multiple categories (e.g., a dataset about water boundaries "
        "might be both 'Boundaries' and 'Water Supply'). "
        "Return a list of categories, with at least one category. "
        "Provide your confidence level (0-1) and brief reasoning for the categorization. "
        "Consider the primary purpose and content of the dataset when categorizing."
    ),
)


async def categorize_dataset(
    name: str, alias: str, description: str
) -> DatasetCategory:
    """Categorize a single dataset using the LLM (async)."""
    # Truncate long descriptions to avoid token limits
    desc = description[:500] if len(description) > 500 else description

    prompt = f"""Dataset Information:
Name: {name}
Alias: {alias}
Description: {desc}

Please categorize this dataset into one or more of the HIFLD Open categories. 
Some datasets may belong to multiple categories (e.g., water boundaries might be both 'Boundaries' and 'Water Supply'). 
Return a list of relevant categories."""
    result = await agent.run(prompt)
    return result.output


def load_existing_results(output_path: Path) -> dict[str, dict]:
    """Load existing categorized results from output file for recovery."""
    existing = {}
    if output_path.exists():
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Use row number as key for tracking processed rows
                    row_num = row.get("row", "")
                    if row_num:
                        existing[row_num] = row
            print(f"📋 Loaded {len(existing)} existing results from {output_path}")
        except Exception as e:
            print(f"⚠️  Warning: Could not load existing results: {e}")
    return existing


def write_results(output_path: Path, results: list[dict], append: bool = False):
    """Write results to CSV file."""
    if not results:
        return

    fieldnames = list(results[0].keys())
    file_mode = "a" if append else "w"

    # Check if file exists and has content
    file_exists = output_path.exists() and output_path.stat().st_size > 0

    with open(output_path, file_mode, encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        # Only write header if this is a new file or we're overwriting
        if not append or not file_exists:
            writer.writeheader()
        writer.writerows(results)


async def process_inventory_csv(
    input_path: Path,
    output_path: Path | None = None,
    offset: int = 0,
    limit: int | None = None,
    save_interval: int = 1,
    concurrency: int = 10,
) -> list[dict]:
    """Process the inventory CSV and add categories (async with concurrency).

    Args:
        input_path: Path to input CSV file
        output_path: Path to output CSV file (default: <input>_categorized.csv)
        offset: Number of rows to skip from the beginning
        limit: Maximum number of rows to process (None = all remaining)
        save_interval: Write to CSV after every N successful categorizations
        concurrency: Number of concurrent API requests (default: 10)
    """
    input_path = Path(input_path)

    if output_path is None:
        output_path = input_path.parent / f"{input_path.stem}_categorized.csv"
    else:
        output_path = Path(output_path)

    # Load existing results for recovery
    existing_results = load_existing_results(output_path)

    # Determine if we should append or overwrite
    # If output file exists and has results, we'll append new results
    append_mode = output_path.exists() and len(existing_results) > 0

    all_results = []
    processed_count = 0
    skipped_count = 0
    fieldnames: list[str] | None = None

    with open(input_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        all_rows = list(reader)

        # Determine fieldnames from first row
        if all_rows:
            fieldnames = list(all_rows[0].keys())
            # Ensure output fieldnames include category fields
            for field in ["category", "category_confidence", "category_reasoning"]:
                if field not in fieldnames:
                    fieldnames.append(field)

        # Apply offset and limit
        rows_to_process = all_rows[offset : offset + limit if limit else None]

        print(
            f"📊 Processing rows {offset + 1} to {offset + len(rows_to_process)} (total: {len(rows_to_process)} rows)"
        )
        print(f"💾 Saving progress every {save_interval} row(s)")
        print(f"⚡ Concurrency: {concurrency} concurrent requests\n")

        # Filter out already processed rows
        rows_to_categorize = []
        for idx, row in enumerate(rows_to_process, start=offset + 1):
            row_num = row.get("row", str(idx))
            name = row.get("name", "")

            # Check if already processed
            if row_num in existing_results:
                skipped_count += 1
                all_results.append(existing_results[row_num])
                print(f"Skipping {idx}: {name} (already processed)")
            else:
                rows_to_categorize.append((idx, row))

        # Process rows with concurrency control
        semaphore = asyncio.Semaphore(concurrency)
        batch_results = []

        async def process_row(
            idx: int, row: dict
        ) -> tuple[int, dict | None, Exception | None]:
            """Process a single row with semaphore control."""
            name = row.get("name", "")

            async with semaphore:
                try:
                    print(f"Processing {idx}: {name}...")
                    alias = row.get("alias", "")
                    description = row.get("description", "")
                    category_result = await categorize_dataset(name, alias, description)

                    # Add category information to the row
                    # Store categories as comma-separated string for CSV compatibility
                    # The import script will parse this into an array
                    row["category"] = ",".join(category_result.categories)
                    row["category_confidence"] = str(category_result.confidence)
                    row["category_reasoning"] = category_result.reasoning

                    categories_str = ", ".join(category_result.categories)
                    print(
                        f"  ✓ {idx}: {name} -> {categories_str} (confidence: {category_result.confidence:.2f})"
                    )
                    return (idx, row, None)
                except Exception as e:
                    print(f"  ✗ ERROR {idx}: {name} - {e}")
                    # Add error info to row - default to single category for errors
                    row["category"] = "Government"
                    row["category_confidence"] = "0.0"
                    row["category_reasoning"] = f"Error during categorization: {str(e)}"
                    return (idx, row, e)

        # Process rows and save incrementally as they complete
        tasks = {
            asyncio.create_task(process_row(idx, row)): idx
            for idx, row in rows_to_categorize
        }

        # Process results as they complete (not waiting for all to finish)
        for task in asyncio.as_completed(tasks.keys()):
            idx, row, error = await task

            if row is not None:
                # Ensure all rows have the same fields
                for field in fieldnames or []:
                    if field not in row:
                        row[field] = ""

                batch_results.append(row)
                all_results.append(row)
                processed_count += 1

                # Periodically write to CSV
                if processed_count % save_interval == 0:
                    if batch_results and fieldnames:
                        write_results(output_path, batch_results, append=append_mode)
                        append_mode = True  # Switch to append mode after first write
                        print(f"  💾 Progress saved ({processed_count} processed)")
                        batch_results = []

        # Write any remaining results
        if batch_results and fieldnames:
            for r in batch_results:
                for field in fieldnames:
                    if field not in r:
                        r[field] = ""
            write_results(output_path, batch_results, append=append_mode)

        print(f"\n✅ Results written to: {output_path}")
        print(
            f"   Processed: {processed_count}, Skipped: {skipped_count}, Total: {len(all_results)}"
        )

    return all_results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Categorize datasets in inventory CSV using Pydantic AI"
    )
    parser.add_argument(
        "--input",
        type=str,
        default="inventory.csv",
        help="Input CSV file path (default: inventory.csv)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output CSV file path (default: <input>_categorized.csv)",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Number of rows to skip from the beginning (default: 0)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of rows to process (default: all remaining)",
    )
    parser.add_argument(
        "--save-interval",
        type=int,
        default=1,
        help="Save progress to CSV after every N successful categorizations (default: 1)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Number of concurrent API requests (default: 10)",
    )

    args = parser.parse_args()

    script_dir = Path(__file__).parent
    input_path = script_dir / args.input
    output_path = Path(args.output) if args.output else None

    if not input_path.exists():
        print(f"❌ Error: Input file not found: {input_path}")
        exit(1)

    output_file = (
        output_path or input_path.parent / f"{input_path.stem}_categorized.csv"
    )

    print(f"📂 Processing: {input_path}")
    print(f"💾 Output will be saved to: {output_file}")
    if args.offset > 0:
        print(f"📍 Starting at row: {args.offset + 1}")
    if args.limit:
        print(f"🔢 Processing up to {args.limit} rows")
    print(f"⚡ Concurrency: {args.concurrency} concurrent requests")
    print()

    results = asyncio.run(
        process_inventory_csv(
            input_path,
            output_file,
            offset=args.offset,
            limit=args.limit,
            save_interval=args.save_interval,
            concurrency=args.concurrency,
        )
    )

    # Print summary statistics
    categories = {}
    for row in results:
        # Handle both single category and comma-separated categories
        cat_str = row.get("category", "Unknown")
        if cat_str:
            # Split comma-separated categories and count each
            for cat in [c.strip() for c in cat_str.split(",") if c.strip()]:
                categories[cat] = categories.get(cat, 0) + 1

    print("\n📊 Category Summary:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")
