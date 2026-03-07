/**
 * YouTube DOM-based ad detection.
 * Watches #movie_player for the .ad-showing class using MutationObserver.
 * Sends YOUTUBE_AD_START / YOUTUBE_AD_END messages to background.js.
 * No screenshot or API call needed — instant detection.
 */

const PLAYER_SELECTOR = '#movie_player';
const AD_CLASS = 'ad-showing';

let isAdPlaying = false;

function checkAdState(player) {
  const adNow = player.classList.contains(AD_CLASS);

  if (adNow && !isAdPlaying) {
    isAdPlaying = true;
    chrome.runtime.sendMessage({ type: 'YOUTUBE_AD_START' });
  } else if (!adNow && isAdPlaying) {
    isAdPlaying = false;
    chrome.runtime.sendMessage({ type: 'YOUTUBE_AD_END' });
  }
}

function init() {
  const player = document.querySelector(PLAYER_SELECTOR);
  if (!player) {
    // Player not in DOM yet — wait and retry
    setTimeout(init, 1000);
    return;
  }

  // Initial check
  checkAdState(player);

  // Watch for class changes on the player element
  const observer = new MutationObserver(() => checkAdState(player));
  observer.observe(player, { attributes: true, attributeFilter: ['class'] });
}

// YouTube is a SPA — re-init on navigation
document.addEventListener('yt-navigate-finish', init);
init();
