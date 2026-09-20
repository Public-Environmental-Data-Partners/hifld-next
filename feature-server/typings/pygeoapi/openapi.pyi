from collections.abc import Mapping

from pygeoapi.api import JsonValue

def get_oas(
    cfg: Mapping[str, JsonValue], fail_on_invalid_collection: bool = ..., version: str = ...
) -> dict[str, JsonValue]: ...
