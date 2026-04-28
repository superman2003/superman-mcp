"""PyArmor obfuscation script"""

import os
import subprocess
import shutil


def obfuscate():
    """Obfuscate Python files using PyArmor"""

    src_dir = os.path.join(os.path.dirname(__file__), "..", "src")
    output_dir = os.path.join(os.path.dirname(__file__), "obfuscated")

    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)

    core_files = [
        os.path.join(src_dir, "core", "patcher.py"),
        os.path.join(src_dir, "core", "license.py"),
        os.path.join(src_dir, "core", "process.py"),
    ]

    print("Obfuscating core modules with PyArmor...")

    for file in core_files:
        if os.path.exists(file):
            print(f"Obfuscating: {file}")
            subprocess.run(
                ["pyarmor", "gen", "--output", output_dir, "--restrict", "0", file]
            )

    print(f"Obfuscation complete. Output directory: {output_dir}")
    print("Replace original files with obfuscated ones before packaging")


if __name__ == "__main__":
    obfuscate()
