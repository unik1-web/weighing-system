# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
import PyInstaller.utils.win32.winutils as winutils

# Work around PE checksum failures on some Windows builds.
winutils.update_exe_pe_checksum = lambda _exe_path: None

project_root = os.path.abspath(os.path.join(SPECPATH, '..'))
server_dir = os.path.join(project_root, 'server')
frontend_dist = os.path.join(project_root, 'dist')
runtime_hook = os.path.join(SPECPATH, 'pyi_rth_pypxlib.py')

if not os.path.isdir(frontend_dist):
    raise SystemExit(
        'Frontend is not built. Run "npm run build" before creating the installer.'
    )

binaries = []
try:
    import pypxlib

    pxlib_ctypes_dir = os.path.join(os.path.dirname(pypxlib.__file__), 'pxlib_ctypes')
    for dll_name in ('pxlib_x64.dll', 'pxlib.dll'):
        dll_path = os.path.join(pxlib_ctypes_dir, dll_name)
        if os.path.isfile(dll_path):
            binaries.append((dll_path, 'pypxlib/pxlib_ctypes'))
except ImportError:
    pass

hiddenimports = [
    'browse',
    'config_ini',
    'dictionary_import',
    'scale_api',
    'scale_api_guard',
    'scale_runtime',
    'scale_registry',
    'scale_registry_contract',
    'scale_integrity',
    'scale_transports.serial_backend',
    'metra',
    'persistence',
    'reo_client',
    'serial',
    'sqlite_store',
    'text_encoding',
    'vescom',
    'wa',
    # Stage-7 camera/photo modules are import-safe without cv2 (lazy OpenCV probe).
    'cameras',
    'camera_logging',
    'photo_storage',
    'ticket_photos',
    'flask',
    'flask_cors',
    'werkzeug',
    'werkzeug.routing',
    'werkzeug.serving',
    'jinja2',
    'requests',
    'fdb',
    'pypxlib',
    'pypxlib.pxlib_ctypes',
    'pypxlib.pxlib_ctypes.py3',
]
hiddenimports += collect_submodules('pypxlib')

# Basic delivery: documented exclude of OpenCV (EC-06). Capability gate reports basic.
a = Analysis(
    [os.path.join(server_dir, 'launcher.py')],
    pathex=[server_dir],
    binaries=binaries,
    datas=[(frontend_dist, 'dist')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[runtime_hook],
    excludes=['cv2', 'opencv'],
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
