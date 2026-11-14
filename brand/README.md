# CustodyTap logo

| File | Use |
|---|---|
| `custodytap-logo.svg` | The logo: hand in blue `#2877b5`, check in green `#3db15e`. Traced from `source/custodytap-logo-original.jpg` (2026-11-14) |
| `custodytap-logo-mono.svg` | One colour, drawn in `currentColor`: set the CSS `color`, or replace `currentColor` with black for one-ink and thermal-transfer printing |
| `custodytap-icon.svg` | Ring and check only, for the browser tab and anywhere under 24 px tall. The hand's lines merge at that size |

- **Smallest sizes:** the hand logo needs at least 24 px on screen, or about 10 mm in print. Below that, use the icon.
- **Retrace** with `python -I source/trace_logo.py source/custodytap-logo-original.jpg OUT_DIR`
  (needs numpy, Pillow and vtracer).
- Not yet used on the site or the stickers: the site and stickers still use the tag mark.
