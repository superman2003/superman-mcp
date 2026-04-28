"""Main entry point for Cursor Membership Switcher"""

import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PyQt5.QtWidgets import QApplication, QMessageBox
from PyQt5.QtGui import QIcon, QFont
from PyQt5.QtCore import Qt
from ui.mainwindow import MainWindow
from ui.license_dialog import LicenseDialog
from ui.theme import global_qss
from core import license as license_manager


def check_license():
    """Check license status and show activation if needed"""
    license_data = license_manager.load_license()

    if license_data and license_data.get("type") == "full":
        machine_code = license_manager.get_machine_code()
        if license_data.get("machine_code") == machine_code:
            return True

    is_valid, days = license_manager.check_trial()

    if is_valid:
        license_manager.update_trial_usage()
        return True

    return False


def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setApplicationName("Cursor Membership Switcher")
    app.setOrganizationName("CursorSwitcher")
    # Global typography + QSS so QMessageBox / QMenu inherit the dark glass theme
    app.setFont(QFont("Microsoft YaHei UI", 10))
    app.setStyleSheet(global_qss())

    if not check_license():
        msg = QMessageBox()
        msg.setIcon(QMessageBox.Warning)
        msg.setWindowTitle("许可证已过期")
        msg.setText("试用期已结束，请购买激活码继续使用")
        msg.setInformativeText("点击确定进入激活界面")
        msg.setStandardButtons(QMessageBox.Ok | QMessageBox.Cancel)

        result = msg.exec_()

        if result == QMessageBox.Ok:
            dialog = LicenseDialog()
            dialog.exec_()

            if not dialog.activated:
                is_valid, days = license_manager.check_trial()
                if not is_valid:
                    sys.exit(0)
        else:
            sys.exit(0)

    window = MainWindow()
    window.show()

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
