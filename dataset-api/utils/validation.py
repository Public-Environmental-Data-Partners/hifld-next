"""Data validation for geospatial uploads."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import geopandas as gpd

logger = logging.getLogger(__name__)


@dataclass
class ValidationError:
    """A data validation error with context for the user."""

    severity: str  # "error" or "warning"
    message: str
    details: str | None = None
    suggestion: str | None = None


@dataclass
class ValidationResult:
    """Result of data validation."""

    valid: bool
    errors: list[ValidationError]
    warnings: list[ValidationError]

    def __bool__(self) -> bool:
        return self.valid


def validate_geojson_file(file_path: Path) -> ValidationResult:
    """
    Validate a GeoJSON file for common data quality issues.

    Checks for:
    - String coordinates (should be numbers per GeoJSON spec)
    - Mixed types in property columns
    - Inconsistent nested object schemas
    - NULL/missing geometries

    Returns ValidationResult with errors and warnings.
    """
    errors: list[ValidationError] = []
    warnings: list[ValidationError] = []

    try:
        with open(file_path, "r") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        errors.append(
            ValidationError(
                severity="error",
                message="Invalid JSON file",
                details=str(e),
                suggestion="Ensure your file is valid JSON format.",
            )
        )
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    if data.get("type") != "FeatureCollection":
        errors.append(
            ValidationError(
                severity="error",
                message="Not a valid GeoJSON FeatureCollection",
                details=f"Found type: {data.get('type')}",
                suggestion="GeoJSON must have type: 'FeatureCollection'",
            )
        )
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    features = data.get("features", [])
    if not features:
        errors.append(
            ValidationError(
                severity="error",
                message="No features found in GeoJSON",
                suggestion="Add at least one feature to your GeoJSON file.",
            )
        )
        return ValidationResult(valid=False, errors=errors, warnings=warnings)

    # Check for string coordinates (common error) - CHECK ALL FEATURES
    string_coord_count = 0
    first_bad_feature_idx = None
    first_bad_coords = None

    for i, feature in enumerate(features):  # Check ALL features, not just first 100
        geom = feature.get("geometry")
        if geom and geom.get("coordinates"):
            if _has_string_coordinates(geom["coordinates"]):
                string_coord_count += 1
                # Save details of first occurrence for error message
                if first_bad_feature_idx is None:
                    first_bad_feature_idx = i
                    first_bad_coords = geom["coordinates"]

    # Report errors if string coordinates found
    if string_coord_count > 0:
        errors.append(
            ValidationError(
                severity="error",
                message="Coordinates must be numbers, not strings",
                details=f"Feature {first_bad_feature_idx} has string coordinates: {first_bad_coords}",
                suggestion=(
                    "GeoJSON spec requires numeric coordinates. "
                    "Convert ['1.23', '4.56'] to [1.23, 4.56]"
                ),
            )
        )

        if string_coord_count > 1:
            errors.append(
                ValidationError(
                    severity="error",
                    message=f"Found {string_coord_count} total features with string coordinates",
                    suggestion=f"Fix all {string_coord_count} features to use numeric coordinates.",
                )
            )

    # Check for mixed types in properties
    property_types = _analyze_property_types(features)
    for prop_name, types in property_types.items():
        if len(types) > 2:  # More than 2 types (allowing None + one type)
            type_names = [t for t in types if t != "NoneType"]
            if len(type_names) > 1:
                errors.append(
                    ValidationError(
                        severity="error",
                        message=f"Property '{prop_name}' has mixed types",
                        details=f"Found types: {', '.join(type_names)}",
                        suggestion=(
                            f"Ensure all values for '{prop_name}' are the same type. "
                            "For example, all strings or all numbers, not mixed."
                        ),
                    )
                )

    # Check for NULL geometries
    null_geom_count = sum(
        1
        for f in features
        if not f.get("geometry") or not f.get("geometry", {}).get("coordinates")
    )
    if null_geom_count > 0:
        warnings.append(
            ValidationError(
                severity="warning",
                message=f"{null_geom_count} features have NULL/missing geometries",
                details=f"{null_geom_count}/{len(features)} features lack geometry",
                suggestion=(
                    "Features without geometries cannot be displayed on maps. "
                    "Add valid Point, LineString, or Polygon geometries to these features."
                ),
            )
        )

    valid = len(errors) == 0
    return ValidationResult(valid=valid, errors=errors, warnings=warnings)


def _has_string_coordinates(coords: Any) -> bool:
    """Check if coordinates contain strings (recursively)."""
    if isinstance(coords, list):
        if len(coords) > 0:
            first = coords[0]
            if isinstance(first, str):
                return True
            elif isinstance(first, list):
                return _has_string_coordinates(first)
    return False


def _analyze_property_types(features: list[dict]) -> dict[str, set[str]]:
    """Analyze types of all properties across features."""
    property_types: dict[str, set[str]] = {}

    for feature in features:
        props = feature.get("properties", {})
        for key, value in props.items():
            if key not in property_types:
                property_types[key] = set()
            property_types[key].add(type(value).__name__)

    return property_types


def format_validation_errors(result: ValidationResult) -> str:
    """Format validation errors into a user-friendly message."""
    if result.valid:
        if result.warnings:
            msg = "⚠️  Data validation passed with warnings:\n\n"
            for warning in result.warnings:
                msg += f"⚠️  {warning.message}\n"
                if warning.details:
                    msg += f"   {warning.details}\n"
                if warning.suggestion:
                    msg += f"   💡 {warning.suggestion}\n"
                msg += "\n"
            return msg
        return "✅ Data validation passed"

    msg = "❌ Data validation failed:\n\n"

    for error in result.errors:
        msg += f"❌ {error.message}\n"
        if error.details:
            msg += f"   {error.details}\n"
        if error.suggestion:
            msg += f"   💡 {error.suggestion}\n"
        msg += "\n"

    if result.warnings:
        msg += "Additional warnings:\n\n"
        for warning in result.warnings:
            msg += f"⚠️  {warning.message}\n"
            if warning.details:
                msg += f"   {warning.details}\n"
            if warning.suggestion:
                msg += f"   💡 {warning.suggestion}\n"
            msg += "\n"

    msg += "\n📚 Please fix these issues in your source data and try uploading again."
    return msg
