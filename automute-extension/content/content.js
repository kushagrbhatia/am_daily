// Basic content script for AutoMute extension
// This script runs on all web pages

(function() {
    'use strict';
    
    // Simple content script that doesn't interfere with pages
    // Main functionality will be in the background script
    
    console.log('AutoMute content script loaded');
    
    // Listen for messages from background script if needed
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Handle any messages from background script
      if (message.type === 'PING') {
        sendResponse({ status: 'pong' });
      }
    });
    
  })();