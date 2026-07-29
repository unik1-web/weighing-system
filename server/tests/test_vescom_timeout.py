import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from unittest.mock import patch

import pytest

import vescom


def test_connect_timeout_unblocks_before_hung_connect_finishes(monkeypatch):
    """Regression: ThreadPoolExecutor(wait=True) used to defeat the timeout."""

    def slow_connect(db_path, user, password):
        time.sleep(2.0)
        return object()

    monkeypatch.setattr(vescom, 'connect_vescom', slow_connect)

    started = time.monotonic()
    with pytest.raises(TimeoutError, match='Таймаут подключения'):
        vescom.connect_vescom_with_timeout('X:/missing.fdb', 'SYSDBA', 'masterkey', timeout_seconds=0.2)
    elapsed = time.monotonic() - started

    assert elapsed < 1.0, f'timeout still blocked on hung connect ({elapsed:.2f}s)'


def test_executor_shutdown_wait_true_blocks_after_future_timeout():
    """Document why connect_vescom_with_timeout must not use `with ThreadPoolExecutor`."""

    def slow():
        time.sleep(0.8)
        return 'done'

    started = time.monotonic()
    with pytest.raises(TimeoutError):
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(slow)
            try:
                future.result(timeout=0.1)
            except FutureTimeoutError as exc:
                raise TimeoutError('outer') from exc
    elapsed = time.monotonic() - started
    assert elapsed >= 0.7
