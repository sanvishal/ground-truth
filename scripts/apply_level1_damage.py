#!/usr/bin/env python3
"""Apply the approved Level 1 damage without touching any other room pixel."""

from pathlib import Path
import sys

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_PATH = PROJECT_ROOT / "public/assets/art/level1/integrated-room-A-runtime.png"
OUTPUT_PATH = PROJECT_ROOT / "public/assets/art/level1/integrated-room-A-damage-v2.png"

BLOOD_BOX = (220, 285, 520, 370)
FLOOR_BOX = (560, 275, 685, 360)
WALL_BOX = (895, 105, 940, 160)


def inside(box: tuple[int, int, int, int], x: int, y: int) -> bool:
    left, top, right, bottom = box
    return left <= x <= right and top <= y <= bottom


def blend(base: tuple[int, int, int, int], color: tuple[int, int, int], opacity: float) -> tuple[int, int, int, int]:
    return (
        round(base[0] * (1 - opacity) + color[0] * opacity),
        round(base[1] * (1 - opacity) + color[1] * opacity),
        round(base[2] * (1 - opacity) + color[2] * opacity),
        base[3],
    )


def draw_rect(
    image: Image.Image,
    rect: tuple[int, int, int, int],
    color: tuple[int, int, int],
    opacity: float,
) -> None:
    x, y, width, height = rect
    for py in range(y, y + height):
        for px in range(x, x + width):
            image.putpixel((px, py), blend(image.getpixel((px, py)), color, opacity))


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: apply_level1_damage.py GENERATED_DAMAGE_REFERENCE.png")

    source = Image.open(SOURCE_PATH).convert("RGBA")
    generated = Image.open(sys.argv[1]).convert("RGBA").resize(source.size, Image.Resampling.NEAREST)
    output = source.copy()

    # Extract only dark-maroon pixels from the approved floor rectangle. This
    # retains the generated splat/streak shapes without accepting any generated
    # room geometry, lighting, or material changes.
    for y in range(BLOOD_BOX[1], BLOOD_BOX[3] + 1):
        for x in range(BLOOD_BOX[0], BLOOD_BOX[2] + 1):
            red, green, blue, _ = generated.getpixel((x, y))
            if 18 <= red <= 160 and red > green * 1.1 and red > blue * 0.95:
                dried = (min(150, round(red * 1.22)), round(green * 0.82), round(blue * 0.86))
                output.putpixel((x, y), blend(output.getpixel((x, y)), dried, 0.97))

    dark = (7, 11, 15)
    crack = (8, 13, 18)
    steel = (86, 98, 106)

    # Existing hatch only: two chipped corners, one torn lip, and short cracks.
    floor_damage = [
        ((570, 286, 4, 3), dark, 0.96), ((574, 288, 5, 2), dark, 0.96),
        ((646, 316, 5, 3), dark, 0.96), ((650, 319, 6, 2), dark, 0.96),
        ((655, 321, 2, 5), dark, 0.96), ((657, 326, 7, 2), dark, 0.96),
        ((663, 328, 2, 5), dark, 0.96), ((665, 332, 5, 3), dark, 0.96),
        ((670, 334, 4, 2), dark, 0.96), ((649, 315, 3, 1), steel, 0.72),
        ((652, 318, 4, 1), steel, 0.68), ((657, 309, 5, 1), crack, 0.92),
        ((662, 310, 1, 4), crack, 0.92), ((663, 314, 4, 1), crack, 0.92),
        ((667, 315, 1, 4), crack, 0.92), ((668, 319, 4, 1), crack, 0.92),
        ((672, 320, 1, 4), crack, 0.92), ((673, 323, 6, 1), crack, 0.92),
        ((678, 324, 1, 4), crack, 0.92),
    ]
    for rect, color, opacity in floor_damage:
        draw_rect(output, rect, color, opacity)

    # Two sparse stair-stepped cracks on an otherwise quiet right-wall strip.
    wall_damage = [
        ((902, 116, 1, 6), crack, 0.88), ((903, 121, 4, 1), crack, 0.88),
        ((907, 122, 1, 5), crack, 0.88), ((908, 126, 4, 1), crack, 0.88),
        ((911, 127, 1, 5), crack, 0.88), ((918, 139, 5, 1), crack, 0.86),
        ((922, 140, 1, 5), crack, 0.86), ((923, 144, 4, 1), crack, 0.86),
        ((926, 145, 1, 4), crack, 0.86), ((908, 126, 1, 1), steel, 0.54),
    ]
    for rect, color, opacity in wall_damage:
        draw_rect(output, rect, color, opacity)

    outside_changes = 0
    total_changes = 0
    for y in range(source.height):
        for x in range(source.width):
            if source.getpixel((x, y)) == output.getpixel((x, y)):
                continue
            total_changes += 1
            if not (inside(BLOOD_BOX, x, y) or inside(FLOOR_BOX, x, y) or inside(WALL_BOX, x, y)):
                outside_changes += 1

    if outside_changes:
        raise RuntimeError(f"surgical edit escaped its masks: {outside_changes} pixels")

    output.save(OUTPUT_PATH)
    print(f"{OUTPUT_PATH}\nchanged pixels: {total_changes}; outside masks: {outside_changes}")


if __name__ == "__main__":
    main()
