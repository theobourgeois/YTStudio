"""Render palette studies from the existing icon without changing app assets.

Run with Python 3.10+, resvg-py and Pillow: python3 design/icon-studies/render.py
"""
from pathlib import Path
import xml.etree.ElementTree as ET

import resvg_py
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PALETTES = [
    ("01-banner-blue", "Banner blue", "Royal blue / warm gold / crimson", "#207CC3", "#F5CF48", "#B61935"),
    ("02-banner-red", "Banner red", "Crimson / warm gold / azure", "#B61935", "#F5CF48", "#2584CC"),
    ("03-saffron", "Saffron", "Golden yellow / oxblood / cobalt", "#EDC64D", "#A72B3B", "#244F91"),
    ("04-midnight", "Midnight", "Deep navy / antique gold / ivory", "#192E4B", "#C9A767", "#F3EBDD"),
    ("05-parchment", "Parchment", "Warm ivory / antique gold / burgundy", "#F3EBDD", "#B59050", "#792B3E"),
    ("06-evergreen", "Evergreen", "Forest green / antique gold / ivory", "#1C4038", "#C9A767", "#F3EBDD"),
]


def shade(color, factor):
    return "#" + "".join(f"{int(int(color[i:i + 2], 16) * factor):02x}" for i in (1, 3, 5))


def font(size):
    return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)


sheet = Image.new("RGB", (1500, 1170), "#E8E5DF")
draw = ImageDraw.Draw(sheet)
draw.text((45, 30), "VAUDIO / ICON COLOR STUDIES", font=font(30), fill="#262A30")
draw.text((45, 76), "Original silhouette. Flag-inspired colors and three quieter palettes.", font=font(20), fill="#63666B")

for index, (slug, name, description, field, border, yen) in enumerate(PALETTES):
    svg = ET.parse(ROOT / "resources/icon.svg")
    children = list(svg.getroot())
    children[0].set("fill", field)
    # Fill the existing fleurs and tressure band, keeping their traced geometry.
    children[1].set("fill", border)
    children[1].set("stroke", shade(border, 0.70))
    children[2].set("fill", border)
    children[3].set("stroke", shade(border, 0.70))
    children[3].set("stroke-width", "3")
    children[4].set("fill", yen)
    children[4].set("stroke", shade(yen, 0.65))
    children[4].set("stroke-width", "18")
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    svg_path = HERE / f"{slug}.svg"
    svg.write(svg_path, encoding="unicode")
    (HERE / f"{slug}.png").write_bytes(resvg_py.svg_to_bytes(svg_path=str(svg_path)))
    icon = Image.open(HERE / f"{slug}.png").convert("RGBA")
    x, y = 30 + (index % 3) * 490, 125 + (index // 3) * 510
    draw.rounded_rectangle((x, y, x + 460, y + 480), radius=20, fill="#F6F4EF")
    large = icon.resize((345, 345), Image.Resampling.LANCZOS)
    sheet.paste(large, (x + 57, y + 5), large)
    draw.text((x + 26, y + 346), f"{index + 1:02}  {name}", font=font(26), fill="#262A30")
    draw.text((x + 26, y + 385), description, font=font(18), fill="#63666B")
    for n, color in enumerate((field, border, yen)):
        draw.ellipse((x + 26 + n * 28, y + 433, x + 44 + n * 28, y + 451), fill=color)
    small = icon.resize((64, 64), Image.Resampling.LANCZOS)
    sheet.paste(small, (x + 368, y + 413), small)

sheet.save(HERE / "comparison.png")
