# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec file for Cursor Membership Switcher"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

block_cipher = None

a = Analysis(
    ['src\\main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'psutil',
        'wmi',
        'Crypto.Cipher',
        'Crypto.Cipher.AES',
        'Crypto.PublicKey',
        'Crypto.PublicKey.RSA',
        'Crypto.Signature',
        'Crypto.Signature.pkcs1_15',
        'Crypto.Hash',
        'Crypto.Hash.SHA256',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='CursorMembershipSwitcher',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # Add icon path if you have one
)
