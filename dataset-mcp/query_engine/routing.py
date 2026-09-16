"""Resolve a trusted headless service and pin each query to one ready replica."""

import asyncio
import socket
from time import monotonic

import httpx


class ReplicaRouter:
    def __init__(self, url: str, discover: bool) -> None:
        self._url = httpx.URL(url.rstrip("/") + "/")
        if discover and (self._url.scheme != "http" or self._url.path != "/"):
            raise ValueError("Replica discovery requires an internal HTTP service origin")
        self._discover = discover
        self._addresses: tuple[str, ...] = ()
        self._expires = 0.0
        self._next = 0
        self._lock = asyncio.Lock()

    async def addresses(self) -> tuple[str, ...]:
        if not self._discover:
            return (str(self._url),)
        async with self._lock:
            if self._addresses and monotonic() < self._expires:
                return self._addresses
            records = await asyncio.get_running_loop().getaddrinfo(
                self._url.host, self._url.port or 80, type=socket.SOCK_STREAM
            )
            hosts = sorted({str(record[4][0]) for record in records})
            if not hosts:
                raise OSError("ClickHouse service has no ready replicas")
            self._addresses = tuple(str(self._url.copy_with(host=host)) for host in hosts)
            self._expires = monotonic() + 5
            return self._addresses

    async def select(self) -> str:
        addresses = await self.addresses()
        address = addresses[self._next % len(addresses)]
        self._next += 1
        return address
