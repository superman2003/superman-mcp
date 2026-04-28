"""Main application window with modern dark theme and async operations."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PyQt5.QtWidgets import (
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QGridLayout,
    QPushButton,
    QLabel,
    QRadioButton,
    QButtonGroup,
    QFileDialog,
    QMessageBox,
    QStatusBar,
    QComboBox,
    QFrame,
    QScrollArea,
    QLineEdit,
)
from PyQt5.QtCore import (
    Qt,
    QPropertyAnimation,
    QEasingCurve,
    QTimer,
    pyqtProperty,
    QThread,
    pyqtSignal,
)
from PyQt5.QtGui import QFont, QColor
from pathlib import Path
import config
from core import patcher, process, license as license_manager
from ui.license_dialog import LicenseDialog
from ui.theme import COLORS, FONT_FAMILY, MONO_FAMILY, apply_shadow, apply_glow


# Small visual metadata per membership type
MEMBERSHIP_META = {
    "free": ("🆓", "免费版", "基础功能，无付费能力"),
    "free_trial": ("🎁", "免费试用", "临时体验 Pro 能力"),
    "pro": ("⭐", "Pro", "推荐：解锁完整 Pro 特性"),
    "pro_plus": ("💎", "Pro+", "增强版：更大额度"),
    "ultra": ("🚀", "Ultra", "旗舰版：全功能"),
    "enterprise": ("🏢", "Enterprise", "企业版：团队特性"),
    "custom": ("🛠️", "自定义", "手动输入任意标识"),
}


class WorkerThread(QThread):
    """Background worker thread for non-blocking operations."""

    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def __init__(self, func, *args):
        super().__init__()
        self.func = func
        self.args = args

    def run(self):
        try:
            result = self.func(*self.args)
            self.finished.emit(result)
        except Exception as e:
            self.error.emit(str(e))


class GlowButton(QPushButton):
    """Primary button with gradient fill, rounded corners and hover glow."""

    def __init__(self, text, parent=None, color=None, variant="solid"):
        super().__init__(text, parent)
        self._glow_radius = 0
        self._base_color = color or COLORS["accent"]
        self._variant = variant  # "solid" | "ghost"
        self._setup_style()

    def _setup_style(self):
        self.setCursor(Qt.PointingHandCursor)
        self.update_style()

    @pyqtProperty(int)
    def glow_radius(self):
        return self._glow_radius

    @glow_radius.setter
    def glow_radius(self, value):
        self._glow_radius = value

    def _lighten(self, hex_color, factor=1.12):
        c = QColor(hex_color)
        h, s, l, a = c.getHslF()
        l = min(1.0, l * factor)
        c.setHslF(h, s, l, a)
        return c.name()

    def _darken(self, hex_color, factor=0.82):
        c = QColor(hex_color)
        h, s, l, a = c.getHslF()
        l = max(0.0, l * factor)
        c.setHslF(h, s, l, a)
        return c.name()

    def update_style(self):
        base = self._base_color
        hover = self._lighten(base, 1.12)
        pressed = self._darken(base, 0.88)

        if self._variant == "ghost":
            self.setStyleSheet(f"""
                QPushButton {{
                    background-color: transparent;
                    color: {COLORS["text_primary"]};
                    border: 1px solid {COLORS["border_light"]};
                    border-radius: 10px;
                    padding: 10px 18px;
                    font-weight: 600;
                    font-size: 13px;
                    min-height: 40px;
                }}
                QPushButton:hover {{
                    border-color: {base};
                    color: {base};
                    background-color: {COLORS["bg_hover"]};
                }}
                QPushButton:pressed {{
                    background-color: {COLORS["bg_card"]};
                }}
                QPushButton:disabled {{
                    color: {COLORS["text_muted"]};
                    border-color: {COLORS["border"]};
                }}
            """)
            return

        self.setStyleSheet(f"""
            QPushButton {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:1,
                    stop:0 {hover}, stop:1 {base}
                );
                color: white;
                border: 1px solid {hover};
                border-radius: 10px;
                padding: 11px 18px;
                font-weight: 600;
                font-size: 13px;
                min-height: 42px;
            }}
            QPushButton:hover {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:1,
                    stop:0 {self._lighten(base, 1.22)}, stop:1 {hover}
                );
            }}
            QPushButton:pressed {{
                background-color: {pressed};
                padding: 12px 17px 10px 19px;
            }}
            QPushButton:disabled {{
                background: {COLORS["bg_hover"]};
                color: {COLORS["text_muted"]};
                border-color: {COLORS["border"]};
            }}
        """)

    def enterEvent(self, event):
        if self._variant == "solid":
            apply_glow(self, radius=28, color=self._base_color, alpha=170)
        super().enterEvent(event)

    def leaveEvent(self, event):
        if self._variant == "solid":
            self.setGraphicsEffect(None)
        super().leaveEvent(event)


class CardFrame(QFrame):
    """Glassy card container with soft shadow."""

    def __init__(self, parent=None, padding=18):
        super().__init__(parent)
        self.setObjectName("Card")
        self._padding = padding
        self.setStyleSheet(f"""
            QFrame#Card {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:0, y2:1,
                    stop:0 {COLORS["bg_card_hi"]},
                    stop:1 {COLORS["bg_card"]}
                );
                border-radius: 16px;
                border: 1px solid {COLORS["border"]};
            }}
        """)
        apply_shadow(self, radius=40, y_offset=10, color="#000000", alpha=120)

    def showEvent(self, event):
        self.layout() and self.layout().setContentsMargins(
            self._padding, self._padding, self._padding, self._padding
        )
        super().showEvent(event)


class MembershipCard(QRadioButton):
    """A fully-clickable card styled as a radio button.

    We keep this a QRadioButton subclass so the existing
    QButtonGroup wiring keeps working without behavior changes.
    """

    def __init__(self, type_key, icon, title, subtitle, parent=None):
        display = f"{icon}  {title}  •  {type_key}\n{subtitle}"
        super().__init__(display, parent)
        self.setCursor(Qt.PointingHandCursor)
        self.setMinimumHeight(74)
        self.setStyleSheet(f"""
            QRadioButton {{
                color: {COLORS["text_primary"]};
                font-size: 13px;
                font-weight: 600;
                spacing: 10px;
                padding: 12px 14px;
                border-radius: 12px;
                border: 1px solid {COLORS["border"]};
                background-color: {COLORS["bg_secondary"]};
            }}
            QRadioButton:hover {{
                background-color: {COLORS["bg_hover"]};
                border-color: {COLORS["border_light"]};
            }}
            QRadioButton:checked {{
                background-color: {COLORS["accent_soft"]};
                border: 1px solid {COLORS["accent"]};
                color: {COLORS["text_primary"]};
            }}
            QRadioButton::indicator {{
                width: 18px;
                height: 18px;
                border-radius: 9px;
                border: 2px solid {COLORS["border_light"]};
                background-color: {COLORS["bg_input"]};
            }}
            QRadioButton::indicator:hover {{
                border-color: {COLORS["accent"]};
            }}
            QRadioButton::indicator:checked {{
                border-color: {COLORS["accent"]};
                background-color: {COLORS["accent"]};
            }}
        """)


class MainWindow(QMainWindow):
    """Main application window with modern dark theme."""

    def __init__(self):
        super().__init__()
        self.js_path = None
        self.selected_type = "pro"
        self.is_searching = False
        self._setup_window()
        self.init_ui()
        QTimer.singleShot(100, self.check_cursor_path)

    def _setup_window(self):
        """Configure main window properties."""
        self.setWindowTitle("Cursor 会员类型切换器 - Pro Edition")
        self.setMinimumSize(760, 820)
        self.resize(780, 860)
        self.setStyleSheet(f"""
            QMainWindow {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:1,
                    stop:0 #0B0B18,
                    stop:0.5 #0F0F22,
                    stop:1 #140F2A
                );
            }}
        """)

    def init_ui(self):
        # Scroll area wrapping the whole content
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setStyleSheet("QScrollArea { border: none; background: transparent; }")

        content_widget = QWidget()
        content_widget.setStyleSheet("background: transparent;")
        scroll.setWidget(content_widget)

        main_layout = QVBoxLayout()
        main_layout.setSpacing(16)
        main_layout.setContentsMargins(24, 20, 24, 20)

        # ----- Header -----
        main_layout.addWidget(self._build_header())

        # ----- Status card -----
        main_layout.addWidget(self._build_status_card())

        # ----- Membership card -----
        main_layout.addWidget(self._build_membership_card())

        # ----- Path card -----
        main_layout.addWidget(self._build_path_card())

        # ----- Action bar -----
        main_layout.addWidget(self._build_action_bar())

        # ----- Footer -----
        footer_label = QLabel("仅用于教育和研究目的 · 使用风险自负")
        footer_label.setAlignment(Qt.AlignCenter)
        footer_label.setStyleSheet(f"""
            QLabel {{
                color: {COLORS["text_muted"]};
                font-size: 11px;
                padding: 8px 0 4px 0;
                letter-spacing: 1px;
            }}
        """)
        main_layout.addWidget(footer_label)

        content_widget.setLayout(main_layout)
        self.setCentralWidget(scroll)

        # Status bar
        self.statusBar = QStatusBar()
        self.setStatusBar(self.statusBar)
        self.statusBar.showMessage("就绪")

    # -------- Header --------

    def _build_header(self) -> QWidget:
        header_frame = QFrame()
        header_frame.setObjectName("Header")
        header_frame.setStyleSheet(f"""
            QFrame#Header {{
                background-color: qlineargradient(
                    x1:0, y1:0, x2:1, y2:0,
                    stop:0 {COLORS["bg_card"]},
                    stop:0.5 #241B44,
                    stop:1 {COLORS["bg_card"]}
                );
                border-radius: 18px;
                border: 1px solid {COLORS["border"]};
            }}
        """)
        apply_shadow(header_frame, radius=44, y_offset=12, color="#8B5CF6", alpha=70)

        header_layout = QVBoxLayout()
        header_layout.setSpacing(8)
        header_layout.setContentsMargins(22, 18, 22, 18)

        title_row = QHBoxLayout()
        title_row.setSpacing(12)

        icon_label = QLabel("✦")
        icon_label.setStyleSheet(f"""
            QLabel {{
                color: {COLORS["accent"]};
                font-size: 26px;
                font-weight: 900;
                padding: 0 6px;
            }}
        """)
        title_row.addWidget(icon_label)

        title_col = QVBoxLayout()
        title_col.setSpacing(2)

        title = QLabel("Cursor 会员类型切换器")
        title.setFont(QFont("Microsoft YaHei UI", 18, QFont.Bold))
        title.setStyleSheet(f"color: {COLORS['text_primary']};")
        title_col.addWidget(title)

        subtitle = QLabel("切换 / 应用 / 恢复 Cursor 本地 workbench 补丁")
        subtitle.setStyleSheet(
            f"color: {COLORS['text_secondary']}; font-size: 12px; letter-spacing: 1px;"
        )
        title_col.addWidget(subtitle)

        title_row.addLayout(title_col, 1)

        # License badge
        try:
            license_info = license_manager.load_license()
            if license_info and license_info.get("type") == "full":
                text = "✓ 已激活 · 完整版"
                fg = COLORS["success"]
                bg = COLORS["success_soft"]
                border = COLORS["success"]
            else:
                is_valid, days = license_manager.check_trial()
                text = f"⏳ 试用中 · 剩余 {days} 天"
                fg = COLORS["warning"]
                bg = COLORS["warning_soft"]
                border = COLORS["warning"]
        except Exception:
            text = "⏳ 试用模式"
            fg = COLORS["warning"]
            bg = COLORS["warning_soft"]
            border = COLORS["warning"]

        license_label = QLabel(text)
        license_label.setStyleSheet(f"""
            QLabel {{
                color: {fg};
                font-weight: 700;
                font-size: 12px;
                padding: 6px 14px;
                border-radius: 14px;
                background-color: {bg};
                border: 1px solid {border};
            }}
        """)
        title_row.addWidget(license_label, 0, Qt.AlignRight | Qt.AlignVCenter)

        header_layout.addLayout(title_row)
        header_frame.setLayout(header_layout)
        return header_frame

    # -------- Status card --------

    def _build_status_card(self) -> QWidget:
        card = CardFrame()
        layout = QVBoxLayout()
        layout.setSpacing(10)
        layout.setContentsMargins(20, 18, 20, 18)

        title = QLabel("● 当前状态")
        title.setFont(QFont("Microsoft YaHei UI", 12, QFont.Bold))
        title.setStyleSheet(f"color: {COLORS['accent_hover']};")
        layout.addWidget(title)

        self.status_label = QLabel("正在检测...")
        self.status_label.setFont(QFont("Microsoft YaHei UI", 13))
        self.status_label.setAlignment(Qt.AlignCenter)
        self.status_label.setStyleSheet(f"""
            QLabel {{
                background-color: {COLORS["bg_secondary"]};
                border: 1px solid {COLORS["border"]};
                border-radius: 10px;
                padding: 12px;
                color: {COLORS["text_secondary"]};
            }}
        """)
        layout.addWidget(self.status_label)

        self.cursor_path_label = QLabel("路径: 检测中...")
        self.cursor_path_label.setStyleSheet(f"""
            QLabel {{
                color: {COLORS["text_muted"]};
                font-size: 11px;
                font-family: {MONO_FAMILY};
                padding: 2px 4px;
            }}
        """)
        self.cursor_path_label.setWordWrap(True)
        layout.addWidget(self.cursor_path_label)

        card.setLayout(layout)
        return card

    # -------- Membership card --------

    def _build_membership_card(self) -> QWidget:
        card = CardFrame()
        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.setContentsMargins(20, 18, 20, 18)

        title = QLabel("● 选择会员类型")
        title.setFont(QFont("Microsoft YaHei UI", 12, QFont.Bold))
        title.setStyleSheet(f"color: {COLORS['accent_hover']};")
        layout.addWidget(title)

        self.membership_buttons = QButtonGroup()
        self.type_radio_buttons = {}

        grid = QGridLayout()
        grid.setSpacing(10)
        grid.setContentsMargins(0, 4, 0, 4)

        membership_list = list(config.MEMBERSHIP_TYPES.items())
        columns = 2
        for idx, (type_key, type_label) in enumerate(membership_list):
            meta = MEMBERSHIP_META.get(
                type_key, ("🏷️", type_label, f"会员类型：{type_label}")
            )
            icon, title_text, subtitle = meta
            # Prefer the label from config over our local title text to stay in sync
            card_btn = MembershipCard(type_key, icon, type_label, subtitle)
            card_btn.setProperty("type_key", type_key)

            self.membership_buttons.addButton(card_btn, idx)
            self.type_radio_buttons[type_key] = card_btn

            if type_key == "pro":
                card_btn.setChecked(True)
                self.selected_type = type_key

            row = idx // columns
            col = idx % columns
            grid.addWidget(card_btn, row, col)

        layout.addLayout(grid)

        # Custom type input (hidden by default)
        custom_frame = QFrame()
        custom_frame.setStyleSheet(f"""
            QFrame {{
                background-color: {COLORS["bg_secondary"]};
                border-radius: 10px;
                border: 1px solid {COLORS["border"]};
                padding: 6px;
            }}
        """)
        custom_layout = QHBoxLayout()
        custom_layout.setSpacing(10)
        custom_layout.setContentsMargins(10, 8, 10, 8)

        custom_label = QLabel("自定义值")
        custom_label.setStyleSheet(
            f"color: {COLORS['text_secondary']}; font-size: 12px; font-weight: 600;"
        )
        custom_layout.addWidget(custom_label)

        self.custom_type_input = QLineEdit()
        self.custom_type_input.setPlaceholderText(
            "输入自定义会员类型 (如: custom_pro 或 中文名称)"
        )
        self.custom_type_input.setStyleSheet(f"""
            QLineEdit {{
                background-color: {COLORS["bg_input"]};
                color: {COLORS["text_primary"]};
                border: 1px solid {COLORS["border"]};
                border-radius: 8px;
                padding: 8px 12px;
                font-size: 12px;
                font-family: {MONO_FAMILY};
            }}
            QLineEdit:focus {{
                border-color: {COLORS["accent"]};
            }}
        """)
        self.custom_type_input.textChanged.connect(self.on_custom_type_changed)
        custom_layout.addWidget(self.custom_type_input, 1)

        custom_frame.setLayout(custom_layout)
        custom_frame.setVisible(False)
        self.custom_frame = custom_frame
        layout.addWidget(custom_frame)

        card.setLayout(layout)

        self.membership_buttons.buttonClicked.connect(self.on_membership_selected)
        return card

    # -------- Path card --------

    def _build_path_card(self) -> QWidget:
        card = CardFrame()
        layout = QVBoxLayout()
        layout.setSpacing(12)
        layout.setContentsMargins(20, 18, 20, 18)

        title = QLabel("● Cursor 安装路径")
        title.setFont(QFont("Microsoft YaHei UI", 12, QFont.Bold))
        title.setStyleSheet(f"color: {COLORS['accent_hover']};")
        layout.addWidget(title)

        self.path_combo = QComboBox()
        self.path_combo.setEditable(True)
        self.path_combo.setMinimumHeight(40)
        self.path_combo.currentTextChanged.connect(self.on_path_selected)
        self.path_combo.setStyleSheet(f"""
            QComboBox {{
                background-color: {COLORS["bg_input"]};
                color: {COLORS["text_primary"]};
                border: 1px solid {COLORS["border"]};
                border-radius: 10px;
                padding: 8px 12px;
                font-size: 12px;
                font-family: {MONO_FAMILY};
            }}
            QComboBox:hover {{
                border-color: {COLORS["border_light"]};
            }}
            QComboBox:focus {{
                border-color: {COLORS["accent"]};
            }}
            QComboBox::drop-down {{
                border: none;
                width: 28px;
            }}
            QComboBox::down-arrow {{
                image: none;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 6px solid {COLORS["text_secondary"]};
                margin-right: 10px;
            }}
            QComboBox QAbstractItemView {{
                background-color: {COLORS["bg_card"]};
                color: {COLORS["text_primary"]};
                selection-background-color: {COLORS["accent"]};
                selection-color: white;
                border: 1px solid {COLORS["border"]};
                border-radius: 8px;
                outline: none;
                padding: 4px;
            }}
        """)
        layout.addWidget(self.path_combo)

        buttons_row = QHBoxLayout()
        buttons_row.setSpacing(10)

        self.refresh_btn = GlowButton("⟳  刷新检测", color=COLORS["accent"])
        self.refresh_btn.setMinimumWidth(140)
        self.refresh_btn.clicked.connect(self.refresh_path_list)
        buttons_row.addWidget(self.refresh_btn)

        browse_btn = GlowButton("📂  浏览...", variant="ghost")
        browse_btn.setMinimumWidth(140)
        browse_btn.clicked.connect(self.browse_path)
        buttons_row.addWidget(browse_btn)

        buttons_row.addStretch(1)
        layout.addLayout(buttons_row)

        card.setLayout(layout)
        return card

    # -------- Action bar --------

    def _build_action_bar(self) -> QWidget:
        frame = QFrame()
        frame.setObjectName("Actions")
        frame.setStyleSheet(f"""
            QFrame#Actions {{
                background-color: {COLORS["bg_card"]};
                border-radius: 16px;
                border: 1px solid {COLORS["border"]};
            }}
        """)
        apply_shadow(frame, radius=36, y_offset=8, color="#000000", alpha=110)

        layout = QHBoxLayout()
        layout.setSpacing(10)
        layout.setContentsMargins(16, 14, 16, 14)

        apply_btn = GlowButton("✓  应用补丁", color=COLORS["success"])
        apply_btn.setMinimumWidth(150)
        apply_btn.clicked.connect(self.apply_patch)
        layout.addWidget(apply_btn)

        restore_btn = GlowButton("↺  恢复原版", color=COLORS["error"])
        restore_btn.setMinimumWidth(150)
        restore_btn.clicked.connect(self.restore_patch)
        layout.addWidget(restore_btn)

        restart_btn = GlowButton("▶  重启 Cursor", color=COLORS["info"])
        restart_btn.setMinimumWidth(150)
        restart_btn.clicked.connect(self.restart_cursor)
        layout.addWidget(restart_btn)

        frame.setLayout(layout)
        return frame

    # ======================================================================
    # Business logic (unchanged except for using theme COLORS in status style)
    # ======================================================================

    def check_cursor_path(self):
        """Detect Cursor JS path asynchronously."""
        self.refresh_path_list()

    def refresh_path_list(self):
        """Refresh the list of detected Cursor installations (async)."""
        if self.is_searching:
            return

        self.is_searching = True
        self.statusBar.showMessage("正在检测 Cursor 安装路径...")
        self.cursor_path_label.setText("路径: 检测中...")
        self.refresh_btn.setEnabled(False)
        self.refresh_btn.setText("⏳  检测中...")

        self.worker = WorkerThread(patcher.find_cursor_js_path_quick)
        self.worker.finished.connect(self.on_search_finished)
        self.worker.error.connect(self.on_search_error)
        self.worker.start()

    def on_search_finished(self, js_path):
        """Handle search completion."""
        self.is_searching = False
        self.refresh_btn.setEnabled(True)
        self.refresh_btn.setText("⟳  刷新检测")

        if js_path:
            self.js_path = js_path
            self.path_combo.clear()
            display_path = str(js_path)
            if len(display_path) > 60:
                display_path = "..." + display_path[-57:]
            self.path_combo.addItem(display_path, userData=str(js_path))
            self.path_combo.setCurrentIndex(0)
            self.cursor_path_label.setText(f"完整路径: {js_path}")
            self.statusBar.showMessage("已找到 Cursor 安装")
            self.refresh_status()
        else:
            self.path_combo.clear()
            self.path_combo.addItem("未找到 Cursor 安装，请手动浏览选择")
            self.path_combo.setEnabled(False)
            self.statusBar.showMessage("未找到 Cursor 文件，请手动选择")
            self.js_path = None
            self.cursor_path_label.setText("路径: 未找到")

    def on_search_error(self, error_msg):
        """Handle search error."""
        self.is_searching = False
        self.refresh_btn.setEnabled(True)
        self.refresh_btn.setText("⟳  刷新检测")
        self.statusBar.showMessage(f"检测失败: {error_msg}")
        self.cursor_path_label.setText(f"路径: 错误 - {error_msg}")

    def on_path_selected(self, path_text):
        """Handle path selection from dropdown."""
        if not path_text or "未找到" in path_text:
            return

        index = self.path_combo.currentIndex()
        full_path = self.path_combo.itemData(index) if index >= 0 else None

        # The display text may be a truncated "..." + tail form, so never use it
        # as a real path. Only trust userData, or fall back to a user-typed full
        # path (editable combo) that doesn't start with the truncation marker.
        if full_path:
            self.js_path = Path(full_path)
        elif path_text.startswith("..."):
            return
        else:
            self.js_path = Path(path_text)

        self.cursor_path_label.setText(f"完整路径: {self.js_path}")
        self.refresh_status()

    def browse_path(self):
        """Browse for custom Cursor path."""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "选择 workbench.desktop.main.js",
            "",
            "JavaScript Files (*.js);;All Files (*)",
        )

        if not file_path:
            return

        self.js_path = Path(file_path)
        display = file_path if len(file_path) <= 60 else "..." + file_path[-57:]

        # Look up by userData (full path), not by the possibly-truncated display text
        index = self.path_combo.findData(file_path)
        if index == -1:
            # Re-enable the combo in case a previous search cleared it
            self.path_combo.setEnabled(True)
            self.path_combo.addItem(display, userData=file_path)
            index = self.path_combo.count() - 1

        self.path_combo.setCurrentIndex(index)
        self.cursor_path_label.setText(f"完整路径: {file_path}")
        self.refresh_status()
        self.statusBar.showMessage("已选择自定义路径")

    def on_membership_selected(self, button):
        """Handle membership type selection."""
        for type_key, radio in self.type_radio_buttons.items():
            if radio.isChecked():
                self.selected_type = type_key
                if type_key == "custom":
                    self.custom_frame.setVisible(True)
                    custom_val = self.custom_type_input.text().strip()
                    self.selected_type = custom_val if custom_val else "custom"
                else:
                    self.custom_frame.setVisible(False)
                break

    def on_custom_type_changed(self, text):
        """Handle custom type input change."""
        if self.selected_type == "custom" or (
            hasattr(self, "custom_frame") and self.custom_frame.isVisible()
        ):
            custom_val = text.strip()
            if custom_val:
                self.selected_type = custom_val

    def _set_status_style(self, fg_key: str, bg_soft_key: str):
        self.status_label.setStyleSheet(f"""
            QLabel {{
                font-size: 14px;
                padding: 14px;
                background-color: {COLORS[bg_soft_key]};
                border: 1px solid {COLORS[fg_key]};
                border-radius: 10px;
                color: {COLORS[fg_key]};
                font-weight: bold;
            }}
        """)

    def refresh_status(self):
        """Refresh patch status display."""
        if not self.js_path or not self.js_path.exists():
            self.status_label.setText("✖  错误：未找到 JS 文件")
            self._set_status_style("error", "error_soft")
            return

        status = patcher.get_patch_status(self.js_path)

        if status.get("error"):
            self.status_label.setText(f"✖  错误：{status['error']}")
            self._set_status_style("error", "error_soft")
            return

        if status["is_patched"]:
            type_name = config.MEMBERSHIP_TYPES.get(
                status["membership_type"], status["membership_type"]
            )
            self.status_label.setText(f"✓  已补丁：{type_name}")
            self._set_status_style("success", "success_soft")
            if status["membership_type"] in self.type_radio_buttons:
                self.type_radio_buttons[status["membership_type"]].setChecked(True)
                if status["membership_type"] == "custom":
                    self.custom_frame.setVisible(True)
                    self.custom_type_input.setText(status["membership_type"])
            elif status["membership_type"]:
                self.selected_type = status["membership_type"]
                self.custom_frame.setVisible(True)
                self.custom_type_input.setText(status["membership_type"])
                if "custom" in self.type_radio_buttons:
                    self.type_radio_buttons["custom"].setChecked(True)
        else:
            self.status_label.setText("⚠  状态：未补丁（原始文件）")
            self._set_status_style("warning", "warning_soft")

    def apply_patch(self):
        """Apply the membership patch."""
        if not self.js_path:
            QMessageBox.warning(self, "错误", "未找到 Cursor JS 文件")
            return

        if not self.js_path.exists():
            QMessageBox.warning(self, "错误", "JS 文件不存在")
            return

        if process.is_cursor_running():
            reply = QMessageBox.question(
                self,
                "Cursor 正在运行",
                "Cursor 正在运行中。是否自动关闭 Cursor 以应用补丁？",
                QMessageBox.Yes | QMessageBox.No,
            )

            if reply == QMessageBox.Yes:
                if not process.close_cursor():
                    QMessageBox.warning(
                        self, "错误", "无法关闭 Cursor，请手动关闭后重试"
                    )
                    return
            else:
                return

        success, message = patcher.apply_patch(self.js_path, self.selected_type)

        if success:
            self.statusBar.showMessage(message)
            QMessageBox.information(
                self, "成功", f"{message}\n\n请重启 Cursor 以使更改生效"
            )
            self.refresh_status()
        else:
            QMessageBox.critical(self, "错误", message)

    def restore_patch(self):
        """Restore original file."""
        if not self.js_path:
            QMessageBox.warning(self, "错误", "未找到 Cursor JS 文件")
            return

        status = patcher.get_patch_status(self.js_path)
        if not status["has_backup"]:
            QMessageBox.warning(self, "错误", "未找到备份文件，无法恢复")
            return

        if process.is_cursor_running():
            reply = QMessageBox.question(
                self,
                "Cursor 正在运行",
                "Cursor 正在运行中。是否自动关闭 Cursor 以恢复文件？",
                QMessageBox.Yes | QMessageBox.No,
            )

            if reply == QMessageBox.Yes:
                if not process.close_cursor():
                    QMessageBox.warning(
                        self, "错误", "无法关闭 Cursor，请手动关闭后重试"
                    )
                    return
            else:
                return

        success, message = patcher.remove_patch(self.js_path)

        if success:
            self.statusBar.showMessage(message)
            QMessageBox.information(
                self, "成功", f"{message}\n\n请重启 Cursor 以使更改生效"
            )
            self.refresh_status()
        else:
            QMessageBox.critical(self, "错误", message)

    def restart_cursor(self):
        """Restart Cursor application."""
        if process.is_cursor_running():
            process.force_close_cursor()

        self.statusBar.showMessage("正在启动 Cursor...")

        import subprocess

        try:
            # Derive Cursor.exe path from JS file path
            # JS path: <install_dir>/resources/app/out/vs/workbench/workbench.desktop.main.js
            # Exe path: <install_dir>/Cursor.exe
            if self.js_path and self.js_path.exists():
                install_dir = self.js_path.parent.parent.parent.parent.parent
                cursor_exe = install_dir / "Cursor.exe"
                if cursor_exe.exists():
                    subprocess.Popen([str(cursor_exe)])
                    self.statusBar.showMessage("Cursor 已启动")
                    return
                cursor_exe_lower = install_dir / "cursor.exe"
                if cursor_exe_lower.exists():
                    subprocess.Popen([str(cursor_exe_lower)])
                    self.statusBar.showMessage("Cursor 已启动")
                    return

            common_paths = [
                Path(os.environ.get("LOCALAPPDATA", ""))
                / "Programs"
                / "cursor"
                / "Cursor.exe",
                Path(os.environ.get("LOCALAPPDATA", ""))
                / "Programs"
                / "Cursor"
                / "Cursor.exe",
                Path("C:/Program Files/Cursor/Cursor.exe"),
            ]
            for exe_path in common_paths:
                if exe_path.exists():
                    subprocess.Popen([str(exe_path)])
                    self.statusBar.showMessage("Cursor 已启动")
                    return

            subprocess.Popen(["cursor"])
            self.statusBar.showMessage("Cursor 已启动")
        except Exception as e:
            self.statusBar.showMessage(f"启动失败: {str(e)}")
            QMessageBox.warning(self, "错误", f"无法启动 Cursor: {str(e)}")
