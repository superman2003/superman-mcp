"""Shared visual theme for Cursor Membership Switcher.

Dark glassmorphism palette with purple neon accents.
Keep this file UI-only; no business logic here.
"""

from PyQt5.QtWidgets import QGraphicsDropShadowEffect, QWidget
from PyQt5.QtGui import QColor


COLORS = {
    # Base surfaces (deep navy/indigo with a cool tint)
    "bg_primary": "#0F0F1A",
    "bg_secondary": "#15152A",
    "bg_card": "#1B1B35",
    "bg_card_hi": "#22223F",
    "bg_hover": "#2A2A4A",
    "bg_input": "#12122A",

    # Text
    "text_primary": "#F5F5FB",
    "text_secondary": "#B4B4CC",
    "text_muted": "#6E6E8A",

    # Brand / accent (violet neon)
    "accent": "#8B5CF6",
    "accent_hover": "#A78BFA",
    "accent_soft": "#8B5CF622",
    "accent_grad_a": "#8B5CF6",
    "accent_grad_b": "#6366F1",

    # Semantic
    "success": "#22C55E",
    "success_hover": "#16A34A",
    "success_soft": "#22C55E22",
    "warning": "#F59E0B",
    "warning_soft": "#F59E0B22",
    "error": "#EF4444",
    "error_hover": "#DC2626",
    "error_soft": "#EF444422",
    "info": "#38BDF8",
    "info_soft": "#38BDF822",

    # Borders
    "border": "#2B2B4D",
    "border_light": "#3A3A60",
    "border_focus": "#8B5CF6",
}


FONT_FAMILY = "'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', sans-serif"
MONO_FAMILY = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"


def apply_shadow(
    widget: QWidget,
    radius: int = 32,
    y_offset: int = 8,
    color: str = "#000000",
    alpha: int = 140,
) -> QGraphicsDropShadowEffect:
    """Attach a soft drop shadow to a widget and return the effect."""
    effect = QGraphicsDropShadowEffect(widget)
    effect.setBlurRadius(radius)
    effect.setOffset(0, y_offset)
    qc = QColor(color)
    qc.setAlpha(alpha)
    effect.setColor(qc)
    widget.setGraphicsEffect(effect)
    return effect


def apply_glow(
    widget: QWidget,
    radius: int = 24,
    color: str = "#8B5CF6",
    alpha: int = 160,
) -> QGraphicsDropShadowEffect:
    """Attach a colored glow (used for primary buttons)."""
    effect = QGraphicsDropShadowEffect(widget)
    effect.setBlurRadius(radius)
    effect.setOffset(0, 0)
    qc = QColor(color)
    qc.setAlpha(alpha)
    effect.setColor(qc)
    widget.setGraphicsEffect(effect)
    return effect


def global_qss() -> str:
    """Return the global QSS string to be applied on QApplication."""
    c = COLORS
    return f"""
    * {{
        font-family: {FONT_FAMILY};
        outline: none;
    }}

    QWidget {{
        color: {c["text_primary"]};
    }}

    QMainWindow, QDialog {{
        background-color: {c["bg_primary"]};
    }}

    /* ---------- ToolTip ---------- */
    QToolTip {{
        background-color: {c["bg_card_hi"]};
        color: {c["text_primary"]};
        border: 1px solid {c["border"]};
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
    }}

    /* ---------- MessageBox ---------- */
    QMessageBox {{
        background-color: {c["bg_secondary"]};
        color: {c["text_primary"]};
    }}
    QMessageBox QLabel {{
        color: {c["text_primary"]};
        font-size: 13px;
    }}
    QMessageBox QPushButton {{
        background-color: {c["bg_card"]};
        color: {c["text_primary"]};
        border: 1px solid {c["border_light"]};
        border-radius: 8px;
        padding: 8px 18px;
        min-width: 76px;
        font-weight: 600;
    }}
    QMessageBox QPushButton:hover {{
        background-color: {c["bg_hover"]};
        border-color: {c["accent"]};
    }}
    QMessageBox QPushButton:default {{
        background-color: {c["accent"]};
        border-color: {c["accent"]};
        color: white;
    }}
    QMessageBox QPushButton:default:hover {{
        background-color: {c["accent_hover"]};
    }}

    /* ---------- Menu ---------- */
    QMenu {{
        background-color: {c["bg_card"]};
        color: {c["text_primary"]};
        border: 1px solid {c["border"]};
        border-radius: 8px;
        padding: 6px;
    }}
    QMenu::item {{
        padding: 6px 18px;
        border-radius: 6px;
    }}
    QMenu::item:selected {{
        background-color: {c["accent_soft"]};
        color: {c["text_primary"]};
    }}

    /* ---------- ScrollBar ---------- */
    QScrollBar:vertical {{
        border: none;
        background: transparent;
        width: 10px;
        margin: 4px 2px 4px 0;
    }}
    QScrollBar::handle:vertical {{
        background: {c["border_light"]};
        border-radius: 4px;
        min-height: 32px;
    }}
    QScrollBar::handle:vertical:hover {{
        background: {c["accent"]};
    }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
        height: 0px;
    }}
    QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
        background: transparent;
    }}

    QScrollBar:horizontal {{
        border: none;
        background: transparent;
        height: 10px;
        margin: 0 4px 2px 4px;
    }}
    QScrollBar::handle:horizontal {{
        background: {c["border_light"]};
        border-radius: 4px;
        min-width: 32px;
    }}
    QScrollBar::handle:horizontal:hover {{
        background: {c["accent"]};
    }}
    QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
        width: 0px;
    }}

    /* ---------- StatusBar ---------- */
    QStatusBar {{
        background-color: {c["bg_secondary"]};
        color: {c["text_secondary"]};
        border-top: 1px solid {c["border"]};
    }}
    QStatusBar::item {{
        border: none;
    }}
    """
