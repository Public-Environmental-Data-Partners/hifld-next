from collections.abc import Mapping
from typing import Self

from starlette.requests import Request

type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
type ApiResult = tuple[dict[str, str], int, JsonValue | str | bytes]

class APIRequest:
    @classmethod
    async def from_starlette(cls, request: Request, supported_locales: list[str]) -> Self: ...

class API:
    locales: list[str]
    config: dict[str, JsonValue]
    def __init__(self, config: Mapping[str, JsonValue], openapi: dict[str, JsonValue]) -> None: ...

def landing_page(api: API, request: APIRequest) -> ApiResult: ...
def openapi_(api: API, request: APIRequest) -> ApiResult: ...
def conformance(api: API, request: APIRequest) -> ApiResult: ...
def describe_collections(
    api: API, request: APIRequest, collection_id: str | None = None
) -> ApiResult: ...
