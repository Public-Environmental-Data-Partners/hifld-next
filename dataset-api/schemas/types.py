"""Shared structural type aliases."""

from typing import TypeAlias

from pydantic import BaseModel


JSONValue: TypeAlias = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]
JSONDict: TypeAlias = dict[str, JSONValue]
DatasetTags: TypeAlias = dict[str, str | list[str]]
APIValue: TypeAlias = "BaseModel | JSONValue | APIList | APIDict"
APIDict: TypeAlias = dict[str, APIValue]
APIList: TypeAlias = list[APIValue]


def api_dict(value: object) -> APIDict:
    """Validate an object as an API dictionary."""
    if not isinstance(value, dict):
        msg = "Expected an API object"
        raise TypeError(msg)
    return {str(key): json_value(item) for key, item in value.items()}


def model_json_dict(model: BaseModel) -> APIDict:
    """Serialize a Pydantic model as a checked API dictionary."""
    return {str(key): json_value(item) for key, item in model.model_dump(mode="json").items()}


def json_dict(value: object) -> JSONDict:
    """Validate an object as a JSON dictionary."""
    if not isinstance(value, dict):
        msg = "Expected a JSON object"
        raise TypeError(msg)
    return {str(key): json_value(item) for key, item in value.items()}


def json_value(value: object) -> JSONValue:
    """Validate an object as a JSON-compatible value."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    msg = f"Unsupported JSON value type: {type(value).__name__}"
    raise TypeError(msg)
