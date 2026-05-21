"""Response shaping helpers for dataset file/source payloads."""

import logging
from dataclasses import dataclass

from sqlmodel import Session, col, select

from models.dataset import (
    Dataset,
    File,
    FileFormat,
    FileLocation,
    FileSource,
    Format,
    SpatialDatasetFileMetadata,
    StorageLocation,
)
from models.helpers import (
    construct_glob_pattern_from_sources,
    expand_glob_pattern_in_source,
    get_file_source_storage_uri,
    get_file_source_url,
)
from schemas.types import APIDict, APIList, APIValue, api_dict, json_dict, model_json_dict


logger = logging.getLogger(__name__)

GLOB_FORMAT_TYPES = {"geoparquet", "pmtiles"}
EXPANDED_PATH_LOG_LIMIT = 5


@dataclass(frozen=True)
class SourceContext:
    """Bulk-loaded source lookup data for response shaping."""

    file_formats_by_file_id: dict[int, list[tuple[FileFormat, Format]]]
    sources_by_file_format_id: dict[int, list[FileSource]]
    storage_locations_by_id: dict[int, StorageLocation]


def dataset_with_urls(db: Session, dataset: Dataset) -> APIDict:
    """Build the dataset detail response with file, format, and source URLs."""
    files = _load_files(db, dataset.id)
    context = _load_source_context(db, files)
    _log_dataset_context(dataset.id, context)
    dataset_dict: APIDict = model_json_dict(dataset)
    dataset_dict["files"] = [_file_summary_with_sources(file_obj, context) for file_obj in files]
    return dataset_dict


async def file_with_urls(db: Session, dataset: Dataset, file_obj: File) -> APIDict:
    """Build the file detail response with expanded source URLs."""
    context = _load_source_context(db, [file_obj])
    _log_file_context(file_obj, context)
    file_dict = await _file_detail_with_sources(file_obj, context)
    return {"dataset": model_json_dict(dataset), "file": file_dict}


def _load_files(db: Session, dataset_id: int) -> list[File]:
    files_statement = select(File).where(File.dataset_id == dataset_id)
    return list(db.exec(files_statement).all())


def _load_source_context(db: Session, files: list[File]) -> SourceContext:
    file_ids = [file_obj.id for file_obj in files]
    file_formats = _load_file_formats(db, file_ids)
    file_format_ids = [file_format.id for file_format, _ in file_formats]
    file_sources = _load_file_sources(db, file_format_ids)
    storage_locations = _load_storage_locations(db, file_sources)
    return SourceContext(
        file_formats_by_file_id=_group_file_formats(file_formats),
        sources_by_file_format_id=_group_sources(file_sources),
        storage_locations_by_id=storage_locations,
    )


def _load_file_formats(db: Session, file_ids: list[int]) -> list[tuple[FileFormat, Format]]:
    if not file_ids:
        return []
    statement = (
        select(FileFormat, Format)
        .join(Format, col(FileFormat.format_id) == col(Format.id))
        .where(col(FileFormat.file_id).in_(file_ids))
    )
    return list(db.exec(statement).all())


def _load_file_sources(db: Session, file_format_ids: list[int]) -> list[FileSource]:
    if not file_format_ids:
        return []
    statement = select(FileSource).where(col(FileSource.file_format_id).in_(file_format_ids))
    return list(db.exec(statement).all())


def _load_storage_locations(db: Session, file_sources: list[FileSource]) -> dict[int, StorageLocation]:
    storage_location_ids = {source.storage_location_id for source in file_sources}
    if not storage_location_ids:
        return {}
    statement = select(StorageLocation).where(col(StorageLocation.id).in_(storage_location_ids))
    storage_locations = list(db.exec(statement).all())
    return {storage_location.id: storage_location for storage_location in storage_locations}


def _group_file_formats(file_formats: list[tuple[FileFormat, Format]]) -> dict[int, list[tuple[FileFormat, Format]]]:
    grouped: dict[int, list[tuple[FileFormat, Format]]] = {}
    for file_format, format_obj in file_formats:
        grouped.setdefault(file_format.file_id, []).append((file_format, format_obj))
    return grouped


def _group_sources(file_sources: list[FileSource]) -> dict[int, list[FileSource]]:
    grouped: dict[int, list[FileSource]] = {}
    for source in file_sources:
        grouped.setdefault(source.file_format_id, []).append(source)
    return grouped


def _file_summary_with_sources(file_obj: File, context: SourceContext) -> APIDict:
    file_dict: APIDict = model_json_dict(file_obj)
    file_dict["formats"] = []
    for file_format, format_obj in context.file_formats_by_file_id.get(file_obj.id, []):
        try:
            file_dict["formats"].append(_plain_format_response(file_format, format_obj, context))
        except Exception as exc:
            logger.warning("Error processing format for file %s: %s", file_obj.id, exc)
    return file_dict


async def _file_detail_with_sources(file_obj: File, context: SourceContext) -> APIDict:
    file_dict: APIDict = model_json_dict(file_obj)
    file_dict["formats"] = []
    for file_format, format_obj in context.file_formats_by_file_id.get(file_obj.id, []):
        try:
            file_dict["formats"].append(await _detail_format_response(file_obj, file_format, format_obj, context))
        except Exception as exc:
            logger.warning("Error processing format for file %s: %s", file_obj.id, exc)
    return file_dict


def _plain_format_response(
    file_format: FileFormat,
    format_obj: Format,
    context: SourceContext,
) -> APIDict:
    sources = context.sources_by_file_format_id.get(file_format.id, [])
    return {
        "format": model_json_dict(format_obj),
        "file_format": model_json_dict(file_format),
        "sources": [_safe_source_response(source, context.storage_locations_by_id) for source in sources],
    }


async def _detail_format_response(
    file_obj: File,
    file_format: FileFormat,
    format_obj: Format,
    context: SourceContext,
) -> APIDict:
    format_sources = context.sources_by_file_format_id.get(file_format.id, [])
    logger.info(
        "Format debug: file_format_id=%s format_type=%s source_count=%s",
        file_format.id,
        format_obj.format_type,
        len(format_sources),
    )
    if format_obj.format_type not in GLOB_FORMAT_TYPES:
        return _plain_format_response(file_format, format_obj, context)

    sources = await _glob_format_sources(file_obj, format_sources, context.storage_locations_by_id)
    return {
        "format": model_json_dict(format_obj),
        "file_format": model_json_dict(file_format),
        "sources": sources,
    }


async def _glob_format_sources(
    file_obj: File,
    format_sources: list[FileSource],
    storage_locations_by_id: dict[int, StorageLocation],
) -> APIList:
    source_responses: APIList = []
    file_sources = [source for source in format_sources if source.source_type == "file"]
    for group_key, grouped_sources in _sources_by_location_version(file_sources).items():
        source_responses.extend(
            await _glob_group_sources(file_obj, group_key, grouped_sources, storage_locations_by_id)
        )
    source_responses.extend(
        _safe_source_response(source, storage_locations_by_id)
        for source in format_sources
        if source.source_type != "file"
    )
    return source_responses


def _sources_by_location_version(file_sources: list[FileSource]) -> dict[tuple[int, str], list[FileSource]]:
    grouped: dict[tuple[int, str], list[FileSource]] = {}
    for source in file_sources:
        version = str(source.version) if source.version else "1"
        grouped.setdefault((source.storage_location_id, version), []).append(source)
    return grouped


async def _glob_group_sources(
    file_obj: File,
    group_key: tuple[int, str],
    grouped_sources: list[FileSource],
    storage_locations_by_id: dict[int, StorageLocation],
) -> APIList:
    location_id, version = group_key
    source_storage = storage_locations_by_id.get(location_id)
    if not source_storage:
        logger.error(
            "Storage location %s not found in storage_locations_by_id. Available IDs: %s",
            location_id,
            list(storage_locations_by_id.keys()),
        )
    glob_pattern = _glob_pattern_for_group(grouped_sources, source_storage, location_id, version)
    source_items = await _expanded_group_source_items(grouped_sources, source_storage, location_id)
    return [
        _safe_group_source_response(file_obj, source_item, source_storage, storage_locations_by_id, glob_pattern)
        for source_item in source_items
    ]


def _glob_pattern_for_group(
    grouped_sources: list[FileSource],
    source_storage: StorageLocation | None,
    location_id: int,
    version: str,
) -> str | None:
    if not source_storage:
        return None
    wildcard_source = next((source for source in grouped_sources if "*" in _source_path(source)), None)
    if wildcard_source:
        glob_pattern = get_file_source_storage_uri(wildcard_source, source_storage)
        logger.info(
            "Constructed glob pattern: location_id=%s version=%s pattern=%s", location_id, version, glob_pattern
        )
        return glob_pattern
    if len(grouped_sources) > 1:
        return construct_glob_pattern_from_sources(grouped_sources, source_storage)
    return None


async def _expanded_group_source_items(
    grouped_sources: list[FileSource],
    source_storage: StorageLocation | None,
    location_id: int,
) -> list[FileSource | APIDict]:
    source_items: list[FileSource | APIDict] = []
    for source in grouped_sources:
        file_path = _source_path(source)
        if source.source_type != "file" or "*" not in file_path:
            source_items.append(source)
            continue
        logger.info(
            "Expanding glob pattern: source_id=%s path=%s storage_location_id=%s storage_name=%s",
            source.id,
            file_path,
            location_id,
            (source_storage.name if source_storage else "unknown"),
        )
        expanded = await _expand_source(source, source_storage)
        source_items.append(source)
        if expanded:
            source_items.extend(expanded)
    return source_items


async def _expand_source(source: FileSource, source_storage: StorageLocation | None) -> list[APIDict] | None:
    if not source_storage:
        return None
    try:
        expanded = await expand_glob_pattern_in_source(source, source_storage)
    except Exception:
        logger.exception("Exception expanding glob pattern for source %s", source.id)
        return None
    logger.info("Glob expansion result: source_id=%s expanded_count=%s", source.id, len(expanded) if expanded else 0)
    if expanded:
        expanded_paths = [
            _dict_source_path(item) if isinstance(item, dict) else "not-dict"
            for item in expanded[:EXPANDED_PATH_LOG_LIMIT]
        ]
        logger.info("Expanded source paths (first %s): %s", EXPANDED_PATH_LOG_LIMIT, expanded_paths)
    return expanded


def _safe_group_source_response(
    file_obj: File,
    source_item: FileSource | APIDict,
    fallback_storage: StorageLocation | None,
    storage_locations_by_id: dict[int, StorageLocation],
    glob_pattern: str | None,
) -> APIDict:
    try:
        source_dict, temp_source, source_storage = _group_source_parts(
            source_item,
            fallback_storage,
            storage_locations_by_id,
        )
        _add_source_urls(source_dict, temp_source, source_storage)
        _add_glob_pattern(source_dict, glob_pattern)
        logger.debug(
            "Adding source to format: id=%s path=%s has_glob=%s",
            source_dict.get("id"),
            _dict_source_path(source_dict),
            "glob_pattern" in source_dict,
        )
    except Exception:
        logger.exception("Error processing source for file %s", file_obj.id)
        return _fallback_source_response(source_item, fallback_storage)
    else:
        return source_dict


def _group_source_parts(
    source_item: FileSource | APIDict,
    fallback_storage: StorageLocation | None,
    storage_locations_by_id: dict[int, StorageLocation],
) -> tuple[APIDict, FileSource, StorageLocation | None]:
    if not isinstance(source_item, dict):
        source_dict: APIDict = model_json_dict(source_item)
        source_dict.setdefault("storage_location_id", source_item.storage_location_id)
        return source_dict, source_item, fallback_storage

    source_dict = dict(source_item)
    storage_id = _source_dict_storage_id(source_dict)
    source_storage = storage_locations_by_id.get(storage_id) if storage_id else fallback_storage
    source_metadata_model = _source_metadata_model(source_dict.get("source_metadata"))
    temp_source = FileSource(
        id=_source_dict_int(source_dict, "id") or 0,
        file_format_id=_source_dict_int(source_dict, "file_format_id") or 0,
        storage_location_id=_source_dict_int(source_dict, "storage_location_id") or 0,
        version=_source_dict_str(source_dict, "version", "1"),
        source_type=_source_dict_str(source_dict, "source_type", "file"),
        location=FileLocation(path=_source_dict_location_path(source_dict)),
        source_metadata=source_metadata_model,
    )
    return source_dict, temp_source, source_storage


def _safe_source_response(
    source: FileSource,
    storage_locations_by_id: dict[int, StorageLocation],
) -> APIDict:
    try:
        source_storage = storage_locations_by_id.get(source.storage_location_id)
        source_dict = model_json_dict(source)
        _add_source_urls(source_dict, source, source_storage)
    except Exception:
        logger.exception("Error processing source %s", source.id)
        return _fallback_source_response(source, None)
    else:
        return source_dict


def _add_source_urls(
    source_dict: APIDict,
    source: FileSource,
    source_storage: StorageLocation | None,
) -> None:
    if not source_storage:
        logger.warning("Storage location not found for source %s", source_dict.get("id"))
    source_dict["url"] = get_file_source_url(source, source_storage)
    source_dict["storage_uri"] = get_file_source_storage_uri(source, source_storage)
    source_dict["storage_location"] = source_storage.model_dump() if source_storage else None


def _add_glob_pattern(source_dict: APIDict, glob_pattern: str | None) -> None:
    if glob_pattern and "*" in _dict_source_path(source_dict):
        source_dict["glob_pattern"] = glob_pattern


def _fallback_source_response(
    source_item: FileSource | APIDict,
    source_storage: StorageLocation | None,
) -> APIDict:
    source_dict = dict(source_item) if isinstance(source_item, dict) else model_json_dict(source_item)
    source_dict["url"] = None
    source_dict["storage_uri"] = None
    source_dict["storage_location"] = source_storage.model_dump() if source_storage else None
    return source_dict


def _source_path(source: FileSource) -> str:
    source_location = source.location
    if isinstance(source_location, dict):
        return str(source_location.get("path", ""))
    if isinstance(source_location, FileLocation):
        return source_location.path
    return ""


def _dict_source_path(source_dict: APIDict) -> str:
    location = source_dict.get("location", {})
    if isinstance(location, dict):
        return str(location.get("path", ""))
    return ""


def _source_dict_location_path(source_dict: APIDict) -> str:
    location = source_dict.get("location", {})
    if not isinstance(location, dict):
        return ""
    return str(location.get("path", ""))


def _source_dict_storage_id(source_dict: APIDict) -> int | None:
    storage_id = source_dict.get("storage_location_id")
    return storage_id if isinstance(storage_id, int) else None


def _source_dict_int(source_dict: APIDict, key: str) -> int | None:
    value = source_dict.get(key)
    return value if isinstance(value, int) else None


def _source_dict_str(source_dict: APIDict, key: str, default: str) -> str:
    value = source_dict.get(key, default)
    return value if isinstance(value, str) else default


def _source_metadata_model(source_metadata: APIValue) -> SpatialDatasetFileMetadata | None:
    if not isinstance(source_metadata, dict):
        return None
    try:
        return SpatialDatasetFileMetadata.model_validate(json_dict(source_metadata))
    except Exception as exc:
        logger.warning("Failed to parse source_metadata for expanded source: %s", exc)
        return None


def _storage_location_details(storage_locations_by_id: dict[int, StorageLocation]) -> list[APIDict]:
    return [_storage_location_detail(storage_location) for storage_location in storage_locations_by_id.values()]


def _storage_location_detail(storage_location: StorageLocation) -> APIDict:
    detail: APIDict = {
        "id": storage_location.id,
        "name": storage_location.name,
        "backend_type": storage_location.backend_type,
    }
    config = storage_location.config
    if isinstance(config, dict):
        detail["config"] = _storage_config_log_values(api_dict(config))
    elif config:
        detail["config"] = _storage_config_log_values(model_json_dict(config))
    return detail


def _storage_config_log_values(config: APIDict) -> APIDict:
    return {
        "type": config.get("type"),
        "bucket": config.get("bucket"),
        "base_url": config.get("base_url"),
        "version": config.get("version"),
    }


def _file_source_details(
    sources_by_file_format_id: dict[int, list[FileSource]],
    storage_locations_by_id: dict[int, StorageLocation],
) -> APIList:
    details: APIList = []
    for sources in sources_by_file_format_id.values():
        for source in sources:
            source_storage = storage_locations_by_id.get(source.storage_location_id)
            details.append(
                {
                    "id": source.id,
                    "file_format_id": source.file_format_id,
                    "storage_location_id": source.storage_location_id,
                    "storage_name": source_storage.name if source_storage else "unknown",
                    "config_type": _storage_config_type(source_storage),
                    "version": source.version,
                    "source_type": source.source_type,
                    "path": _source_path(source),
                    "has_glob": "*" in _source_path(source),
                }
            )
    return details


def _storage_config_type(source_storage: StorageLocation | None) -> APIValue:
    if not source_storage or not source_storage.config:
        return None
    if isinstance(source_storage.config, dict):
        return source_storage.config.get("type")
    return source_storage.config.type if hasattr(source_storage.config, "type") else None


def _log_dataset_context(dataset_id: int, context: SourceContext) -> None:
    storage_location_ids = set(context.storage_locations_by_id)
    file_format_ids = [
        file_format.id for formats in context.file_formats_by_file_id.values() for file_format, _ in formats
    ]
    logger.info(
        "Dataset debug: dataset_id=%s format_ids=%s storage_location_ids=%s",
        dataset_id,
        file_format_ids,
        sorted(storage_location_ids),
    )
    if context.storage_locations_by_id:
        logger.info("Storage locations: %s", _storage_location_details(context.storage_locations_by_id))


def _log_file_context(file_obj: File, context: SourceContext) -> None:
    storage_location_ids = set(context.storage_locations_by_id)
    file_format_ids = [
        file_format.id for formats in context.file_formats_by_file_id.values() for file_format, _ in formats
    ]
    logger.info(
        "File detail debug: file_id=%s slug=%s format_ids=%s storage_location_ids=%s",
        file_obj.id,
        file_obj.slug,
        file_format_ids,
        sorted(storage_location_ids),
    )
    if context.storage_locations_by_id:
        logger.info("Storage locations: %s", _storage_location_details(context.storage_locations_by_id))
    logger.info(
        "File sources: %s", _file_source_details(context.sources_by_file_format_id, context.storage_locations_by_id)
    )
