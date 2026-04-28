"""Process management module for Cursor"""

import subprocess
import psutil
from typing import List


def is_cursor_running() -> bool:
    """Check if Cursor is currently running"""
    for proc in psutil.process_iter(["name"]):
        try:
            if proc.info["name"] and "cursor.exe" in proc.info["name"].lower():
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return False


def get_cursor_processes() -> List[psutil.Process]:
    """Get all Cursor process objects"""
    processes = []
    for proc in psutil.process_iter(["name", "pid"]):
        try:
            if proc.info["name"] and "cursor.exe" in proc.info["name"].lower():
                processes.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return processes


def close_cursor(timeout: int = 10) -> bool:
    """Close all Cursor processes gracefully, then force kill if needed"""
    processes = get_cursor_processes()

    if not processes:
        return True

    for proc in processes:
        try:
            proc.terminate()
        except psutil.NoSuchProcess:
            continue

    for proc in processes:
        try:
            proc.wait(timeout=timeout)
        except (psutil.NoSuchProcess, psutil.TimeoutExpired):
            try:
                proc.kill()
            except psutil.NoSuchProcess:
                pass

    for proc in processes:
        try:
            if proc.is_running():
                return False
        except psutil.NoSuchProcess:
            continue

    return True


def force_close_cursor() -> bool:
    """Force kill all Cursor processes immediately"""
    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", "Cursor.exe"], capture_output=True, text=True
        )
        return True
    except Exception:
        return False
