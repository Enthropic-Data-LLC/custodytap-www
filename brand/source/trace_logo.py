"""Trace the CustodyTap hand logo (raster JPEG) into a two-colour SVG.

Usage: python -I trace_logo.py SOURCE.jpg OUT_DIR
Separates blue and green ink by hue, upsamples each coverage map before thresholding (smoother
edges than tracing JPEG pixels), traces each layer with vtracer, and writes:
  custodytap-logo.svg       blue + green, as drawn
  custodytap-logo-mono.svg  one colour (currentColor), for one-ink print and CSS colouring
"""
import re
import sys
from pathlib import Path

import numpy as np
import vtracer
from PIL import Image

SCALE = 4  # upsample factor before thresholding
PAD = 12   # px of margin around the artwork in the final viewBox (source pixels)

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255.0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

# Ink coverage: how far from the white paper a pixel is (0 = paper, 1 = full ink).
mx, mn = rgb.max(axis=2), rgb.min(axis=2)
coverage = np.clip((1.0 - mn) / 0.75, 0, 1) * np.clip((mx - mn) / 0.35, 0, 1)
is_green = (g > b) & (g > r)
is_blue = (b >= g) & (b > r)
layers = {"blue": coverage * is_blue, "green": coverage * is_green}

# Representative colours: median of strongly inked pixels in each layer.
colours = {}
for name, cov in layers.items():
    px = rgb[cov > 0.9]
    colours[name] = "#%02x%02x%02x" % tuple(int(round(v * 255)) for v in np.median(px, axis=0))

# Crop box around all ink.
ys, xs = np.nonzero(coverage > 0.3)
x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + PAD + 1, rgb.shape[1])
y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + PAD + 1, rgb.shape[0])
w, h = x1 - x0, y1 - y0


def trace(cov: np.ndarray) -> list[str]:
    crop = cov[y0:y1, x0:x1]
    big = Image.fromarray((crop * 255).astype(np.uint8)).resize((w * SCALE, h * SCALE), Image.LANCZOS)
    mask = np.asarray(big) > 127
    bw = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).convert("RGB")
    tmp_in, tmp_out = out / "_mask.png", out / "_trace.svg"
    bw.save(tmp_in)
    vtracer.convert_image_to_svg_py(str(tmp_in), str(tmp_out), colormode="binary", mode="spline",
                                    filter_speckle=8, corner_threshold=60, length_threshold=4.0,
                                    splice_threshold=45, path_precision=2)
    svg = tmp_out.read_text()
    tmp_in.unlink(), tmp_out.unlink()
    return re.findall(r"<path[^>]*/>", svg)


def paths_with_fill(paths: list[str], fill: str) -> str:
    cleaned = [re.sub(r'\sfill="[^"]*"', "", p).replace("<path", f'<path fill="{fill}"', 1) for p in paths]
    return "\n    ".join(cleaned)


blue_paths, green_paths = trace(layers["blue"]), trace(layers["green"])
view = f'viewBox="0 0 {w * SCALE} {h * SCALE}"'
head = '<svg xmlns="http://www.w3.org/2000/svg" ' + view + ' role="img" aria-label="CustodyTap">\n'

two = (head + f'  <g>\n    {paths_with_fill(blue_paths, colours["blue"])}\n'
       f'    {paths_with_fill(green_paths, colours["green"])}\n  </g>\n</svg>\n')
mono = (head + f'  <g>\n    {paths_with_fill(blue_paths + green_paths, "currentColor")}\n  </g>\n</svg>\n')
(out / "custodytap-logo.svg").write_text(two)
(out / "custodytap-logo-mono.svg").write_text(mono)
print(f"crop {w}x{h} at x{SCALE}; colours {colours}; paths blue={len(blue_paths)} green={len(green_paths)}")
print(f"sizes: {(out / 'custodytap-logo.svg').stat().st_size} B two-colour, {(out / 'custodytap-logo-mono.svg').stat().st_size} B mono")
