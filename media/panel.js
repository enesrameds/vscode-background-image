(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);

  const sliders = Array.from(document.querySelectorAll('input[type="range"]'));
  const selects = Array.from(document.querySelectorAll('select'));
  const outputs = Array.from(document.querySelectorAll('output'));

  let image = null;
  let imageName = '';

  const SIZE_CSS = { cover: 'cover', contain: 'contain', stretch: '100% 100%' };
  const POSITION_CSS = {
    center: 'center', top: 'top', bottom: 'bottom', left: 'left', right: 'right',
    'top-left': 'left top', 'top-right': 'right top',
    'bottom-left': 'left bottom', 'bottom-right': 'right bottom'
  };

  function values() {
    const o = {};
    sliders.forEach((r) => { o[r.id] = parseFloat(r.value); });
    selects.forEach((s) => { o[s.id] = s.value; });
    o.enabled = $('#enabled').checked;
    o.autoApply = $('#autoApply').checked;
    o.stickyScroll = $('#stickyScroll').checked;
    o.transparentTabs = $('#transparentTabs').checked;
    return o;
  }

  function filterText(a) {
    const p = [];
    if (a.blur > 0) p.push('blur(' + a.blur + 'px)');
    if (Math.abs(a.brightness - 1) > 0.001) p.push('brightness(' + a.brightness + ')');
    if (Math.abs(a.contrast - 1) > 0.001) p.push('contrast(' + a.contrast + ')');
    if (Math.abs(a.saturation - 1) > 0.001) p.push('saturate(' + a.saturation + ')');
    if (a.grayscale > 0) p.push('grayscale(' + a.grayscale + ')');
    return p.join(' ');
  }

  function updatePreview() {
    const a = values();
    const layer = $('#layer');

    const dim = 'linear-gradient(rgba(0,0,0,' + a.dim + '), rgba(0,0,0,' + a.dim + '))';
    const visual = image
      ? 'url("' + image + '")'
      : 'linear-gradient(135deg, #2a3b57 0%, #141a26 100%)';

    layer.style.backgroundImage = dim + ', ' + visual;

    const size = SIZE_CSS[a.size] || 'cover';
    const position = POSITION_CSS[a.position] || 'center';
    layer.style.backgroundSize = size + ', ' + size;
    layer.style.backgroundPosition = position + ', ' + position;
    layer.style.backgroundRepeat = a.repeat + ', ' + a.repeat;
    layer.style.opacity = String(a.opacity);
    layer.style.filter = filterText(a) || 'none';

    $('#mock').className = 'mock mode-' + a.area + (a.transparentTabs ? ' mode-opentabs' : '');
    const stickyRow = $('#mSticky');
    if (stickyRow) stickyRow.style.display = a.stickyScroll ? 'flex' : 'none';
    $('#empty').style.display = image ? 'none' : 'flex';

    $('#file').textContent = imageName || (image ? 'Selected image' : 'No image selected');

    outputs.forEach((o) => {
      const match = sliders.find((r) => r.id === o.getAttribute('for'));
      if (!match) return;
      const v = parseFloat(match.value);
      const step = parseFloat(match.step);
      o.textContent = step < 1 ? v.toFixed(2) : String(v);
    });

    const pill = $('#pill');
    pill.textContent = a.enabled ? 'On' : 'Off';
    pill.className = 'pill ' + (a.enabled ? 'on' : 'off');
  }

  function applyStatus(d) {
    const a = d.settings || {};
    sliders.forEach((r) => {
      if (typeof a[r.id] === 'number') r.value = String(a[r.id]);
    });
    selects.forEach((s) => {
      if (a[s.id]) s.value = a[s.id];
    });
    $('#enabled').checked = !!a.enabled;
    $('#autoApply').checked = !!a.autoApply;
    $('#stickyScroll').checked = a.stickyScroll !== false;
    $('#transparentTabs').checked = !!a.transparentTabs;

    image = d.image || null;
    imageName = d.imageName || '';
    updatePreview();

    $('#path').textContent = d.css ? 'CSS: ' + d.css : '';
    $('#detail').textContent = d.patched
      ? 'Interface file patched. Reload the window to see the changes.'
      : 'Not applied yet.';
  }

  function showMessage(level, text) {
    const el = $('#message');
    el.className = 'message ' + (level || 'info');
    el.textContent = text || '';
  }

  function loadImage(dataUri) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The image could not be decoded.'));
      img.src = dataUri;
    });
  }

  async function prepareImage(dataUri, mime) {
    let img;
    try {
      img = await loadImage(dataUri);
    } catch (e) {
      return { dataUri: dataUri, mime: mime };
    }

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return { dataUri: dataUri, mime: mime };

    const MAX = 2048;
    const scale = Math.min(1, MAX / Math.max(width, height));
    const shrink = scale < 1;
    const tooBig = dataUri.length > 1800000;

    if (!shrink && !tooBig) {
      return { dataUri: dataUri, mime: mime, w: width, h: height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext('2d');
    if (mime && mime !== 'image/png' && mime !== 'image/svg+xml') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const usePng = mime === 'image/png';
    let output = usePng
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.85);

    if (output.length > 2200000 && usePng) {
      const flat = document.createElement('canvas');
      flat.width = canvas.width;
      flat.height = canvas.height;
      const fz = flat.getContext('2d');
      fz.fillStyle = '#ffffff';
      fz.fillRect(0, 0, flat.width, flat.height);
      fz.drawImage(canvas, 0, 0);
      output = flat.toDataURL('image/jpeg', 0.85);
      return { dataUri: output, mime: 'image/jpeg', w: flat.width, h: flat.height };
    }

    return {
      dataUri: output,
      mime: usePng ? 'image/png' : 'image/jpeg',
      w: canvas.width,
      h: canvas.height
    };
  }

  async function processImage(raw) {
    showMessage('info', 'Processing image...');
    const mime = (raw.mime || (raw.dataUri.match(/^data:([^;]+);/) || [])[1] || '');
    const result = await prepareImage(raw.dataUri, mime);
    vscode.postMessage({
      type: 'saveImage',
      dataUri: result.dataUri,
      name: raw.name || 'image',
      path: raw.path || ''
    });
  }

  function sendSetting(el) {
    const value = el.type === 'checkbox' ? el.checked
      : el.type === 'range' ? parseFloat(el.value)
        : el.value;
    vscode.postMessage({ type: 'setting', key: el.id, value: value });
  }

  sliders.forEach((r) => {
    r.addEventListener('input', updatePreview);
    r.addEventListener('change', () => { updatePreview(); sendSetting(r); });
  });

  selects.forEach((s) => {
    s.addEventListener('change', () => { updatePreview(); sendSetting(s); });
  });

  ['enabled', 'autoApply', 'stickyScroll', 'transparentTabs'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('change', () => { updatePreview(); sendSetting(el); });
  });

  $('#btnChoose').addEventListener('click', () => vscode.postMessage({ type: 'chooseImage' }));
  $('#btnApply').addEventListener('click', () => vscode.postMessage({ type: 'apply' }));
  $('#btnReload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
  $('#btnReset').addEventListener('click', () => vscode.postMessage({ type: 'reset' }));
  $('#btnRemove').addEventListener('click', () => vscode.postMessage({ type: 'remove' }));

  ['dragover', 'dragenter'].forEach((name) => {
    document.addEventListener(name, (e) => {
      e.preventDefault();
      document.body.classList.add('dropping');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    document.addEventListener(name, (e) => {
      e.preventDefault();
      if (name === 'dragleave' && e.relatedTarget) return;
      document.body.classList.remove('dropping');
    });
  });

  document.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (file.type && !/^image\//.test(file.type)) {
      showMessage('error', 'Only image files are supported.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      processImage({ dataUri: reader.result, name: file.name, path: '' });
    };
    reader.onerror = () => showMessage('error', 'The file could not be read.');
    reader.readAsDataURL(file);
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m) return;

    switch (m.type) {
      case 'status':
        applyStatus(m);
        break;

      case 'image':
        processImage(m);
        break;

      case 'message':
        showMessage(m.level, m.text);
        break;

      case 'reloadNeeded':
        showMessage('info', m.text);
        break;

      default:
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
  updatePreview();
})();
