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
    'anpr',
    'browse',
    'cameras',
    'config_ini',
    'dictionary_import',
    'metra',
    'persistence',
    'reo_client',
    'sqlite_store',
    'text_encoding',
    'vescom',
    'wa',
    'year_db',
    'year_rotation',
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

# Dual-build notes (этап 7 фотофиксация + этап 8 ANPR):
# - Full build (default): may include optional opencv-python-headless for RTSP
#   and onnxruntime for ANPR. Place model at {app_root}/models/anpr/plate.onnx
#   (outside _MEIPASS / not bundled in git). Do NOT add 'cv2'/'onnxruntime' to
#   excludes; optionally add them to hiddenimports if packaging those deps.
# - Basic build (without heavy camera/ANPR deps): set
#     excludes=['cv2', 'opencv', 'onnxruntime', 'numpy.tests', ...]
#   and do not install opencv-python-headless / onnxruntime. HTTP snapshot via
#   requests still works; cameras.py / anpr.py lazy-import and degrade gracefully
#   (RTSP failed; anpr_available=false → disabled_by_configuration).
# - video_enabled / anpr_enabled are runtime config.ini flags; switching does
#   not require reinstall. Keep anpr_enabled=false until spike accuracy ≥ 50%.

a = Analysis(
    [os.path.join(server_dir, 'launcher.py')],
    pathex=[server_dir],
    binaries=binaries,
    datas=[(frontend_dist, 'dist')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[runtime_hook],
    excludes=[],  # basic build: excludes=['cv2', 'onnxruntime']
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
