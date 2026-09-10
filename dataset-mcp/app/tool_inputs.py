"""Compatibility decoding at the external tool boundary, before normal validation."""

import json


def decode_json_parameter(value: object) -> object:
    """Accept one JSON-encoded parameter from clients that stringify containers.

    Do not coerce decoded shapes, recursively decode strings, or skip the
    downstream Pydantic validators. Advertised schemas remain arrays/objects.
    """
    if not isinstance(value, str):
        return value
    if len(value) > 1024 * 1024:
        raise ValueError("JSON parameter exceeds the 1 MiB character limit")
    try:
        decoded: object = json.loads(value)
    except (ValueError, RecursionError) as error:
        raise ValueError("Parameter must be a valid JSON array or object") from error
    return decoded
