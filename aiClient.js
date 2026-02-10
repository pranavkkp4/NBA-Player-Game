/* =========================================================
   AI CLIENT - Frontend utilities for calling backend AI
   ========================================================= */

const AI_CONFIG = {
  backendUrl: 'http://localhost:5000', // Change for production
  cacheEnabled: true
};

// Set backend URL (can be overridden at runtime)
function setAIBackendUrl(url) {
  AI_CONFIG.backendUrl = url;
}

/**
 * Fetch provider availability status
 */
async function fetchAIStatus() {
  try {
    const res = await fetch(`${AI_CONFIG.backendUrl}/api/ai/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[AI STATUS] Error:', err);
    return {
      gemini: { enabled: false, reason: 'Backend unreachable' },
      ollama: { enabled: false, reason: 'Backend unreachable' }
    };
  }
}

/**
 * Generate career biography from provider
 * 
 * @param {string} provider - 'gemini' or 'ollama'
 * @param {object} careerPayload - structured career data
 * @param {string} cacheKey - optional cache key for caching results
 * @returns {Promise<{status, provider, text, error?, fromCache?}>}
 */
async function generateCareerBiography(provider, careerPayload, cacheKey = null) {
  try {
    const res = await fetch(`${AI_CONFIG.backendUrl}/api/ai/career`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        careerPayload,
        cacheKey: cacheKey || null
      })
    });

    const data = await res.json();

    // Handle disabled provider
    if (res.status === 403 && data.status === 'disabled') {
      return {
        status: 'disabled',
        provider,
        reason: data.reason || 'Provider unavailable',
        error: data.reason
      };
    }

    if (!res.ok) {
      return {
        status: 'error',
        provider,
        error: data.error || `HTTP ${res.status}`,
        text: null
      };
    }

    return {
      status: data.status,
      provider,
      text: data.text,
      fromCache: data.fromCache || false
    };
  } catch (err) {
    console.error('[AI GENERATION] Error:', err);
    return {
      status: 'error',
      provider,
      error: err.message,
      text: null
    };
  }
}

/**
 * Build a cache key from career data
 */
function buildCacheKey(playerId, seasonId, seed, provider) {
  return `${playerId}|${seasonId}|${seed}|${provider}`;
}

/**
 * Text-to-speech utilities
 */
const TTSControl = {
  currentUtterance: null,

  speak(text) {
    if (!('speechSynthesis' in window)) {
      console.warn('[TTS] Speech Synthesis not supported in this browser');
      return false;
    }

    this.stop(); // Clear any ongoing speech

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.9; // Slightly slower for clarity
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // Try to use English voice if available
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang.startsWith('en-'));
    if (englishVoice) {
      utter.voice = englishVoice;
    }

    this.currentUtterance = utter;

    utter.onerror = (evt) => {
      console.error('[TTS] Error:', evt.error);
    };

    window.speechSynthesis.speak(utter);
    return true;
  },

  stop() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.currentUtterance = null;
    }
  },

  isSpeaking() {
    return 'speechSynthesis' in window && window.speechSynthesis.speaking;
  }
};

// Ensure voices are loaded
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    // Voices have loaded, can now use them
  };
}
