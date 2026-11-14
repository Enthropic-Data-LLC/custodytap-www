# custodytap.com

Static marketing site for CustodyTap, served by GitHub Pages at <https://custodytap.com>.
No build step: edit the HTML and CSS, push to `main`, and Pages publishes it.

- `index.html`, `nerc-cip/`, `hipaa/`: the pages. Copy follows the product's marketing rules:
  CustodyTap *supports evidence for* a named requirement. Never "compliant", "certified" or similar,
  and claim only what is built.
- `style.css`: one stylesheet, light and dark themes.
- `fonts/archivo-latin.woff2`: Archivo (SIL Open Font License), self-hosted so the site makes no
  third-party requests.
- `og.png`: the share image (1200×630), rendered from `og.html` (noindex) with a headless browser at 1200×630.
- `sitemap.xml` and `robots.txt`: update `lastmod` when a page changes.
