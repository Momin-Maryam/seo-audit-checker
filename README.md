# SEO Audit Checker
 
Chrome extension for a quick on-page SEO check, no paid tools needed.
 
## Features
 
- Meta title & description checks (with character counters)
- Canonical tag & robots meta status
- Heading structure (H1 count, skipped levels)
- Missing alt text & broken images (with element list + copy selector)
- Broken link detection
- Word count
- Fix suggestions for failing checks (why + example fix + copy)
- Click-to-highlight on the page (H1, missing-alt images, broken images)
- Downloadable Markdown report
## Setup
 
1. Clone this repo
2. Go to `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked**, select the project folder
4. Click the extension icon on any page, hit **Run Audit**
## Tech
 
Vanilla JS, HTML, CSS. Manifest V3. No build step, no dependencies.
