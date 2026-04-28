"""License activation dialog with modern glassmorphism dark theme."""

from PyQt5.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QLineEdit,
    QMessageBox,
    QFrame,
    QApplication,
)
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import license as license_manager
from ui.theme import COLORS, MONO_FAMILY, apply_shadow


class CardFrame(QFrame):
    """Glassy card container."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("Card")
        self.setStyleSheet(f"""
            QFrame#Card {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:0, y2:1,
                    stop:0 {COLORS["bg_card_hi"]},
                    stop:1 {COLORS["bg_card"]}
                );
                border-radius: 14px;
                border: 1px solid {COLORS["border"]};
            }}
        """)
        apply_shadow(self, radius=32, y_offset=8, color="#000000", alpha=110)


class LicenseDialog(QDialog):
    """Dialog for license activation."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.activated = False
        self.init_ui()

    def init_ui(self):
        self.setWindowTitle("激活 Cursor Membership Switcher")
        self.setFixedSize(520, 460)
        self.setModal(True)
        self.setStyleSheet(f"""
            QDialog {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:1,
                    stop:0 #0B0B18,
                    stop:0.5 #14102A,
                    stop:1 #1B1238
                );
            }}
        """)

        layout = QVBoxLayout()
        layout.setSpacing(16)
        layout.setContentsMargins(28, 22, 28, 22)

        machine_code = license_manager.get_machine_code()

        # ----- Title -----
        title_row = QHBoxLayout()
        title_row.setSpacing(10)

        icon = QLabel("✦")
        icon.setStyleSheet(
            f"color: {COLORS['accent']}; font-size: 24px; font-weight: 900;"
        )
        title_row.addWidget(icon)

        title = QLabel("软件激活")
        title.setFont(QFont("Microsoft YaHei UI", 18, QFont.Bold))
        title.setStyleSheet(f"color: {COLORS['text_primary']};")
        title_row.addWidget(title)
        title_row.addStretch(1)

        layout.addLayout(title_row)

        # ----- License info card -----
        info_card = CardFrame()
        info_layout = QVBoxLayout()
        info_layout.setSpacing(10)
        info_layout.setContentsMargins(18, 16, 18, 16)

        info_title = QLabel("● 许可证信息")
        info_title.setFont(QFont("Microsoft YaHei UI", 12, QFont.Bold))
        info_title.setStyleSheet(f"color: {COLORS['accent_hover']};")
        info_layout.addWidget(info_title)

        # Machine code row with copy button
        machine_row = QHBoxLayout()
        machine_row.setSpacing(8)

        machine_label = QLabel(f"机器码  {machine_code}")
        machine_label.setStyleSheet(f"""
            QLabel {{
                font-family: {MONO_FAMILY};
                font-size: 12px;
                color: {COLORS["text_secondary"]};
                background-color: {COLORS["bg_input"]};
                padding: 10px 12px;
                border-radius: 8px;
                border: 1px solid {COLORS["border"]};
            }}
        """)
        machine_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        machine_row.addWidget(machine_label, 1)

        copy_btn = QPushButton("复制")
        copy_btn.setCursor(Qt.PointingHandCursor)
        copy_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                color: {COLORS["text_secondary"]};
                border: 1px solid {COLORS["border_light"]};
                border-radius: 8px;
                padding: 8px 14px;
                font-weight: 600;
                font-size: 12px;
            }}
            QPushButton:hover {{
                border-color: {COLORS["accent"]};
                color: {COLORS["accent"]};
            }}
        """)
        copy_btn.clicked.connect(lambda: self._copy_to_clipboard(machine_code))
        machine_row.addWidget(copy_btn)

        info_layout.addLayout(machine_row)

        status_label = QLabel("状态  未激活 · 试用模式")
        status_label.setStyleSheet(f"""
            QLabel {{
                color: {COLORS["warning"]};
                font-weight: 700;
                font-size: 12px;
                background-color: {COLORS["warning_soft"]};
                padding: 8px 12px;
                border-radius: 8px;
                border: 1px solid {COLORS["warning"]};
            }}
        """)
        status_label.setAlignment(Qt.AlignCenter)
        info_layout.addWidget(status_label)

        info_card.setLayout(info_layout)
        layout.addWidget(info_card)

        # ----- Activation card -----
        activation_card = CardFrame()
        activation_layout = QVBoxLayout()
        activation_layout.setSpacing(12)
        activation_layout.setContentsMargins(18, 16, 18, 16)

        activation_title = QLabel("● 输入激活码")
        activation_title.setFont(QFont("Microsoft YaHei UI", 12, QFont.Bold))
        activation_title.setStyleSheet(f"color: {COLORS['accent_hover']};")
        activation_layout.addWidget(activation_title)

        self.activation_input = QLineEdit()
        self.activation_input.setPlaceholderText(
            "格式：XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
        )
        self.activation_input.setMinimumHeight(42)
        self.activation_input.setStyleSheet(f"""
            QLineEdit {{
                padding: 10px 14px;
                font-size: 13px;
                font-family: {MONO_FAMILY};
                background-color: {COLORS["bg_input"]};
                color: {COLORS["text_primary"]};
                border: 1px solid {COLORS["border"]};
                border-radius: 10px;
            }}
            QLineEdit:focus {{
                border-color: {COLORS["accent"]};
            }}
        """)
        activation_layout.addWidget(self.activation_input)

        activate_btn = QPushButton("✓  立即激活")
        activate_btn.setCursor(Qt.PointingHandCursor)
        activate_btn.setMinimumHeight(44)
        activate_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 {COLORS["success"]},
                    stop:1 {COLORS["success_hover"]}
                );
                color: white;
                padding: 10px;
                font-weight: 700;
                font-size: 14px;
                border-radius: 10px;
                border: 1px solid {COLORS["success"]};
            }}
            QPushButton:hover {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 #34D399,
                    stop:1 {COLORS["success"]}
                );
            }}
            QPushButton:pressed {{
                background-color: {COLORS["success_hover"]};
            }}
        """)
        activate_btn.clicked.connect(self.activate)
        activation_layout.addWidget(activate_btn)

        activation_card.setLayout(activation_layout)
        layout.addWidget(activation_card)

        # ----- Trial button -----
        trial_btn = QPushButton("⏳  试用 7 天")
        trial_btn.setCursor(Qt.PointingHandCursor)
        trial_btn.setMinimumHeight(44)
        trial_btn.setStyleSheet(f"""
            QPushButton {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 {COLORS["accent_grad_a"]},
                    stop:1 {COLORS["accent_grad_b"]}
                );
                color: white;
                padding: 10px;
                font-weight: 700;
                font-size: 14px;
                border-radius: 10px;
                border: 1px solid {COLORS["accent"]};
            }}
            QPushButton:hover {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 {COLORS["accent_hover"]},
                    stop:1 {COLORS["accent_grad_a"]}
                );
            }}
            QPushButton:pressed {{
                background-color: {COLORS["accent_grad_b"]};
            }}
        """)
        trial_btn.clicked.connect(self.start_trial)
        layout.addWidget(trial_btn)

        self.status_label = QLabel("")
        self.status_label.setAlignment(Qt.AlignCenter)
        self.status_label.setStyleSheet(
            f"color: {COLORS['error']}; font-size: 12px; padding: 4px;"
        )
        layout.addWidget(self.status_label)

        self.setLayout(layout)

    def _copy_to_clipboard(self, text: str) -> None:
        QApplication.clipboard().setText(text)
        self.status_label.setStyleSheet(
            f"color: {COLORS['success']}; font-size: 12px; padding: 4px;"
        )
        self.status_label.setText("✓ 机器码已复制到剪贴板")

    def activate(self):
        """Activate with code."""
        code = self.activation_input.text().strip()
        if not code:
            self.status_label.setStyleSheet(
                f"color: {COLORS['error']}; font-size: 12px; padding: 4px;"
            )
            self.status_label.setText("请输入激活码")
            return

        success, message = license_manager.activate_full_license(code)

        if success:
            self.status_label.setStyleSheet(
                f"color: {COLORS['success']}; font-size: 12px; padding: 4px;"
            )
            self.status_label.setText(message)
            self.activated = True
            QMessageBox.information(self, "成功", "软件激活成功！")
            self.accept()
        else:
            self.status_label.setStyleSheet(
                f"color: {COLORS['error']}; font-size: 12px; padding: 4px;"
            )
            self.status_label.setText(message)
            QMessageBox.warning(self, "失败", message)

    def start_trial(self):
        """Start trial period."""
        success, days = license_manager.start_trial()
        if success:
            QMessageBox.information(self, "试用开始", f"试用期已开始，剩余 {days} 天")
            self.accept()
