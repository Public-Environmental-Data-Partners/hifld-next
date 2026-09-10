"""Async coordinator for a fixed set of single-request spawned workers."""

from __future__ import annotations

import asyncio
import multiprocessing
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from multiprocessing.process import BaseProcess
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol

from query_worker.protocol import (
    WorkerBounds,
    WorkerBoundsQuery,
    WorkerFailure,
    WorkerPage,
    WorkerQuery,
    WorkerResult,
    WorkerRuntimeConfig,
    WorkerSourceSpec,
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
    queue_timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if self.worker_count < 1:
            raise ValueError("worker_count must be positive")
        if self.soft_timeout_seconds <= 0:
            raise ValueError("soft_timeout_seconds must be positive")
        if self.hard_timeout_seconds < self.soft_timeout_seconds:
            raise ValueError("hard timeout must not be shorter than soft timeout")
        if self.recycle_after_requests < 1:
            raise ValueError("recycle_after_requests must be positive")
        if self.queue_timeout_seconds <= 0:
            raise ValueError("queue_timeout_seconds must be positive")


@dataclass(slots=True)
class _QueryAdmission:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    references: int = 0


@dataclass(slots=True, eq=False)
class _WorkerSlot:
    process: BaseProcess
    connection: _Pipe
    completed_requests: int = 0
    spill_directory: TemporaryDirectory[str] | None = None


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
            if not isinstance(message, (WorkerQuery, WorkerBoundsQuery, WorkerTileQuery)):
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
        self._admissions: dict[tuple[str, tuple[WorkerSourceSpec, ...]], _QueryAdmission] = {}

    @property
    def worker_pids(self) -> tuple[int, ...]:
        return tuple(slot.process.pid or 0 for slot in self._workers)

    async def _spawn_worker(self) -> _WorkerSlot:
        Path(self._runtime_config.temp_directory).mkdir(parents=True, exist_ok=True)
        spill = TemporaryDirectory(prefix="worker-", dir=self._runtime_config.temp_directory)
        parent_connection, child_connection = self._context.Pipe(duplex=True)
        process = self._context.Process(
            target=_worker_main,
            args=(child_connection, replace(self._runtime_config, temp_directory=spill.name)),
            daemon=True,
        )
        process.start()
        child_connection.close()
        slot = _WorkerSlot(process=process, connection=parent_connection, spill_directory=spill)
        ready = await asyncio.to_thread(parent_connection.poll, self._config.hard_timeout_seconds)
        if not ready:
            process.terminate()
            await asyncio.to_thread(process.join, 1.0)
            parent_connection.close()
            spill.cleanup()
            raise RuntimeError("query worker did not become ready")
        message: object = await asyncio.to_thread(parent_connection.recv)
        if not isinstance(message, _WorkerReady):
            process.terminate()
            await asyncio.to_thread(process.join, 1.0)
            parent_connection.close()
            spill.cleanup()
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
        if slot.spill_directory is not None:
            slot.spill_directory.cleanup()

    async def _replace(self, slot: _WorkerSlot) -> None:
        await self._retire(slot, graceful=False)
        if not self._closed:
            self._available.put_nowait(await self._spawn_worker())

    async def execute(
        self,
        request: WorkerQuery | WorkerBoundsQuery | WorkerTileQuery,
        *,
        timeout_seconds: float | None = None,
    ) -> WorkerResult:
        timeout = (
            timeout_seconds if timeout_seconds is not None else self._config.soft_timeout_seconds
        )
        if timeout <= 0:
            raise ValueError("timeout_seconds must be positive")
        if request.deadline <= datetime.now(tz=UTC):
            return WorkerFailure(code="query_timeout", message="The query deadline expired")
        if not self._started:
            await self.start()
        if self._closed:
            return WorkerFailure(code="worker_unavailable", message="The worker pool is closed")

        # Wait for this query's turn BEFORE acquiring a worker: a flood layer's
        # tile fan-out must not occupy the slot another layer needs.
        key = (request.canonical_sql, request.sources)
        admission = self._admissions.setdefault(key, _QueryAdmission())
        admission.references += 1
        acquired = False
        try:
            try:
                async with asyncio.timeout(self._config.queue_timeout_seconds):
                    await admission.lock.acquire()
                    acquired = True
                    slot = await self._available.get()
            except TimeoutError:
                return WorkerFailure(
                    code="query_timeout", message="The query exceeded its queue wait limit"
                )
            if self._closed:
                return WorkerFailure(code="worker_unavailable", message="The worker pool is closed")
            # Queue admission has its own budget; give admitted work the full
            # execution budget instead of sending an already-expired deadline.
            admitted_request = replace(
                request, deadline=datetime.now(tz=UTC) + timedelta(seconds=timeout)
            )
            return await self._execute_slot(slot, admitted_request, timeout)
        finally:
            if acquired:
                admission.lock.release()
            admission.references -= 1
            if admission.references == 0:
                del self._admissions[key]

    async def _execute_slot(
        self,
        slot: _WorkerSlot,
        request: WorkerQuery | WorkerBoundsQuery | WorkerTileQuery,
        timeout: float,
    ) -> WorkerResult:
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

        if not isinstance(response, (WorkerPage, WorkerBounds, WorkerTile, WorkerFailure)):
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
