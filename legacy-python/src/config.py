"""Configuration constants for Cursor Membership Switcher"""

import os
from pathlib import Path


def os_environ_get(key: str, default: str = "") -> str:
    """Safe environment variable access"""
    return os.environ.get(key, default)


# Windows default Cursor paths
localappdata = os.environ.get("LOCALAPPDATA", "")
DEFAULT_CURSOR_PATHS = [
    Path(localappdata)
    / "Programs"
    / "cursor"
    / "resources"
    / "app"
    / "out"
    / "vs"
    / "workbench"
    / "workbench.desktop.main.js",
    Path(localappdata)
    / "Programs"
    / "Cursor"
    / "resources"
    / "app"
    / "out"
    / "vs"
    / "workbench"
    / "workbench.desktop.main.js",
    Path(
        "C:/Program Files/Cursor/resources/app/out/vs/workbench/workbench.desktop.main.js"
    ),
]

# Backup path
BACKUP_DIR = Path(os.environ.get("APPDATA", "")) / "CursorMembershipSwitcher"
BACKUP_PATH = BACKUP_DIR / "workbench.desktop.main.js.bak"
LICENSE_PATH = BACKUP_DIR / "license.dat"

# Patch constants
ORIGINAL_SNIPPET = "r=r??Pa.FREE,"
PATCH_MARKER = "/*__cursor_membership_patch__*/"

# Membership types
MEMBERSHIP_TYPES = {
    "free": "Free",
    "free_trial": "Free Trial",
    "pro": "Pro",
    "pro_plus": "Pro+",
    "ultra": "Ultra",
    "enterprise": "Enterprise",
    "custom": "自定义",
}

# License configuration
TRIAL_DAYS = 7
RSA_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MaU8xKwwKU9dHDx9vHXCpJZn3cJKALi4C3VH3J0qGH4dJ0T0J9F
-----END PUBLIC KEY-----"""

# Encryption key for local data (AES-256). Shorter literals are zero-padded to
# 32 bytes at use-site; replace with a 32-byte random key in production builds.
LOCAL_ENCRYPTION_KEY = b"CursorSwitcher2024Key!!"
