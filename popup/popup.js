// popup.js — Step 12: one-click Fix suggestions added on top of the
// completed core audit (all four categories still wired to real analysis).

const META_CHECK_ORDER = ["title", "description", "canonical", "robots"];
const HEADINGS_CHECK_ORDER = ["h1Count", "skippedLevels"];
const IMAGES_CHECK_ORDER = ["altText", "broken"];
const LINKS_CHECK_ORDER = ["links"];

// Static "why + suggested fix" templates per check, keyed by
// category.checkKey.state. No AI involved — just hardcoded SEO guidance.
// Only fail/warn entries exist; "pass" never needs a fix.
const FIX_SUGGESTIONS = {
  meta: {
    title: {
      fail: {
        why: "Google uses the title tag as the clickable headline in search results and the browser tab. Without one, Google auto-generates something from the page — usually worse than a written title.",
        suggested: '<title>Primary Keyword – Brand Name | Short Value Prop</title>',
      },
      warn: {
        why: "A missing, generic, or overly long title hurts click-through rate — long titles get truncated in search results.",
        suggested: 'Keep it under 60 characters, lead with the primary keyword, e.g. "Buy Running Shoes Online – Free Delivery | BrandName"',
      },
    },
    description: {
      fail: {
        why: "Without a meta description, Google pulls a random snippet of page text for search results — usually less compelling than a written one.",
        suggested: '<meta name="description" content="One clear sentence on what this page offers, under 160 characters.">',
      },
      warn: {
        why: "Descriptions over 160 characters get cut off in search results, hiding your call-to-action.",
        suggested: "Trim to ~150-160 characters, front-load the key benefit in the first 120.",
      },
    },
    canonical: {
      fail: {
        why: "Without a canonical tag, Google may see the same content at multiple URLs (with/without www, trailing slash, query params) as duplicates, splitting ranking signals.",
        suggested: '<link rel="canonical" href="https://example.com/this-exact-page">',
      },
    },
    robots: {
      warn: {
        why: '"noindex" or "nofollow" tells Google not to index or follow links on this page — fine if intentional, a problem if not.',
        suggested: 'If this page should be indexed: <meta name="robots" content="index, follow">',
      },
    },
  },
  headings: {
    h1Count: {
      fail: {
        why: "The H1 tells both users and Google what the page is primarily about. Missing or multiple H1s create ambiguity about the page's main topic.",
        suggested: "Use exactly one <h1> describing the page's primary topic, e.g. <h1>Buy Running Shoes Online</h1>",
      },
    },
    skippedLevels: {
      fail: {
        why: "Skipping heading levels (e.g. H2 straight to H4) breaks the logical document outline — hurts both accessibility (screen readers) and how Google parses page structure.",
        suggested: "Keep headings sequential: H1 → H2 → H3 → H4, without skipping a level.",
      },
    },
  },
  images: {
    altText: {
      fail: {
        why: "Alt text is read aloud by screen readers (accessibility) and also helps Google Images understand and rank your images.",
        suggested: '<img src="shoe.png" alt="Red running shoes on white background">',
      },
    },
    broken: {
      fail: {
        why: "Broken images hurt user experience and are a negative quality signal to Google's crawler.",
        suggested: "Check the image URL/path — fix the source, or remove/replace the image if it's no longer available.",
      },
    },
  },
  links: {
    links: {
      fail: {
        why: "Broken links (404s) frustrate users and are treated as a quality signal by Google — too many can affect crawl trust.",
        suggested: "Fix the destination URL, set up a redirect, or remove the link if the target page no longer exists.",
      },
      warn: {
        why: "Some links couldn't be verified — usually because the target site blocks cross-origin requests (CORS), not because they're actually broken.",
        suggested: "Spot-check these manually by clicking them, since we can't confirm their status automatically.",
      },
    },
  },
};

document.addEventListener("DOMContentLoaded", () => {
  setupCollapsibleCategories();
  setupRunAudit();
  setupLocateButtons();
  setupFixButtons();
});

function setupCollapsibleCategories() {
  document.querySelectorAll(".category-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.closest(".category").classList.toggle("collapsed");
    });
  });
}

function setupRunAudit() {
  const runBtn = document.getElementById("runAuditBtn");
  runBtn.addEventListener("click", () => {
    runAudit();
  });
}

async function runAudit() {
  const runBtn = document.getElementById("runAuditBtn");
  const originalLabel = runBtn.innerHTML;

  runBtn.disabled = true;
  runBtn.classList.add("btn-run--loading");
  runBtn.innerHTML = `<span class="spinner"></span> Scanning…`;
  document.getElementById("scoreSummary").textContent = "Running audit…";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || isRestrictedUrl(tab.url)) {
    document.getElementById("scoreSummary").textContent =
      "This page can't be scanned (browser/internal pages aren't accessible to extensions).";
    resetRunButton(runBtn, originalLabel);
    return;
  }

  chrome.tabs.sendMessage(
    tab.id,
    { type: "RUN_AUDIT" },
    (response) => {
      resetRunButton(runBtn, originalLabel);

      if (chrome.runtime.lastError) {
        document.getElementById("scoreSummary").textContent =
          "Couldn't scan this page — try reloading the tab, then run the audit again.";
        console.error(chrome.runtime.lastError.message);
        return;
      }

      if (response && response.type === "AUDIT_RESULT") {
        renderCategoryResults("meta", META_CHECK_ORDER, response.results.meta);
        renderCharCounter("title", response.results.meta.title);
        renderCharCounter("description", response.results.meta.description);
        renderCategoryResults("headings", HEADINGS_CHECK_ORDER, response.results.headings);
        toggleLocateButton("h1", response.results.headings.h1Count.state === "pass");
        renderCategoryResults("images", IMAGES_CHECK_ORDER, response.results.images);
        toggleLocateButton("missingAlt", response.results.images.altText.state === "fail");
        toggleLocateButton("brokenImage", response.results.images.broken.state === "fail");
        // Links only has one check, so analyzer.js returns it directly
        // rather than nested under a key — wrap it here to fit the same
        // generic renderer used by every other category.
        renderCategoryResults("links", LINKS_CHECK_ORDER, { links: response.results.links });
        renderPageInfo(response.results.pageInfo);
        updateOverallScore();
      }
    }
  );
}

function isRestrictedUrl(url) {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("https://chrome.google.com/webstore")
  );
}

function resetRunButton(runBtn, originalLabel) {
  runBtn.disabled = false;
  runBtn.classList.remove("btn-run--loading");
  runBtn.innerHTML = originalLabel;
}

// Generic renderer used by every wired-up category. Maps each check-row in
// the DOM (in order) to a result key, and applies the right badge/state.
function renderCategoryResults(categoryKey, checkOrder, results) {
  const section = document.querySelector(`.category[data-category="${categoryKey}"]`);
  const rows = section.querySelectorAll(".check-row");
  let passCount = 0;

  rows.forEach((row, i) => {
    const key = checkOrder[i];
    const result = results[key];
    if (!result) return;

    const badge = row.querySelector(".badge");

    row.classList.remove("state-pass", "state-fail", "state-warn");
    badge.classList.remove("badge-pending", "badge-pass", "badge-fail", "badge-warn");

    row.classList.add(`state-${result.state}`);
    badge.classList.add(`badge-${result.state}`);

    row.setAttribute("title", result.detail);

    if (result.state === "pass") passCount++;

    // Show the Fix button only when a static suggestion exists for this
    // exact category/check/state combo (pass states never have one).
    const fixBtn = row.querySelector(".fix-btn");
    if (fixBtn) {
      const suggestion = FIX_SUGGESTIONS[categoryKey]?.[key]?.[result.state];
      fixBtn.hidden = !suggestion;
      // Close any open fix panel when results change (fresh audit run) so
      // stale suggestions don't linger.
      closeFixPanel(row);
    }
  });

  document.querySelector(`.category-count[data-count="${categoryKey}"]`).textContent =
    `${passCount}/${rows.length} passed`;
}

function setupLocateButtons() {
  document.querySelectorAll(".locate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.locate;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          console.error("Locate: no active tab found");
          return;
        }

        chrome.tabs.sendMessage(tab.id, { type: "LOCATE_ELEMENT", target }, () => {
          if (chrome.runtime.lastError) {
            console.error("Locate sendMessage error:", chrome.runtime.lastError.message);
          }
        });
      } catch (err) {
        console.error("Locate click failed:", err);
      } finally {
        // Always close, even if something above threw — otherwise a
        // content-script-side error leaves the popup stuck open covering
        // the page where the highlight would show.
        window.close();
      }
    });
  });
}

function toggleLocateButton(target, shouldShow) {
  const btn = document.querySelector(`.locate-btn[data-locate="${target}"]`);
  if (!btn) return;
  btn.hidden = !shouldShow;
}

function setupFixButtons() {
  document.querySelectorAll(".fix-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".check-row");
      const existingPanel = row.nextElementSibling?.classList?.contains("fix-panel")
        ? row.nextElementSibling
        : null;

      if (existingPanel) {
        closeFixPanel(row);
        return;
      }

      const [category, checkKey] = btn.dataset.fix.split(".");
      // Read the state we just rendered onto the row (state-fail/state-warn)
      const state = row.classList.contains("state-fail")
        ? "fail"
        : row.classList.contains("state-warn")
        ? "warn"
        : null;
      const suggestion = FIX_SUGGESTIONS[category]?.[checkKey]?.[state];
      if (!suggestion) return;

      openFixPanel(row, suggestion);
    });
  });
}

function openFixPanel(row, suggestion) {
  const panel = document.createElement("div");
  panel.className = "fix-panel";
  panel.innerHTML = `
    <div class="fix-why"><strong>Why:</strong> ${escapeHtml(suggestion.why)}</div>
    <div class="fix-suggested-label"><strong>Suggested fix:</strong></div>
    <pre class="fix-suggested-text"></pre>
    <button class="fix-copy-btn" type="button">Copy</button>
  `;
  // Set suggested text via textContent (not innerHTML) so any special
  // characters in code snippets render literally and can't break the page.
  panel.querySelector(".fix-suggested-text").textContent = suggestion.suggested;

  const copyBtn = panel.querySelector(".fix-copy-btn");
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(suggestion.suggested).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("fix-copy-btn--done");
      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.classList.remove("fix-copy-btn--done");
      }, 1500);
    });
  });

  row.insertAdjacentElement("afterend", panel);
}

function closeFixPanel(row) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains("fix-panel")) {
    next.remove();
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderCharCounter(checkKey, result) {
  if (!result || result.length === undefined) return;

  const counterEl = document.querySelector(`.char-counter[data-counter="${checkKey}"]`);
  if (!counterEl) return;

  counterEl.textContent = `${result.length}/${result.limit}`;
  counterEl.classList.remove("char-counter--ok", "char-counter--over");
  counterEl.classList.add(result.length > result.limit ? "char-counter--over" : "char-counter--ok");
}

function renderPageInfo(pageInfo) {
  if (!pageInfo) return;
  document.getElementById("wordCount").textContent = pageInfo.wordCount.toLocaleString();
}

function updateOverallScore() {
  const allBadges = document.querySelectorAll(".badge");
  const passBadges = document.querySelectorAll(".badge-pass");
  const score = Math.round((passBadges.length / allBadges.length) * 100);

  updateScoreDial(score);

  document.getElementById("scoreSummary").textContent =
    score === 100
      ? "No issues found — nice work!"
      : "A few issues found — check the categories below.";
}

function updateScoreDial(score) {
  const circumference = 327; // 2 * pi * r(52)
  const offset = circumference - (circumference * score) / 100;
  document.getElementById("dialProgress").style.strokeDashoffset = offset;
  document.getElementById("scoreValue").textContent = score;
}