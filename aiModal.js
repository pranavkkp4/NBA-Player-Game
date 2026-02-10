/* =========================================================
   AI MODAL MODULE - Modal UI for career biographies
   Handles loading, rendering, TTS, and copy-to-clipboard
   ========================================================= */

/**
 * Create and manage the AI biography modal
 */
class AIBiographyModal {
  constructor() {
    this.modalEl = null;
    this.isOpen = false;
    this.currentProvider = null;
  }

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const overlay = document.createElement('div');
    overlay.id = 'aiModalOverlay';
    overlay.className = 'modal-overlay hidden';

    const modal = document.createElement('div');
    modal.className = 'modal ai-modal';

    const header = document.createElement('div');
    header.className = 'ai-modal-header';
    header.innerHTML = `
      <div>
        <h3>Career Biography</h3>
        <div style="font-size: 0.85rem; color: var(--muted); margin-top: 4px;">
          <span id="aiProvider">Loading...</span>
        </div>
      </div>
      <button id="aiModalClose" class="icon-btn">✕</button>
    `;

    const body = document.createElement('div');
    body.id = 'aiModalBody';
    body.className = 'ai-modal-body';
    body.innerHTML = `
      <div class="ai-loading">
        <div class="ai-spinner"></div>
        <span>Generating biography...</span>
      </div>
    `;

    modal.appendChild(header);
    modal.appendChild(body);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close button
    document.getElementById('aiModalClose').addEventListener('click', () => this.close());

    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    this.modalEl = overlay;
  }

  /**
   * Open modal and generate biography
   */
  async open(provider, careerPayload, cacheKey = null) {
    if (!this.modalEl) this.createModal();

    this.isOpen = true;
    this.currentProvider = provider;
    this.modalEl.classList.remove('hidden');

    const body = document.getElementById('aiModalBody');
    const providerEl = document.getElementById('aiProvider');

    // Show loading state
    body.innerHTML = `
      <div class="ai-loading">
        <div class="ai-spinner"></div>
        <span>Generating biography from ${provider}...</span>
      </div>
    `;

    try {
      // Call AI backend
      const result = await generateCareerBiography(provider, careerPayload, cacheKey);

      if (result.status === 'disabled') {
        providerEl.textContent = `${provider} (unavailable)`;
        body.innerHTML = `
          <div class="ai-error-box">
            <strong>Provider Unavailable</strong><br/>
            ${result.reason || 'This provider is currently unavailable.'}
          </div>
        `;
        return;
      }

      if (result.status === 'error') {
        providerEl.textContent = `${provider} (error)`;
        body.innerHTML = `
          <div class="ai-error-box">
            <strong>Error Generating Biography</strong><br/>
            ${result.error || 'An unknown error occurred.'}
          </div>
        `;
        return;
      }

      // Success: render biography
      providerEl.textContent = `${provider}${result.fromCache ? ' (cached)' : ''}`;
      body.innerHTML = `
        <p class="ai-bio-text" id="aiBioText">${this.escapeHtml(result.text)}</p>
        <div class="ai-modal-controls">
          <button id="aiPlayBtn" class="ai-control-btn">🔊 Play</button>
          <button id="aiStopBtn" class="ai-control-btn">⏹ Stop</button>
          <button id="aiCopyBtn" class="ai-control-btn ai-copy-btn">📋 Copy</button>
        </div>
        <div class="ai-success-note">
          Generated from ${provider}${result.fromCache ? ' (cached result)' : ''}
        </div>
      `;

      // Attach event listeners
      document.getElementById('aiPlayBtn').addEventListener('click', () => {
        this.playAudio(result.text);
      });

      document.getElementById('aiStopBtn').addEventListener('click', () => {
        TTSControl.stop();
      });

      document.getElementById('aiCopyBtn').addEventListener('click', (e) => {
        this.copyToClipboard(result.text, e.target);
      });

    } catch (err) {
      console.error('[AI MODAL] Error:', err);
      providerEl.textContent = `${provider} (error)`;
      body.innerHTML = `
        <div class="ai-error-box">
          <strong>Error</strong><br/>
          ${err.message || 'An unexpected error occurred.'}
        </div>
      `;
    }
  }

  /**
   * Close modal
   */
  close() {
    TTSControl.stop(); // Stop any playing audio
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
    this.isOpen = false;
  }

  /**
   * Play biography as audio
   */
  playAudio(text) {
    TTSControl.speak(text);
  }

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text, btnEl) {
    try {
      await navigator.clipboard.writeText(text);
      btnEl.textContent = '✓ Copied!';
      btnEl.classList.add('copied');
      setTimeout(() => {
        btnEl.textContent = '📋 Copy';
        btnEl.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.error('[COPY] Error:', err);
      alert('Failed to copy to clipboard');
    }
  }

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// Global instance
const aiModal = new AIBiographyModal();
