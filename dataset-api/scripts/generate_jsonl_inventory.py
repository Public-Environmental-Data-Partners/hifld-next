#!/usr/bin/env python3
"""
Convert HIFLD Open Inventory CSV to inventory JSONL format.

This script:
1. Reads the HIFLD Open Inventory CSV
2. Uses LLM to categorize each dataset
3. Converts to inventory JSONL format (metadata only, no storage URLs)

The inventory JSONL contains dataset metadata with AI-generated tags.
Storage URLs are added later when generating the final datasets.jsonl.

Usage:
    python -m scripts.generate_jsonl_inventory \
        --input HIFLD_Open_Inventory_12112025.csv \
        --output inventory.jsonl \
        --limit 10
"""

import argparse
import asyncio
import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, Literal, Optional

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

# Load environment variables
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR / ".env.local", override=True)

# Get and validate OPENAI_API_KEY
openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    raise ValueError(
        "OPENAI_API_KEY not found. Please set it in your .env.local file or as an environment variable."
    )

model = OpenAIChatModel("gpt-4o-mini", provider=OpenAIProvider(api_key=openai_api_key))

# HIFLD Open categories
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


# Initialize the Pydantic AI agent
agent = Agent(
    model,
    output_type=DatasetCategory,
    system_prompt=(
        "You are categorizing datasets for HIFLD Open. "
        "Based on the dataset name, title, and description, assign it to one or more of these categories: "
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


def clean_description(description: str) -> str:
    """Clean HTML and special characters from description."""
    if not description:
        return ""

    # Remove HTML tags
    description = re.sub(r"<[^>]+>", "", description)

    # Decode HTML entities
    import html

    description = html.unescape(description)

    # Clean up whitespace
    description = " ".join(description.split())

    return description.strip()


async def categorize_dataset(
    filename: str, title: str, description: str
) -> DatasetCategory:
    """Categorize a single dataset using the LLM (async)."""
    # Truncate long descriptions to avoid token limits
    desc = description[:500] if len(description) > 500 else description

    prompt = f"""Dataset Information:
Filename: {filename}
Title: {title}
Description: {desc}

Please categorize this dataset into one or more of the HIFLD Open categories. 
Some datasets may belong to multiple categories (e.g., water boundaries might be both 'Boundaries' and 'Water Supply'). 
Return a list of relevant categories."""
    result = await agent.run(prompt)
    return result.output


def convert_row_to_jsonl(
    row: Dict[str, str],
    category_result: Optional[DatasetCategory] = None,
) -> Dict:
    """Convert a CSV row to inventory JSONL format (metadata only, no storage URLs)."""
    filename = row.get("filename", "").strip()
    title = row.get("title", "").strip() or filename
    description = clean_description(row.get("description", "").strip())

    # Extract basic dataset info
    # For inventory JSONL, we don't include storage URLs - those are added later
    dataset_config = {
        # Dataset identification
        "slug": filename,  # Use filename as slug
        "name": title,  # Use title as human-readable name
        "description": description,
        "source_file_path": None,  # Original source file path (if known)
        # Metadata
        "tags": {
            "inventory_name": filename,
        },
    }

    # Add categories from LLM if available
    if category_result:
        dataset_config["tags"]["categories"] = category_result.categories
        dataset_config["tags"]["category_confidence"] = str(category_result.confidence)
        dataset_config["tags"]["category_reasoning"] = category_result.reasoning

    # Try to extract geometry type from keywords if available
    keywords = row.get("keywords", "")
    if keywords:
        # Keywords might contain geometry type info
        keywords_lower = keywords.lower()
        if "point" in keywords_lower:
            dataset_config["tags"]["geometry_type"] = "Point"
        elif "polygon" in keywords_lower:
            dataset_config["tags"]["geometry_type"] = "Polygon"
        elif "linestring" in keywords_lower or "line" in keywords_lower:
            dataset_config["tags"]["geometry_type"] = "LineString"

    # File configuration (for multi-layer support)
    # For inventory JSONL, we only include structure, not storage URLs
    file_config = {
        "name": filename,  # Base filename
        "slug": filename,  # Same as filename for single-file datasets
        "layer_name": None,  # None for single-layer files, or layer name for multi-layer
        "source_file_path": None,  # Original source file path (if known)
    }

    dataset_config["files"] = [file_config]

    # Remove None values from tags
    dataset_config["tags"] = {
        k: v for k, v in dataset_config["tags"].items() if v is not None
    }

    return dataset_config


async def convert_csv_to_jsonl(
    input_path: Path,
    output_path: Path,
    offset: int = 0,
    limit: Optional[int] = None,
    concurrency: int = 10,
    save_interval: int = 10,
):
    """Convert CSV inventory to inventory JSONL format with LLM categorization (async with concurrency).

    Args:
        input_path: Path to input CSV file
        output_path: Path to output JSONL file
        offset: Number of rows to skip from the beginning
        limit: Maximum number of rows to process (None = all remaining)
        concurrency: Number of concurrent API requests
        save_interval: Write to JSONL after every N successful categorizations
    """
    rows = []

    # Read all rows first
    with open(input_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            filename = row.get("filename", "").strip()
            if filename:  # Only process rows with filenames
                rows.append(row)

    # Apply offset and limit
    rows_to_process = rows[offset : offset + limit if limit else None]

    print(
        f"📊 Processing rows {offset + 1} to {offset + len(rows_to_process)} (total: {len(rows_to_process)} rows)"
    )
    print(f"💾 Saving progress every {save_interval} row(s)")
    print(f"⚡ Concurrency: {concurrency} concurrent requests\n")

    # Open output file for writing (we'll append as results complete)
    output_file = open(output_path, "w", encoding="utf-8")
    processed_count = 0
    error_count = 0
    batch_results = []

    # Semaphore to control concurrency
    semaphore = asyncio.Semaphore(concurrency)

    async def process_row(row: Dict[str, str], index: int) -> Optional[Dict]:
        """Process a single row with semaphore control."""
        filename = row.get("filename", "").strip()
        title = row.get("title", "").strip() or filename
        description = clean_description(row.get("description", ""))

        async with semaphore:
            try:
                print(f"[{index}/{len(rows_to_process)}] Processing: {filename}")

                # Categorize with LLM
                category_result = await categorize_dataset(filename, title, description)
                categories_str = ", ".join(category_result.categories)
                print(
                    f"  ✓ [{index}/{len(rows_to_process)}] {filename} -> {categories_str} (confidence: {category_result.confidence:.2f})"
                )

                # Convert to JSONL format (metadata only, no storage URLs)
                dataset_config = convert_row_to_jsonl(row, category_result)
                return dataset_config

            except Exception as e:
                print(f"  ✗ ERROR [{index}/{len(rows_to_process)}] {filename}: {e}")
                # Continue with default category
                dataset_config = convert_row_to_jsonl(row, None)
                dataset_config["tags"]["categories"] = ["Government"]  # Default
                dataset_config["tags"]["category_confidence"] = "0.0"
                dataset_config["tags"][
                    "category_reasoning"
                ] = f"Error during categorization: {str(e)}"
                return dataset_config

    # Create tasks for all rows
    tasks = {
        asyncio.create_task(process_row(row, i + 1)): i
        for i, row in enumerate(rows_to_process)
    }

    # Process results as they complete and write in batches
    for task in asyncio.as_completed(tasks.keys()):
        dataset_config = await task
        if dataset_config:
            batch_results.append(dataset_config)
            processed_count += 1
            if "Error" in dataset_config.get("tags", {}).get("category_reasoning", ""):
                error_count += 1

            # Write batch when we reach save_interval
            if processed_count % save_interval == 0:
                for result in batch_results:
                    output_file.write(json.dumps(result, ensure_ascii=False) + "\n")
                output_file.flush()  # Ensure it's written to disk
                print(f"  💾 Progress saved ({processed_count} processed)")
                batch_results = []

    # Write any remaining results
    if batch_results:
        for result in batch_results:
            output_file.write(json.dumps(result, ensure_ascii=False) + "\n")
        output_file.flush()

    output_file.close()

    print(
        f"\n✓ Converted {processed_count} datasets from {input_path} to {output_path}"
    )
    if error_count > 0:
        print(f"  ⚠ {error_count} datasets had categorization errors")


async def main():
    parser = argparse.ArgumentParser(
        description="Convert HIFLD Open Inventory CSV to JSONL format with LLM categorization"
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).parent / "HIFLD_Open_Inventory_12112025.csv",
        help="Input CSV file path",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "inventory.jsonl",
        help="Output inventory JSONL file path",
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
        "--concurrency",
        type=int,
        default=10,
        help="Number of concurrent API requests (default: 10)",
    )
    parser.add_argument(
        "--save-interval",
        type=int,
        default=10,
        help="Save progress to JSONL after every N successful categorizations (default: 10)",
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: Input file not found: {args.input}")
        sys.exit(1)

    await convert_csv_to_jsonl(
        args.input,
        args.output,
        offset=args.offset,
        limit=args.limit,
        concurrency=args.concurrency,
        save_interval=args.save_interval,
    )


if __name__ == "__main__":
    asyncio.run(main())
