import os
from PIL import Image, ImageDraw

densities = {
    'mipmap-mdpi': (48, 108),
    'mipmap-hdpi': (72, 162),
    'mipmap-xhdpi': (96, 216),
    'mipmap-xxhdpi': (144, 324),
    'mipmap-xxxhdpi': (192, 432),
}

# Master 1024x1024 icon
master_icon = Image.open('assets/logo.png').convert('RGBA')

for d, (icon_size, fg_size) in densities.items():
    out_dir = f'src-tauri/icons/android/{d}'
    os.makedirs(out_dir, exist_ok=True)

    # 1. ic_launcher_foreground.png (Adaptive icon foreground, padded)
    # Android adaptive icon standard: 108x108 with 72x72 viewport (ratio: 72/108 = 0.6667)
    fg_canvas = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    glyph_size = int(fg_size * 0.72)
    glyph = master_icon.resize((glyph_size, glyph_size), Image.Resampling.LANCZOS)
    offset = (fg_size - glyph_size) // 2
    fg_canvas.paste(glyph, (offset, offset), glyph)
    fg_canvas.save(f'{out_dir}/ic_launcher_foreground.png')

    # 2. ic_launcher.png (Legacy squircle launcher icon with brand dark #0a101d background)
    legacy_canvas = Image.new('RGBA', (icon_size, icon_size), (0, 0, 0, 0))
    # Draw rounded squircle background (#0a101d)
    mask = Image.new('L', (icon_size, icon_size), 0)
    draw = ImageDraw.Draw(mask)
    corner_radius = int(icon_size * 0.22)
    draw.rounded_rectangle([0, 0, icon_size - 1, icon_size - 1], radius=corner_radius, fill=255)
    
    bg_sq = Image.new('RGBA', (icon_size, icon_size), (10, 16, 29, 255))
    legacy_canvas.paste(bg_sq, (0, 0), mask)
    
    # Paste centered glyph (~70% of icon size)
    inner_size = int(icon_size * 0.70)
    inner_glyph = master_icon.resize((inner_size, inner_size), Image.Resampling.LANCZOS)
    inner_offset = (icon_size - inner_size) // 2
    legacy_canvas.paste(inner_glyph, (inner_offset, inner_offset), inner_glyph)
    legacy_canvas.save(f'{out_dir}/ic_launcher.png')

    # 3. ic_launcher_round.png (Legacy round launcher icon with brand dark #0a101d background)
    round_canvas = Image.new('RGBA', (icon_size, icon_size), (0, 0, 0, 0))
    round_mask = Image.new('L', (icon_size, icon_size), 0)
    round_draw = ImageDraw.Draw(round_mask)
    round_draw.ellipse([0, 0, icon_size - 1, icon_size - 1], fill=255)
    
    round_bg = Image.new('RGBA', (icon_size, icon_size), (10, 16, 29, 255))
    round_canvas.paste(round_bg, (0, 0), round_mask)
    
    round_glyph_size = int(icon_size * 0.65)
    round_glyph = master_icon.resize((round_glyph_size, round_glyph_size), Image.Resampling.LANCZOS)
    round_offset = (icon_size - round_glyph_size) // 2
    round_canvas.paste(round_glyph, (round_offset, round_offset), round_glyph)
    round_canvas.save(f'{out_dir}/ic_launcher_round.png')

    print(f"Generated complete Android icon suite for {d}: icon={icon_size}x{icon_size}, fg={fg_size}x{fg_size}")
