"""Cursor JS patcher module for Windows"""

import re
import shutil
import psutil
from pathlib import Path
from typing import Optional, List
import config


def find_cursor_path_from_process() -> Optional[Path]:
    """Find Cursor installation path by searching running Cursor processes"""
    import os

    for proc in psutil.process_iter(["name", "exe", "cmdline"]):
        try:
            if proc.info["name"] and "cursor.exe" in proc.info["name"].lower():
                exe_path = Path(proc.info["exe"])
                # Cursor.exe is typically at: <install_dir>/Cursor.exe
                # JS file is at: <install_dir>/resources/app/out/vs/workbench/workbench.desktop.main.js
                install_dir = exe_path.parent
                js_path = (
                    install_dir
                    / "resources"
                    / "app"
                    / "out"
                    / "vs"
                    / "workbench"
                    / "workbench.desktop.main.js"
                )
                if js_path.exists():
                    return js_path
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    return None


def search_cursor_installations() -> List[Path]:
    """Search for all Cursor installations on the system"""
    import os

    found_paths = []

    # 1. Try from running processes (highest priority)
    process_path = find_cursor_path_from_process()
    if process_path:
        found_paths.append(process_path)

    # 2. Check default installation paths
    for path in config.DEFAULT_CURSOR_PATHS:
        if path.exists() and path not in found_paths:
            found_paths.append(path)

    # 3. Search common locations with limited depth
    localappdata = os.environ.get("LOCALAPPDATA", "")
    home = os.environ.get("USERPROFILE", "")

    search_roots = [
        Path(localappdata) / "Programs",
        Path("C:/Program Files"),
        Path("C:/Program Files (x86)"),
        Path(home) / "AppData" / "Local" / "Programs",
        Path(home) / "AppData" / "Local",
    ]

    def safe_search(root: Path, max_depth: int = 4) -> List[Path]:
        """Safely search with depth limit, avoiding symlinks"""
        results = []
        if not root.exists():
            return results

        def _search_dir(directory: Path, current_depth: int):
            if current_depth > max_depth:
                return
            try:
                for item in directory.iterdir():
                    try:
                        if item.is_symlink():
                            continue
                        if item.is_dir():
                            _search_dir(item, current_depth + 1)
                        elif item.name == "workbench.desktop.main.js":
                            if item not in found_paths and item not in results:
                                results.append(item)
                    except (PermissionError, OSError):
                        continue
            except (PermissionError, OSError):
                pass

        _search_dir(root, 0)
        return results

    for search_root in search_roots:
        found_paths.extend(safe_search(search_root))

    # Sort: process paths first, then by path length
    found_paths.sort(key=lambda p: (0 if p == process_path else 1, len(str(p))))

    return found_paths


def find_cursor_js_path_quick() -> Optional[Path]:
    """Quick search for Cursor JS path (process + default only, no disk scan)"""
    # 1. Try from running process
    process_path = find_cursor_path_from_process()
    if process_path:
        return process_path

    # 2. Check default installation paths
    for path in config.DEFAULT_CURSOR_PATHS:
        if path.exists():
            return path

    return None


def find_cursor_js_path(custom_path: Optional[str] = None) -> Optional[Path]:
    """Find Cursor's workbench JS file"""
    if custom_path:
        path = Path(custom_path)
        if path.exists():
            return path
        return None

    # First try to find from running process
    process_path = find_cursor_path_from_process()
    if process_path:
        return process_path

    # Then check default paths
    for path in config.DEFAULT_CURSOR_PATHS:
        if path.exists():
            return path

    return None


def is_patched(content: str) -> Optional[str]:
    """Check if JS is patched and return current membership type"""
    match = re.search(re.escape(config.PATCH_MARKER) + r'r="([^"]+)";', content)
    return match.group(1) if match else None


def read_js(js_path: Path) -> str:
    """Read JS file content"""
    return js_path.read_text(encoding="utf-8", errors="surrogateescape")


def write_js(js_path: Path, content: str):
    """Write JS file content"""
    js_path.write_text(content, encoding="utf-8", errors="surrogateescape")


def create_backup(js_path: Path):
    """Create backup of original JS file"""
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if not config.BACKUP_PATH.exists():
        shutil.copy2(js_path, config.BACKUP_PATH)
        return True
    return False


def restore_backup(js_path: Path) -> bool:
    """Restore from backup"""
    if not config.BACKUP_PATH.exists():
        return False
    shutil.copy2(config.BACKUP_PATH, js_path)
    return True


def apply_patch(js_path: Path, membership_type: str) -> tuple[bool, str]:
    """Apply membership patch to JS file"""
    try:
        content = read_js(js_path)
        current = is_patched(content)

        patch_line = f'{config.PATCH_MARKER}r="{membership_type}";'

        if current is not None:
            # Already patched - update value
            new_content, n = re.subn(
                re.escape(config.PATCH_MARKER) + r'r="[^"]+";', patch_line, content
            )
            if n == 0 or new_content == content:
                return False, "补丁更新失败：未能替换已有补丁值"
            content = new_content
        else:
            # First time patch - make sure the anchor exists before touching anything
            if config.ORIGINAL_SNIPPET not in content:
                return (
                    False,
                    "未找到原始补丁锚点，Cursor 版本可能已升级，"
                    f"请更新 ORIGINAL_SNIPPET（当前：{config.ORIGINAL_SNIPPET}）",
                )
            create_backup(js_path)
            new_content = content.replace(
                config.ORIGINAL_SNIPPET, patch_line + config.ORIGINAL_SNIPPET, 1
            )
            if new_content == content:
                return False, "补丁未生效：字符串替换没有产生变化"
            content = new_content

        write_js(js_path, content)
        return True, f"成功补丁：会员类型设置为 '{membership_type}'"

    except Exception as e:
        return False, f"补丁失败：{str(e)}"


def remove_patch(js_path: Path) -> tuple[bool, str]:
    """Remove patch and restore original"""
    try:
        if restore_backup(js_path):
            return True, "成功恢复原始文件"
        else:
            return False, "未找到备份文件，无法恢复"
    except Exception as e:
        return False, f"恢复失败：{str(e)}"


def get_patch_status(js_path: Path) -> dict:
    """Get current patch status"""
    try:
        content = read_js(js_path)
        patched_type = is_patched(content)
        return {
            "is_patched": patched_type is not None,
            "membership_type": patched_type,
            "has_backup": config.BACKUP_PATH.exists(),
        }
    except Exception as e:
        return {
            "is_patched": False,
            "membership_type": None,
            "has_backup": False,
            "error": str(e),
        }
