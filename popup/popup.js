// popup.js — Step 6: all four categories (Meta Tags, Headings, Images,
// Links) wired to real page analysis. No more placeholder/demo data.

const META_CHECK_ORDER = ["title", "description", "canonical", "robots"];
const HEADINGS_CHECK_ORDER = ["h1Count", "skippedLevels"];
const IMAGES_CHECK_ORDER = ["altText", "broken"];
const LINKS_CHECK_ORDER = ["links"];

document.addEventListener("DOMContentLoaded", () => {
  setupCollapsibleCategories();
  setupRunAudit();
  setupLocateButtons();
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
  });

  document.querySelector(`.category-count[data-count="${categoryKey}"]`).textContent =
    `${passCount}/${rows.length} passed`;
}

function setupLocateButtons() {
  document.querySelectorAll(".locate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.locate;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      const originalLabel = btn.textContent;
      btn.textContent = "…";
      btn.disabled = true;

      chrome.tabs.sendMessage(tab.id, { type: "LOCATE_ELEMENT", target }, (response) => {
        btn.textContent = originalLabel;
        btn.disabled = false;

        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          return;
        }
        // Popup closes automatically when the tab is focused/scrolled to in
        // some Chrome versions — that's expected, the highlight still shows.
      });
    });
  });
}

function toggleLocateButton(target, shouldShow) {
  const btn = document.querySelector(`.locate-btn[data-locate="${target}"]`);
  if (!btn) return;
  btn.hidden = !shouldShow;
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