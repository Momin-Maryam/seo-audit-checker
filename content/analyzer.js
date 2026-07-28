// content/analyzer.js
// Runs in the context of the actual page. Listens for a message from the
// popup, performs the requested checks against the live DOM, and sends
// results back.
//
// Step 3 scope: Meta Tags category only. Other categories will be added
// the same way in later steps (each gets its own analyze*() function).

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_AUDIT") {
    const results = {
      meta: analyzeMetaTags(),
      headings: analyzeHeadings(),
      pageInfo: analyzePageInfo(),
    };

    // Images and Links checks are async, so we send the response once both
    // resolve and return true to keep the channel open until then.
    Promise.all([analyzeImages(), analyzeLinks()]).then(([imagesResult, linksResult]) => {
      results.images = imagesResult;
      results.links = linksResult;
      sendResponse({ type: "AUDIT_RESULT", results });
    });

    return true; // async response — sendResponse is called above once ready
  }

  if (message.type === "LOCATE_ELEMENT") {
    const found = locateElement(message.target);
    sendResponse({ type: "LOCATE_RESULT", found });
    return true;
  }
  // Unrecognized message type — don't return true, since we're not going
  // to call sendResponse for it. Returning true here with no response is
  // what causes "message channel closed before a response was received".
});

function analyzeMetaTags() {
  return {
    title: checkTitle(),
    description: checkDescription(),
    canonical: checkCanonical(),
    robots: checkRobots(),
  };
}

function checkTitle() {
  const titleEl = document.querySelector("title");
  const text = titleEl ? titleEl.textContent.trim() : "";
  const limit = 60;

  if (!text) {
    return { state: "fail", detail: "No <title> tag found, or it's empty.", length: 0, limit };
  }

  const genericTitles = ["untitled", "untitled document", "new page", "home"];
  if (genericTitles.includes(text.toLowerCase())) {
    return { state: "warn", detail: `Title looks generic: "${text}"`, length: text.length, limit };
  }

  if (text.length > limit) {
    return {
      state: "warn",
      detail: `Title is ${text.length} characters — may get truncated in search results (recommended ≤${limit}).`,
      length: text.length,
      limit,
    };
  }

  return { state: "pass", detail: `"${text}" (${text.length} chars)`, length: text.length, limit };
}

function checkDescription() {
  const metaDesc = document.querySelector('meta[name="description"]');
  const content = metaDesc ? metaDesc.getAttribute("content")?.trim() : "";
  const limit = 160;

  if (!metaDesc || !content) {
    return { state: "fail", detail: "No meta description found, or it's empty.", length: 0, limit };
  }

  if (content.length > limit) {
    return {
      state: "warn",
      detail: `Description is ${content.length} characters — may get truncated (recommended ≤${limit}).`,
      length: content.length,
      limit,
    };
  }

  return { state: "pass", detail: `${content.length} characters`, length: content.length, limit };
}

function checkCanonical() {
  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const href = canonicalEl ? canonicalEl.getAttribute("href") : null;

  if (!href) {
    return { state: "fail", detail: "No canonical tag found." };
  }

  return { state: "pass", detail: href };
}

function analyzeHeadings() {
  return {
    h1Count: checkH1Count(),
    skippedLevels: checkSkippedHeadingLevels(),
  };
}

function checkH1Count() {
  const h1s = document.querySelectorAll("h1");

  if (h1s.length === 0) {
    return { state: "fail", detail: "No H1 found on the page." };
  }

  if (h1s.length > 1) {
    const texts = Array.from(h1s)
      .map((el) => el.textContent.trim().slice(0, 40))
      .join(" | ");
    return {
      state: "fail",
      detail: `${h1s.length} H1 tags found (should be exactly 1): ${texts}`,
    };
  }

  return { state: "pass", detail: `1 H1 found: "${h1s[0].textContent.trim().slice(0, 60)}"` };
}

function checkSkippedHeadingLevels() {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));

  if (headings.length === 0) {
    return { state: "warn", detail: "No headings found on the page." };
  }

  const levels = headings.map((el) => parseInt(el.tagName.substring(1), 10));
  const skips = [];

  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1];
    const curr = levels[i];
    if (curr > prev + 1) {
      skips.push(`H${prev} → H${curr}`);
    }
  }

  if (skips.length > 0) {
    return {
      state: "fail",
      detail: `Skipped heading level(s): ${skips.join(", ")}`,
    };
  }

  return { state: "pass", detail: `Heading order looks correct (${headings.length} headings checked).` };
}

function analyzeImages() {
  const images = Array.from(document.querySelectorAll("img"));

  return Promise.all([checkAltText(images), checkBrokenImages(images)]).then(
    ([altText, broken]) => ({ altText, broken })
  );
}

function checkAltText(images) {
  if (images.length === 0) {
    return { state: "pass", detail: "No images on this page." };
  }

  const missing = images.filter((img) => {
    const alt = img.getAttribute("alt");
    return alt === null || alt.trim() === "";
  });

  if (missing.length === 0) {
    return { state: "pass", detail: `All ${images.length} images have alt text.` };
  }

  const sample = missing
    .slice(0, 3)
    .map((img) => img.getAttribute("src") || "(no src)")
    .join(", ");

  return {
    state: "fail",
    detail: `${missing.length} of ${images.length} images missing alt text. e.g. ${sample}`,
  };
}

function checkBrokenImages(images) {
  if (images.length === 0) {
    return Promise.resolve({ state: "pass", detail: "No images on this page." });
  }

  const checks = images.map((img) => {
    // Already finished loading (most images by the time the audit runs)
    if (img.complete) {
      return Promise.resolve({ img, broken: img.naturalWidth === 0 });
    }
    // Still loading — wait briefly for it to settle
    return new Promise((resolve) => {
      const onLoad = () => {
        cleanup();
        resolve({ img, broken: false });
      };
      const onError = () => {
        cleanup();
        resolve({ img, broken: true });
      };
      const cleanup = () => {
        img.removeEventListener("load", onLoad);
        img.removeEventListener("error", onError);
      };
      img.addEventListener("load", onLoad);
      img.addEventListener("error", onError);
      // Safety timeout in case neither event fires
      setTimeout(() => {
        cleanup();
        resolve({ img, broken: img.naturalWidth === 0 });
      }, 3000);
    });
  });

  return Promise.all(checks).then((results) => {
    const broken = results.filter((r) => r.broken).map((r) => r.img);

    if (broken.length === 0) {
      return { state: "pass", detail: `All ${images.length} images loaded successfully.` };
    }

    const sample = broken
      .slice(0, 3)
      .map((img) => img.getAttribute("src") || "(no src)")
      .join(", ");

    return {
      state: "fail",
      detail: `${broken.length} of ${images.length} images failed to load. e.g. ${sample}`,
    };
  });
}

const LINK_CHECK_LIMIT = 20; // cap how many links we check, to keep the audit fast
const LINK_CHECK_TIMEOUT_MS = 4000;

function analyzeLinks() {
  const allLinks = Array.from(document.querySelectorAll("a[href]"));

  const checkableLinks = allLinks
    .map((a) => a.getAttribute("href"))
    .filter((href) => href && !href.startsWith("#"))
    .filter((href) => !/^(mailto:|tel:|javascript:)/i.test(href))
    // Resolve relative URLs against the page so fetch() gets a real URL
    .map((href) => {
      try {
        return new URL(href, window.location.href).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // De-duplicate — no need to check the same URL twice
  const uniqueLinks = Array.from(new Set(checkableLinks));

  if (uniqueLinks.length === 0) {
    return Promise.resolve({ state: "pass", detail: "No checkable links found on this page." });
  }

  const toCheck = uniqueLinks.slice(0, LINK_CHECK_LIMIT);
  const skippedCount = uniqueLinks.length - toCheck.length;

  return Promise.all(toCheck.map(checkOneLink)).then((results) => {
    const broken = results.filter((r) => r.status === "broken");
    const unverifiable = results.filter((r) => r.status === "unverifiable");

    const cappedNote = skippedCount > 0 ? ` (checked first ${LINK_CHECK_LIMIT} of ${uniqueLinks.length})` : "";

    if (broken.length > 0) {
      const sample = broken.slice(0, 3).map((r) => r.url).join(", ");
      return {
        state: "fail",
        detail: `${broken.length} broken link(s) found${cappedNote}. e.g. ${sample}`,
      };
    }

    if (unverifiable.length > 0) {
      return {
        state: "warn",
        detail: `${unverifiable.length} link(s) couldn't be verified (likely blocked by CORS)${cappedNote}. No confirmed broken links.`,
      };
    }

    return {
      state: "pass",
      detail: `All ${toCheck.length} links checked OK${cappedNote}.`,
    };
  });
}

function checkOneLink(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);

  return fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" })
    .then((res) => {
      clearTimeout(timeout);
      if (res.status >= 400) {
        return { url, status: "broken" };
      }
      return { url, status: "ok" };
    })
    .catch(() => {
      clearTimeout(timeout);
      // Could be a real 404 with no CORS headers, a timeout, or a network
      // error — we can't tell the difference from content-script fetch, so
      // treat as unverifiable rather than falsely failing a working link.
      return { url, status: "unverifiable" };
    });
}

function analyzePageInfo() {
  return {
    wordCount: countVisibleWords(),
  };
}

function countVisibleWords() {
  // Clone the body so we can strip non-content elements without touching
  // the real page, then count words from what's left.
  const clone = document.body.cloneNode(true);

  clone.querySelectorAll("script, style, noscript, template").forEach((el) => el.remove());

  // Drop elements hidden via inline style — best-effort, doesn't catch
  // hidden-via-external-CSS since the clone isn't attached to the DOM.
  clone.querySelectorAll('[style*="display:none"], [style*="display: none"]').forEach((el) => el.remove());
  clone.querySelectorAll("[hidden]").forEach((el) => el.remove());

  const text = clone.textContent || "";
  const words = text.trim().split(/\s+/).filter(Boolean);

  return words.length;
}

const HIGHLIGHT_DURATION_MS = 2500;
let highlightOverlay = null;

function locateElement(target) {
  let el = null;

  switch (target) {
    case "title":
      // <title> itself isn't visible/scrollable — nothing to highlight
      return false;
    case "h1":
      el = document.querySelector("h1");
      break;
    case "canonical":
      el = document.querySelector('link[rel="canonical"]');
      break;
    case "missingAlt":
      el = Array.from(document.querySelectorAll("img")).find((img) => {
        const alt = img.getAttribute("alt");
        return alt === null || alt.trim() === "";
      });
      break;
    case "brokenImage":
      el = Array.from(document.querySelectorAll("img")).find((img) => img.complete && img.naturalWidth === 0);
      break;
    default:
      return false;
  }

  if (!el) return false;

  // <link rel="canonical"> lives in <head> and isn't rendered/visible, so
  // there's nothing on-page to scroll to or outline for it.
  if (el.tagName === "LINK") return false;

  el.scrollIntoView({ behavior: "smooth", block: "center" });
  showHighlight(el);
  return true;
}

function showHighlight(el) {
  if (highlightOverlay) {
    highlightOverlay.remove();
  }

  const rect = el.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed;
    top: ${rect.top - 4}px;
    left: ${rect.left - 4}px;
    width: ${rect.width + 8}px;
    height: ${rect.height + 8}px;
    border: 3px solid #E2935B;
    border-radius: 6px;
    background: rgba(226, 147, 91, 0.15);
    box-shadow: 0 0 0 4px rgba(226, 147, 91, 0.25);
    pointer-events: none;
    z-index: 2147483647;
    transition: opacity 0.4s ease;
  `;
  document.body.appendChild(overlay);
  highlightOverlay = overlay;

  setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.remove();
      if (highlightOverlay === overlay) highlightOverlay = null;
    }, 400);
  }, HIGHLIGHT_DURATION_MS);
}

function checkRobots() {
  const robotsEl = document.querySelector('meta[name="robots"]');
  const content = robotsEl ? robotsEl.getAttribute("content")?.trim().toLowerCase() : null;

  if (!content) {
    return { state: "pass", detail: "No robots meta tag (defaults to index, follow)." };
  }

  if (content.includes("noindex") || content.includes("nofollow")) {
    return { state: "warn", detail: `Robots tag says: "${content}"` };
  }

  return { state: "pass", detail: `Robots tag says: "${content}"` };
}