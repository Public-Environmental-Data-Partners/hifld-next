"""Functions for creating PMTiles from geospatial data."""

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def create_pmtiles(input_path: Path, output_path: Path, max_zoom: int = 14) -> bool:
    """
    Create PMTiles from a GeoDataFrame saved as FlatGeobuf.

    Uses tippecanoe if available, otherwise skips PMTiles creation.
    """
    try:
        result = subprocess.run(
            [
                "tippecanoe",
                "-o",
                str(output_path),
                "-zg",  # Auto-detect zoom levels
                f"--maximum-zoom={max_zoom}",
                "--drop-densest-as-needed",
                "--extend-zooms-if-still-dropping",
                "--force",
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode == 0:
            logger.info(f"Created PMTiles: {output_path}")
            return True
        else:
            logger.warning(f"tippecanoe failed: {result.stderr}")
            return False

    except FileNotFoundError:
        logger.warning("tippecanoe not found, skipping PMTiles creation")
        return False
    except Exception as e:
        logger.warning(f"PMTiles creation failed: {e}")
        return False






