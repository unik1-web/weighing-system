"""Photo filesystem paths and atomic JPEG writes under ``Photo/``."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime

import sqlite_store


class PhotoStorage:
    """
    Resolve and write JPEG files under ``{app_root}/Photo/``.

    Relative paths stored in DB use forward slashes (``Photo/...``).
    All writes are atomic (temp file + ``os.replace``) and confined to Photo root.
    """

    def get_photo_root(self) -> str:
        """Absolute path to the ``Photo/`` directory next to the application root."""
        return os.path.join(sqlite_store.get_app_root(), 'Photo')

    def ensure_photo_dirs(self, rel_path: str | None = None) -> str:
        """
        Lazily create ``Photo/`` and any parent directories for ``rel_path``.

        Args:
            rel_path: Optional relative path whose parent dirs should exist.
                When omitted, only the Photo root is ensured.

        Returns:
            Absolute Photo root path.
        """
        root = self.get_photo_root()
        os.makedirs(root, exist_ok=True)
        if rel_path:
            absolute = self.resolve(rel_path)
            parent = os.path.dirname(absolute)
            if parent:
                os.makedirs(parent, exist_ok=True)
        return root

    def ticket_photo_relpath(
        self,
        ticket_id: str,
        event: str,
        camera_id: str,
        role: str,
        captured_at: str,
    ) -> str:
        """
        Build relative ticket photo path ``Photo/YYYY/MM/DD/...``.

        Date components are taken from ``captured_at`` (ISO-like); on parse failure
        uses ``1970/01/01``.
        """
        year, month, day = self._date_parts(captured_at)
        filename = f'{ticket_id}_{event}_{camera_id}_{role}.jpg'
        return f'Photo/{year}/{month}/{day}/{filename}'

    def etalon_relpath(self, camera_id: str, scale_set: str) -> str:
        """
        Build relative etalon path ``Photo/etalons/{camera_id}/{primary|spare}.jpg``.

        Args:
            camera_id: Camera UUID.
            scale_set: ``primary`` or ``spare``.
        """
        safe_set = scale_set if scale_set in ('primary', 'spare') else 'primary'
        return f'Photo/etalons/{camera_id}/{safe_set}.jpg'

    def write_bytes(self, rel_path: str, data: bytes) -> str:
        """
        Atomically write ``data`` under Photo root at ``rel_path``.

        Creates parent directories as needed. Uses a sibling temp file then
        ``os.replace`` so readers never see a partial file.

        Args:
            rel_path: Relative path with forward slashes (may start with ``Photo/``).
            data: Raw bytes to write.

        Returns:
            Normalized relative path using ``/`` separators (prefixed with ``Photo/``).
        """
        absolute = self.resolve(rel_path)
        parent = os.path.dirname(absolute)
        os.makedirs(parent, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            prefix='.photo_',
            suffix='.tmp',
            dir=parent,
        )
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, absolute)
        except Exception:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return self._to_rel_db_path(absolute)

    def write_ticket_photo(
        self,
        ticket_id: str,
        event: str,
        camera_id: str,
        role: str,
        captured_at: str,
        jpeg_bytes: bytes,
    ) -> str:
        """
        Write ticket JPEG to disk under ``Photo/YYYY/MM/DD/...``.

        Args:
            ticket_id: Weighing ticket id.
            event: ``gross`` or ``tare``.
            camera_id: Camera UUID.
            role: Camera role (``entry`` / ``exit`` / ``overview``).
            captured_at: Capture timestamp (ISO-like) for date directories.
            jpeg_bytes: JPEG payload.

        Returns:
            Relative path stored in DB (``Photo/...`` with ``/``).
        """
        rel_path = self.ticket_photo_relpath(
            ticket_id, event, camera_id, role, captured_at
        )
        return self.write_bytes(rel_path, jpeg_bytes)

    def write_etalon(
        self,
        camera_id: str,
        scale_set: str,
        jpeg_bytes: bytes,
    ) -> str:
        """
        Write (overwrite) etalon JPEG under ``Photo/etalons/{camera_id}/``.

        Args:
            camera_id: Camera UUID.
            scale_set: ``primary`` or ``spare``.
            jpeg_bytes: JPEG payload.

        Returns:
            Relative path stored in DB.
        """
        rel_path = self.etalon_relpath(camera_id, scale_set)
        return self.write_bytes(rel_path, jpeg_bytes)

    def resolve(self, rel: str) -> str:
        """
        Resolve a relative photo path to an absolute path under ``Photo/``.

        Rejects ``..`` segments and any path that would escape the photo root.

        Raises:
            ValueError: If the path is empty, contains traversal, or escapes root.
        """
        raw = (rel or '').replace('\\', '/').strip()
        if not raw:
            raise ValueError('path_traversal')
        raw = raw.lstrip('/')
        parts = [part for part in raw.split('/') if part not in ('', '.')]
        if any(part == '..' for part in parts):
            raise ValueError('path_traversal')
        if parts and parts[0] == 'Photo':
            parts = parts[1:]
        root = os.path.realpath(self.get_photo_root())
        candidate = os.path.realpath(os.path.join(root, *parts)) if parts else root
        if candidate != root and not candidate.startswith(root + os.sep):
            raise ValueError('path_traversal')
        return candidate

    def safe_unlink(self, rel: str) -> None:
        """
        Best-effort delete of a relative photo file confined to Photo root.

        Invalid / traversal paths raise ``ValueError`` from ``resolve``.
        Missing files are ignored.
        """
        absolute = self.resolve(rel)
        try:
            if os.path.isfile(absolute):
                os.unlink(absolute)
        except OSError:
            pass

    def remove_etalon_dir(self, camera_id: str) -> None:
        """
        Best-effort remove ``Photo/etalons/{camera_id}/`` after a camera is deleted.

        Missing directories are ignored. Path must stay under Photo root.
        """
        import shutil

        safe_id = (camera_id or '').strip().replace('\\', '/').replace('..', '')
        if not safe_id or '/' in safe_id:
            return
        rel = f'Photo/etalons/{safe_id}'
        try:
            absolute = self.resolve(rel)
        except ValueError:
            return
        try:
            if os.path.isdir(absolute):
                shutil.rmtree(absolute, ignore_errors=True)
        except OSError:
            pass

    def file_exists(self, rel_path: str) -> bool:
        """
        Return True when ``rel_path`` resolves to an existing file under Photo/.

        Raises:
            ValueError: On path traversal (same as ``resolve``).
        """
        return os.path.isfile(self.resolve(rel_path))

    def _to_rel_db_path(self, absolute: str) -> str:
        """Convert absolute path under Photo root to ``Photo/...`` with ``/``."""
        root = os.path.realpath(self.get_photo_root())
        real = os.path.realpath(absolute)
        if real == root:
            return 'Photo'
        if not real.startswith(root + os.sep):
            raise ValueError('path_traversal')
        suffix = real[len(root) + 1 :].replace(os.sep, '/')
        return f'Photo/{suffix}'

    @staticmethod
    def _date_parts(captured_at: str) -> tuple[str, str, str]:
        """Extract YYYY, MM, DD from an ISO-like timestamp."""
        text = (captured_at or '').strip()
        if text:
            try:
                normalized = text.replace('Z', '+00:00')
                parsed = datetime.fromisoformat(normalized)
                return (
                    f'{parsed.year:04d}',
                    f'{parsed.month:02d}',
                    f'{parsed.day:02d}',
                )
            except ValueError:
                if len(text) >= 10 and text[4] == '-' and text[7] == '-':
                    return text[0:4], text[5:7], text[8:10]
        return '1970', '01', '01'
