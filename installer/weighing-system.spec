# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

project_root = os.path.abspath(os.path.join(SPECPATH, '..'))
server_dir = os.path.join(project_root, 'server')
frontend_dist = os.path.join(project_root, 'dist')

if not os.path.isdir(frontend_dist):
    raise SystemExit(
        'Frontend is not built. Run "npm run build" before creating the installer.'
    )

hiddenimports = [
    'browse',
    'config_ini',
    'dictionary_import',
    'metra',
    'persistence',
    'reo_client',
    'sqlite_store',
    'text_encoding',
    'vescom',
    'flask',
    'flask_cors',
    'werkzeug',
    'werkzeug.routing',
    'werkzeug.serving',
    'jinja2',
    'requests',
    'fdb',
    'pypxlib',
]
hiddenimports += collect_submodules('pypxlib')

a = Analysis(
    [os.path.join(server_dir, 'launcher.py')],
    pathex=[server_dir],
    binaries=[],
    datas=[(frontend_dist, 'dist')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='WeighingSystem',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='WeighingSystem',
)
