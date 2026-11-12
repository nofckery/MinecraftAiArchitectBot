/**
 * Version Chips Management for Onboarding Wizard and Settings Modal.
 */

export const SUPPORTED_VERSIONS_FALLBACK = [
  { version: 'auto', label: 'auto (Empfohlen)' },
  { version: '26.3', label: '26.3 (SOTA)' },
  { version: '1.21.4', label: '1.21.4' },
  { version: '1.21.1', label: '1.21.1' },
  { version: '1.20.4', label: '1.20.4' },
  { version: '1.20.1', label: '1.20.1' }
];

export function updateVersionChipsActive(containerId, versionValue) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const targetVer = (versionValue || 'auto').toString().trim().toLowerCase();
  const chips = container.querySelectorAll('.chip-sm');
  chips.forEach(chip => {
    const chipVer = (chip.dataset.ver || '').toLowerCase();
    chip.classList.toggle('active', chipVer === targetVer);
  });
}

export function setupVersionChips(containerId, inputId, versions = SUPPORTED_VERSIONS_FALLBACK) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  if (Array.isArray(versions) && versions.length > 0) {
    container.innerHTML = versions.map(v => {
      const ver = typeof v === 'string' ? v : v.version;
      const label = typeof v === 'string' ? v : (v.label || v.version);
      return `<button type="button" class="chip-sm" data-ver="${ver}">${label}</button>`;
    }).join('\n');
  }

  const chips = container.querySelectorAll('.chip-sm');
  chips.forEach(chip => {
    chip.onclick = () => {
      const ver = chip.dataset.ver;
      input.value = ver;
      updateVersionChipsActive(containerId, ver);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });

  if (!input._hasVersionChipSync) {
    input.addEventListener('input', () => {
      updateVersionChipsActive(containerId, input.value);
    });
    input._hasVersionChipSync = true;
  }

  updateVersionChipsActive(containerId, input.value || 'auto');
}
