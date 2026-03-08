// AutoMute content script — detects video element bounds and reports to background
(function () {
  'use strict';

  let lastBounds = null;
  let observer = null;

  /**
   * Find the largest visible <video> element and send its bounds to background.
   * Sends VIDEO_BOUNDS_CLEARED if none found.
   */
  function detectAndReport() {
    const videos = Array.from(document.querySelectorAll('video'));

    const visible = videos.filter(v => {
      const rect = v.getBoundingClientRect();
      return (
        rect.width > 100 &&
        rect.height > 100 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight + rect.height && // allow partially visible
        rect.right <= window.innerWidth + rect.width
      );
    });

    if (visible.length === 0) {
      if (lastBounds !== null) {
        lastBounds = null;
        chrome.runtime.sendMessage({ type: 'VIDEO_BOUNDS_CLEARED' }).catch(() => {});
      }
      return;
    }

    // Pick largest by area
    const largest = visible.reduce((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.width * aRect.height >= bRect.width * bRect.height ? a : b;
    });

    const rect = largest.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const bounds = {
      x: Math.round(rect.left * dpr),
      y: Math.round(rect.top * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr)
    };

    // Only send if bounds changed meaningfully (>5px difference)
    if (
      lastBounds &&
      Math.abs(bounds.x - lastBounds.x) < 5 &&
      Math.abs(bounds.y - lastBounds.y) < 5 &&
      Math.abs(bounds.width - lastBounds.width) < 5 &&
      Math.abs(bounds.height - lastBounds.height) < 5
    ) {
      return; // No significant change
    }

    lastBounds = bounds;
    chrome.runtime.sendMessage({ type: 'VIDEO_BOUNDS_UPDATED', bounds }).catch(() => {});
  }

  /**
   * Watch for DOM changes (videos added/removed/resized).
   */
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => detectAndReport());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  // Run on load
  detectAndReport();
  startObserver();

  // Re-run on SPA navigation
  window.addEventListener('popstate', () => { lastBounds = null; detectAndReport(); });
  document.addEventListener('yt-navigate-finish', () => { lastBounds = null; detectAndReport(); });

  // Handle PING from background (connectivity check)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ status: 'pong' });
    }
  });

  console.log('AutoMute content script loaded (video detection active)');
})();
