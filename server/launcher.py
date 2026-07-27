"""Entry point for the packaged Windows build (PyInstaller)."""
from __future__ import annotations

import multiprocessing
import os
import sys
import webbrowser


def _prepare_runtime() -> None:
    if getattr(sys, 'frozen', False):
        os.chdir(os.path.dirname(sys.executable))


def main() -> None:
    multiprocessing.freeze_support()
    _prepare_runtime()

    from app import DIST_DIR, app, frontend_available, logger

    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '5001'))
    debug = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes')
    url = f'http://{host}:{port}'

    if frontend_available():
        logger.info('Serving frontend from %s', DIST_DIR)
    else:
        logger.warning('Frontend not found at %s', DIST_DIR)

    logger.info('Starting weighing-system on %s', url)
    logger.info('API browse endpoint: %s/api/browse', url)

    if frontend_available() and os.environ.get('OPEN_BROWSER', '1') not in ('0', 'false', 'no'):
        webbrowser.open(url)

    app.run(host=host, port=port, debug=debug, use_reloader=False)


if __name__ == '__main__':
    main()
