"""License management module with machine code binding and trial management"""

import os
import json
import hashlib
import time
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta
from Crypto.Cipher import AES
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15
from Crypto.Hash import SHA256
import config


def get_machine_code() -> str:
    """Generate unique machine code based on hardware info"""
    try:
        import wmi

        c = wmi.WMI()

        cpu_id = ""
        motherboard_id = ""
        mac_address = ""

        for processor in c.Win32_Processor():
            cpu_id = processor.ProcessorId
            break

        for base_board in c.Win32_BaseBoard():
            motherboard_id = base_board.SerialNumber
            break

        for network_adapter in c.Win32_NetworkAdapterConfiguration():
            if network_adapter.MACAddress:
                mac_address = network_adapter.MACAddress
                break

        machine_info = f"{cpu_id}{motherboard_id}{mac_address}"
        machine_hash = hashlib.sha256(machine_info.encode()).hexdigest()[:16].upper()

        return f"{machine_hash[0:4]}-{machine_hash[4:8]}-{machine_hash[8:12]}-{machine_hash[12:16]}"

    except Exception:
        # Fallback: use hostname + username
        fallback = f"{os.gethostname()}{os.getlogin()}"
        machine_hash = hashlib.sha256(fallback.encode()).hexdigest()[:16].upper()
        return f"{machine_hash[0:4]}-{machine_hash[4:8]}-{machine_hash[8:12]}-{machine_hash[12:16]}"


def encrypt_data(data: bytes) -> bytes:
    """Encrypt data using AES"""
    key = config.LOCAL_ENCRYPTION_KEY[:32].ljust(32, b"\0")
    cipher = AES.new(key, AES.MODE_EAX)
    nonce = cipher.nonce
    ciphertext, tag = cipher.encrypt_and_digest(data)
    return nonce + tag + ciphertext


def decrypt_data(encrypted_data: bytes) -> bytes:
    """Decrypt AES encrypted data"""
    key = config.LOCAL_ENCRYPTION_KEY[:32].ljust(32, b"\0")
    nonce = encrypted_data[:16]
    tag = encrypted_data[16:32]
    ciphertext = encrypted_data[32:]
    cipher = AES.new(key, AES.MODE_EAX, nonce=nonce)
    return cipher.decrypt_and_verify(ciphertext, tag)


def save_license(license_data: dict):
    """Save encrypted license file"""
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    json_data = json.dumps(license_data)
    encrypted = encrypt_data(json_data.encode("utf-8"))
    config.LICENSE_PATH.write_bytes(encrypted)


def load_license() -> Optional[dict]:
    """Load and decrypt license file"""
    if not config.LICENSE_PATH.exists():
        return None
    try:
        encrypted = config.LICENSE_PATH.read_bytes()
        decrypted = decrypt_data(encrypted)
        return json.loads(decrypted.decode("utf-8"))
    except Exception:
        return None


def verify_activation_code(activation_code: str, machine_code: str) -> tuple[bool, str]:
    """Verify activation code (offline validation with RSA signature)"""
    try:
        parts = activation_code.split("-")
        if len(parts) != 5 or any(len(p) != 5 for p in parts):
            return False, "激活码格式错误"

        code_without_dashes = "".join(parts)

        try:
            key_data = RSA.import_key(config.RSA_PUBLIC_KEY)
            hash_obj = SHA256.new(machine_code.encode())
            pkcs1_15.new(key_data).verify(
                hash_obj, bytes.fromhex(code_without_dashes[:128])
            )
            return True, "激活成功"
        except (ValueError, TypeError):
            return False, "激活码无效"

    except Exception as e:
        return False, f"验证失败：{str(e)}"


def check_trial() -> tuple[bool, int]:
    """Check trial status. Returns (is_valid, days_remaining)"""
    license_data = load_license()

    if license_data and license_data.get("type") == "full":
        # Full license - check expiry
        expiry = license_data.get("expiry", 0)
        if time.time() < expiry:
            days_left = int((expiry - time.time()) / 86400)
            return True, days_left
        else:
            return False, 0

    # Check trial
    if license_data and license_data.get("type") == "trial":
        first_run = license_data.get("first_run", 0)
        days_used = license_data.get("days_used", 0)

        days_remaining = config.TRIAL_DAYS - days_used
        if days_remaining > 0:
            return True, days_remaining
        else:
            return False, 0

    # No license - start trial
    return start_trial()


def start_trial() -> tuple[bool, int]:
    """Initialize trial period"""
    license_data = {
        "type": "trial",
        "first_run": int(time.time()),
        "days_used": 0,
        "last_check": int(time.time()),
    }
    save_license(license_data)
    return True, config.TRIAL_DAYS


def update_trial_usage():
    """Update trial usage tracking"""
    license_data = load_license()
    if not license_data:
        return

    if license_data.get("type") == "trial":
        last_check = license_data.get("last_check", 0)
        now = int(time.time())
        days_passed = (now - last_check) / 86400

        if days_passed >= 1:
            license_data["days_used"] = license_data.get("days_used", 0) + int(
                days_passed
            )
            license_data["last_check"] = now
            save_license(license_data)


def activate_full_license(activation_code: str) -> tuple[bool, str]:
    """Activate full license with activation code"""
    machine_code = get_machine_code()
    is_valid, message = verify_activation_code(activation_code, machine_code)

    if is_valid:
        license_data = {
            "type": "full",
            "machine_code": machine_code,
            "activation_code": activation_code,
            "activated_at": int(time.time()),
            "expiry": int(time.time()) + (365 * 86400),  # 1 year
        }
        save_license(license_data)
        return True, "激活成功！"
    else:
        return False, message
