const STORAGE_KEY = 'onboarding_complete';

const STEPS = [
  {
    emoji: '👇',
    title: 'Pick a tab to watch',
    body: 'Find the tab playing video and click ▶ Monitor next to it.'
  },
  {
    emoji: '🔇',
    title: 'AutoMute detects ads',
    body: 'AutoMute takes periodic screenshots and uses AI to detect ads. It mutes automatically.'
  },
  {
    emoji: '✅',
    title: "You're all set",
    body: "Click Stop AutoMuting anytime to turn it off. That's it!"
  }
];

async function shouldShow() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      resolve(!result[STORAGE_KEY]);
    });
  });
}

async function markComplete() {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: true }, resolve);
  });
}

function buildOverlay() {
  let currentStep = 0;

  const overlay = document.createElement('div');
  overlay.id = 'onboardingOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background:white;border-radius:12px;padding:24px;width:280px;
    text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.2);
  `;

  function render() {
    const step = STEPS[currentStep];
    card.innerHTML = `
      <div style="font-size:40px;margin-bottom:12px;">${step.emoji}</div>
      <div style="font-size:11px;color:#9aa0a6;margin-bottom:4px;">
        Step ${currentStep + 1} of ${STEPS.length}
      </div>
      <h2 style="font-size:16px;font-weight:600;margin:0 0 8px;color:#202124;">${step.title}</h2>
      <p style="font-size:13px;color:#5f6368;margin:0 0 20px;line-height:1.5;">${step.body}</p>
      <button id="onboardingNext" style="
        background:#1a73e8;color:white;border:none;border-radius:6px;
        padding:10px 24px;font-size:13px;font-weight:500;cursor:pointer;width:100%;
      ">
        ${currentStep < STEPS.length - 1 ? 'Next \u2192' : 'Got it'}
      </button>
    `;

    card.querySelector('#onboardingNext').addEventListener('click', async () => {
      if (currentStep < STEPS.length - 1) {
        currentStep++;
        render();
      } else {
        await markComplete();
        overlay.remove();
      }
    });
  }

  render();
  overlay.appendChild(card);
  return overlay;
}

// Self-initialize when DOM is ready
async function initOnboarding() {
  if (await shouldShow()) {
    document.body.appendChild(buildOverlay());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initOnboarding();
});
