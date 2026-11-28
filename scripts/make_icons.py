"""Monet Chat launcher / brand icon generator.

Design: warm ivory ground, deep ink speech bubble, one terracotta dot.
No gradients, no glow, no tiny detail: it stays readable at 48 px and the
monochrome layer gives Android / Nothing OS a proper themed icon.
"""
from PIL import Image, ImageDraw
import os

S = 1024
IVORY = (245, 239, 230, 255)
INK = (30, 27, 24, 255)
ACCENT = (217, 119, 87, 255)

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
ANDROID = os.path.join(os.path.dirname(__file__), "..", "android", "app", "src", "main", "res")


def rounded_mask(size, radius_ratio=0.235):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size, size], radius=int(size * radius_ratio), fill=255)
    return m


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([0, 0, size, size], fill=255)
    return m


def draw_bubble(draw, scale=1.0, cx=0.5, cy=0.52, light=False, mono=False):
    """Draw the bubble + tail + three dots. Coordinates are fractions of 1024."""
    w, h = 600 * scale, 430 * scale
    x = S * cx - w / 2
    y = S * cy - h / 2
    r = 140 * scale
    fill = (255, 255, 255, 255) if mono else (IVORY if light else INK)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill)
    draw.polygon([(x + 100 * scale, y + h - 30 * scale),
                  (x + 100 * scale, y + h + 150 * scale),
                  (x + 335 * scale, y + h - 30 * scale)], fill=fill)
    dot_r = 38 * scale
    gap = 116 * scale
    cy_dot = y + h * 0.5
    for i, dx in enumerate((-gap, 0, gap)):
        if mono:
            color = (0, 0, 0, 0)
        elif i == 1:
            color = ACCENT
        else:
            color = INK if light else IVORY
        draw.ellipse([x + w / 2 + dx - dot_r, cy_dot - dot_r,
                      x + w / 2 + dx + dot_r, cy_dot + dot_r], fill=color)


def legacy(size, round_icon=False):
    master = Image.new("RGBA", (S, S), IVORY)
    draw_bubble(ImageDraw.Draw(master), scale=0.92, cy=0.52)
    mask = circle_mask(S) if round_icon else rounded_mask(S)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(master, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def foreground(size, mono=False):
    master = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # 54% of the 108dp canvas keeps the glyph inside Android's 66dp safe zone.
    draw_bubble(ImageDraw.Draw(master), scale=0.92, cy=0.51, light=False, mono=mono)
    return master.resize((size, size), Image.LANCZOS)


def splash(size=640):
    master = Image.new("RGBA", (size, size), IVORY)
    glyph = foreground(1024)
    glyph = glyph.resize((int(size * 0.58), int(size * 0.58)), Image.LANCZOS)
    master.alpha_composite(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
    return master


def main():
    os.makedirs(ASSETS, exist_ok=True)
    # Web / PWA icons
    legacy(512).save(os.path.join(ASSETS, "icon-512.png"))
    legacy(192).save(os.path.join(ASSETS, "icon-192.png"))
    legacy(180).save(os.path.join(ASSETS, "apple-touch-icon.png"))
    legacy(32).save(os.path.join(ASSETS, "favicon-32.png"))
    legacy(16).save(os.path.join(ASSETS, "favicon-16.png"))
    # Maskable: full-bleed square, glyph well inside the safe circle.
    maskable = Image.new("RGBA", (S, S), IVORY)
    hero = foreground(1024)
    hero = hero.resize((int(S * 0.74), int(S * 0.74)), Image.LANCZOS)
    maskable.alpha_composite(hero, ((S - hero.width) // 2, (S - hero.height) // 2))
    maskable.resize((512, 512), Image.LANCZOS).save(os.path.join(ASSETS, "icon-maskable-512.png"))

    # Windows .ico
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    legacy(256).save(os.path.join(ASSETS, "icon.ico"), sizes=ico_sizes)

    # Android legacy / round
    for dpi, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        folder = os.path.join(ANDROID, f"mipmap-{dpi}")
        os.makedirs(folder, exist_ok=True)
        legacy(px).save(os.path.join(folder, "ic_launcher.png"))
        legacy(px, round_icon=True).save(os.path.join(folder, "ic_launcher_round.png"))

    # Android adaptive foreground / monochrome (108dp)
    for dpi, px in (("mdpi", 108), ("hdpi", 162), ("xhdpi", 216), ("xxhdpi", 324), ("xxxhdpi", 432)):
        folder = os.path.join(ANDROID, f"mipmap-{dpi}")
        foreground(px).save(os.path.join(folder, "ic_launcher_foreground.png"))
        foreground(px, mono=True).save(os.path.join(folder, "ic_launcher_monochrome.png"))

    # Splash: replace all density variants with the new mark on ivory.
    splash_img = splash(640)
    for root, _dirs, files in os.walk(os.path.join(ANDROID, "drawable")):
        if "splash.png" in files:
            splash_img.save(os.path.join(root, "splash.png"))
    for name in ("drawable",):
        p = os.path.join(ANDROID, name, "splash.png")
        if os.path.exists(p):
            splash_img.save(p)

    print("icons ok: ivory + ink + terracotta, monochrome layer included")


if __name__ == "__main__":
    main()
