/**
 * Architect Mission Control — Schematics UI Submodule
 * Manages schematic library browsing, file upload via multipart FormData,
 * URL remote import, and 3D preview loading.
 */

import { sendWS } from './wsClient.js';

let activeSender = sendWS;

export async function loadSchematicsList() {
  const schematicFilesList = document.getElementById('schematicFilesList');
  if (!schematicFilesList) return;

  try {
    const res = await fetch('/api/schematics');
    const data = await res.json();
    schematicFilesList.innerHTML = '';

    if (!data.files || data.files.length === 0) {
      schematicFilesList.innerHTML = '<span class="empty-hint">Keine Schematics vorhanden.</span>';
      return;
    }

    for (const f of data.files) {
      const item = document.createElement('div');
      item.className = 'schem-file-item';

      const info = document.createElement('div');
      info.className = 'schem-file-info';

      const name = document.createElement('span');
      name.className = 'schem-file-name';
      name.textContent = f.name;

      const meta = document.createElement('span');
      meta.className = 'schem-file-meta';
      meta.textContent = `${(f.size / 1024).toFixed(1)} KB • .${f.format}`;

      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'schem-file-actions';

      const addSceneBtn = document.createElement('button');
      addSceneBtn.className = 'btn btn-primary btn-sm';
      addSceneBtn.textContent = '+ Szene';
      addSceneBtn.title = 'Als zusätzliches Gebäude in die 3D-Weltszene einfügen';
      addSceneBtn.onclick = () => {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('cad:add-schematic', { detail: { filename: f.name } }));
        }
      };

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-secondary btn-sm';
      loadBtn.textContent = '3D-Editor';
      loadBtn.title = 'In 3D-Editor laden';
      loadBtn.onclick = () => {
        activeSender({ type: 'load_saved_schematic', filename: f.name });
      };

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn btn-secondary btn-sm';
      dlBtn.textContent = '📥';
      dlBtn.title = 'Als .schem herunterladen';
      dlBtn.onclick = () => {
        window.open(`/api/schematics/export/${encodeURIComponent(f.name.replace(/\.[^/.]+$/, ''))}`);
      };

      actions.appendChild(addSceneBtn);
      actions.appendChild(loadBtn);
      actions.appendChild(dlBtn);
      item.appendChild(info);
      item.appendChild(actions);
      schematicFilesList.appendChild(item);
    }
  } catch (err) {
    schematicFilesList.innerHTML = `<span class="empty-hint">Fehler: ${err.message}</span>`;
  }
}

export async function uploadSchematicFile(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/schematics/upload', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (result.success) {
      loadSchematicsList();
    } else {
      alert(`Fehler beim Upload: ${result.error}`);
    }
  } catch (err) {
    alert(`Upload-Fehler: ${err.message}`);
  } finally {
    const fileInput = document.getElementById('schematicFileInput');
    if (fileInput) fileInput.value = '';
  }
}

export async function importFromUrl(url) {
  if (!url) return;
  const txtSchemUrl = document.getElementById('txtSchemUrl');
  try {
    const res = await fetch('/api/schematics/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const result = await res.json();
    if (result.success) {
      if (txtSchemUrl) txtSchemUrl.value = '';
      loadSchematicsList();
    } else {
      alert(`Fehler beim Import: ${result.error}`);
    }
  } catch (err) {
    alert(`Import-Fehler: ${err.message}`);
  }
}

export function initSchematics(sendWsFn = null) {
  if (sendWsFn) activeSender = sendWsFn;

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const btnBrowseFile = document.getElementById('btnBrowseFile');
  const txtSchemUrl = document.getElementById('txtSchemUrl');
  const btnImportUrl = document.getElementById('btnImportUrl');
  const btnRefreshSchematics = document.getElementById('btnRefreshSchematics');
  const btnCloneServerRegion = document.getElementById('btnCloneServerRegion');

  if (dropZone && fileInput) {
    if (btnBrowseFile) btnBrowseFile.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      if (e.target.files.length > 0) uploadSchematicFile(e.target.files[0]);
    };

    dropZone.ondragover = (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    };
    dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        uploadSchematicFile(e.dataTransfer.files[0]);
      }
    };
  }

  if (btnImportUrl && txtSchemUrl) {
    btnImportUrl.onclick = () => importFromUrl(txtSchemUrl.value.trim());
  }

  if (btnRefreshSchematics) {
    btnRefreshSchematics.onclick = loadSchematicsList;
  }

  if (btnCloneServerRegion) {
    btnCloneServerRegion.onclick = () => {
      const minX = parseInt(document.getElementById('cloneMinX')?.value, 10) || 0;
      const minY = parseInt(document.getElementById('cloneMinY')?.value, 10) || 64;
      const minZ = parseInt(document.getElementById('cloneMinZ')?.value, 10) || 0;
      const maxX = parseInt(document.getElementById('cloneMaxX')?.value, 10) || 15;
      const maxY = parseInt(document.getElementById('cloneMaxY')?.value, 10) || 75;
      const maxZ = parseInt(document.getElementById('cloneMaxZ')?.value, 10) || 15;

      activeSender({
        type: 'clone_server_region',
        minX, minY, minZ, maxX, maxY, maxZ
      });
    };
  }
}
