"""Async coordinator for a fixed set of single-request spawned workers."""

from __future__ import annotations

import asyncio
import multiprocessing
from dataclasses import dataclass
from multiprocessing.process import BaseProcess
from typing import Protocol

from query_worker.protocol import (
    WorkerFailure,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerRuntimeConfig,
    WorkerTile,
    WorkerTileQuery,
)
from query_worker.runtime import WorkerRuntime


class _Pipe(Protocol):
    def send(self, obj: object) -> None: ...

    def recv(self) -> object: ...

    def poll(self, timeout: float = 0.0) -> bool: ...

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class WorkerPoolConfig:
    worker_count: int = 1
    soft_timeout_seconds: float = 30.0
    hard_timeout_seconds: float = 60.0
    recycle_after_requests: int = 100

    def __post_init__(self) -> None:
        if self.worker_count < 1:
            raise ValueError("worker_count must be positive")
        if self.soft_timeout_seconds <= 0:
            raise ValueError("soft_timeout_seconds must be positive")
        if self.hard_timeout_seconds < self.soft_timeout_seconds:
            raise ValueError("hard timeout must not be shorter than soft timeout")
        if self.recycle_after_requests < 1:
            raise ValueError("recycle_after_requests must be positive")


@dataclass(slots=True, eq=False)
class _WorkerSlot:
    process: BaseProcess
    connection: _Pipe
    completed_requests: int = 0


@dataclass(frozen=True, slots=True)
class _WorkerReady:
    pass


def _worker_main(
    connection: _Pipe,
    runtime_config: WorkerRuntimeConfig,
) -> None:
    runtime: WorkerRuntime | None = None
    try:
        runtime = WorkerRuntime(runtime_config)
        connection.send(_WorkerReady())
        while True:
            message: object = connection.recv()
            if message is None:
                return
            if not isinstance(message, (WorkerQuery, WorkerTileQuery)):
                connection.send(
                    WorkerFailure(
                        code="worker_protocol_invalid",
                        message="The worker received an invalid request",
                    )
                )
                continue
            connection.send(runtime.execute(message))
    except (EOFError, BrokenPipeError, OSError):
        return
    except BaseException:
        try:
            connection.send(
                WorkerFailure(
                    code="worker_failed",
                    message="The query worker stopped unexpectedly",
                )
            )
        except (EOFError, BrokenPipeError, OSError):
            pass
    finally:
        if runtime is not None:
            runtime.close()
        connection.close()


class WorkerPool:
    """Queue queries onto spawned processes, with timeout replacement."""

    def __init__(
        self,
        config: WorkerPoolConfig,
        runtime_config: WorkerRuntimeConfig,
    ) -> None:
        self._config = config
        self._runtime_config = runtime_config
        self._context = multiprocessing.get_context("spawn")
        self._available: asyncio.Queue[_WorkerSlot] = asyncio.Queue()
        self._workers: list[_WorkerSlot] = []
        self._lifecycle_lock = asyncio.Lock()
        self._started = False
        self._closed = False

    @property
    def worker_pids(self) -> tuple[int, ...]:
        return tuple(slot.process.pid or 0 for slot in self._workers)

    async def _spawn_worker(self) -> _WorkerSlot:
        parent_connection, child_connection = self._context.Pipe(duplex=True)
        process = self._context.Process(
            target=_worker_main,
            args=(child_connection, self._runtime_config),
            daemon=True,
        )
        process.start()
        child_connection.close()
        slot = _WorkerSlot(process=process, connection=parent_connection)
        ready = await asyncio.to_thread(parent_connection.poll, self._config.hard_timeout_seconds)
        if not ready:
            process.terminate()
            await asyncio.to_thread(process.join, 1.0)
            parent_connection.close()
            raise RuntimeError("query worker did not become ready")
        message: object = await asyncio.to_thread(parent_connection.recv)
        if not isinstance(message, _WorkerReady):
            process.terminate()
            await asyncio.to_thread(process.join, 1.0)
            parent_connection.close()
            raise RuntimeError("query worker failed during startup")
        self._workers.append(slot)
        return slot

    async def start(self) -> None:
        async with self._lifecycle_lock:
            if self._closed:
                raise RuntimeError("worker pool is closed")
            if self._started:
                return
            for _ in range(self._config.worker_count):
                self._available.put_nowait(await self._spawn_worker())
            self._started = True

    async def _retire(self, slot: _WorkerSlot, *, graceful: bool) -> None:
        if slot in self._workers:
            self._workers.remove(slot)
        if graceful and slot.process.is_alive():
            try:
                slot.connection.send(None)
            except (EOFError, BrokenPipeError, OSError):
                pass
        elif slot.process.is_alive():
            slot.process.terminate()
        await asyncio.to_thread(slot.process.join, self._config.hard_timeout_seconds)
        if slot.process.is_alive():
            slot.process.kill()
            await asyncio.to_thread(slot.process.join, 1.0)
        slot.connection.close()

    async def _replace(self, slot: _WorkerSlot) -> None:
        await self._retire(slot, graceful=False)
        if not self._closed:
            self._available.put_nowait(await self._spawn_worker())

    async def execute(
        self,
        request: WorkerQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult:
        if not self._started:
            await self.start()
        if self._closed:
            return WorkerFailure(code="worker_unavailable", message="The worker pool is closed")

        slot = await self._available.get()
        timeout = timeout_seconds or self._config.soft_timeout_seconds
        if timeout <= 0:
            self._available.put_nowait(slot)
            raise ValueError("timeout_seconds must be positive")
        replacement_task: asyncio.Task[None] | None = None

        async def replace_once() -> None:
            nonlocal replacement_task
            if replacement_task is None:
                replacement_task = asyncio.create_task(self._replace(slot))
            while True:
                try:
                    await asyncio.shield(replacement_task)
                    return
                except asyncio.CancelledError:
                    continue

        try:
            await asyncio.to_thread(slot.connection.send, request)
            response_ready = await asyncio.to_thread(slot.connection.poll, timeout)
            if not response_ready:
                await replace_once()
                return WorkerFailure(
                    code="query_timeout",
                    message="The query exceeded its execution timeout",
                )
            response: object = await asyncio.to_thread(slot.connection.recv)
        except (EOFError, BrokenPipeError, OSError):
            await replace_once()
            return WorkerFailure(
                code="worker_failed",
                message="The query worker stopped unexpectedly",
            )
        except asyncio.CancelledError:
            await replace_once()
            raise

        if not isinstance(response, (WorkerPage, WorkerTile, WorkerFailure)):
            await replace_once()
            return WorkerFailure(
                code="worker_protocol_invalid",
                message="The query worker returned an invalid response",
            )

        slot.completed_requests += 1
        fatal_failure = isinstance(response, WorkerFailure) and response.code in {
            "worker_failed",
            "worker_protocol_invalid",
        }
        if fatal_failure or (slot.completed_requests >= self._config.recycle_after_requests):
            await replace_once()
        else:
            self._available.put_nowait(slot)
        return response

    async def close(self) -> None:
        async with self._lifecycle_lock:
            if self._closed:
                return
            self._closed = True
            workers = tuple(self._workers)
            for slot in workers:
                await self._retire(slot, graceful=True)
            self._started = False
