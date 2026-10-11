'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const START = '/* BACKGROUND-IMAGE:START */';
const END = '/* BACKGROUND-IMAGE:END */';

const DEFAULTS = {
  opacity: 0.75,
  contrast: 1.1,
  brightness: 1,
  saturation: 1.1,
  grayscale: 0,
  blur: 0,
  dim: 0.35,
  size: 'cover',
  position: 'center',
  repeat: 'no-repeat',
  area: 'all'
};

const SLIDERS = [
  ['opacity', 'Opacity', 0, 1, 0.01],
  ['contrast', 'Contrast', 0, 3, 0.01],
  ['brightness', 'Brightness', 0, 3, 0.01],
  ['saturation', 'Saturation', 0, 3, 0.01],
  ['grayscale', 'Grayscale', 0, 1, 0.01],
  ['blur', 'Blur (px)', 0, 60, 1],
  ['dim', 'Dim overlay', 0, 1, 0.01]
];

const SELECTS = [
  ['size', 'Size', [
    ['cover', 'Cover'],
    ['contain', 'Contain'],
    ['stretch', 'Stretch']
  ]],
  ['position', 'Position', [
    ['center', 'Center'],
    ['top', 'Top'],
    ['bottom', 'Bottom'],
    ['left', 'Left'],
    ['right', 'Right'],
    ['top-left', 'Top left'],
    ['top-right', 'Top right'],
    ['bottom-left', 'Bottom left'],
    ['bottom-right', 'Bottom right']
  ]],
  ['repeat', 'Repeat', [
    ['no-repeat', 'No repeat'],
    ['repeat', 'Repeat all'],
    ['repeat-x', 'Repeat horizontally'],
    ['repeat-y', 'Repeat vertically']
  ]],
  ['area', 'Apply to', [
    ['all', 'Entire interface'],
    ['editor', 'Editor only']
  ]]
];

const ALLOWED_SETTINGS = new Set([
  'enabled', 'autoApply', 'image',
  'stickyScroll', 'transparentTabs',
  ...Object.keys(DEFAULTS)
]);

const SIZE_CSS = { cover: 'cover', contain: 'contain', stretch: '100% 100%' };
const POSITION_CSS = {
  center: 'center', top: 'top', bottom: 'bottom', left: 'left', right: 'right',
  'top-left': 'left top', 'top-right': 'right top',
  'bottom-left': 'left bottom', 'bottom-right': 'right bottom'
};

let EXT_CTX = null;
let panel = null;
let cssPathCache = undefined;
let applyTimer = null;
let lastNotify = 0;
let importedSource = null;

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return s;
}

function post(message) {
  if (!panel) return;
  try { Promise.resolve(panel.webview.postMessage(message)).catch(() => {}); } catch (_) { }
}

function readSettings() {
  const c = vscode.workspace.getConfiguration('background');
  return {
    enabled: !!c.get('enabled', false),
    autoApply: !!c.get('autoApply', true),
    stickyScroll: !!c.get('stickyScroll', true),
    transparentTabs: !!c.get('transparentTabs', false),
    image: String(c.get('image', '') || ''),
    opacity: clamp(c.get('opacity'), 0, 1, DEFAULTS.opacity),
    contrast: clamp(c.get('contrast'), 0, 3, DEFAULTS.contrast),
    brightness: clamp(c.get('brightness'), 0, 3, DEFAULTS.brightness),
    saturation: clamp(c.get('saturation'), 0, 3, DEFAULTS.saturation),
    grayscale: clamp(c.get('grayscale'), 0, 1, DEFAULTS.grayscale),
    blur: clamp(c.get('blur'), 0, 60, DEFAULTS.blur),
    dim: clamp(c.get('dim'), 0, 1, DEFAULTS.dim),
    size: SIZE_CSS[c.get('size')] ? c.get('size') : DEFAULTS.size,
    position: POSITION_CSS[c.get('position')] ? c.get('position') : DEFAULTS.position,
    repeat: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].includes(c.get('repeat'))
      ? c.get('repeat') : DEFAULTS.repeat,
    area: ['all', 'editor'].includes(c.get('area')) ? c.get('area') : DEFAULTS.area
  };
}

function filterText(s) {
  const parts = [];
  if (s.blur > 0) parts.push(`blur(${s.blur}px)`);
  if (Math.abs(s.brightness - 1) > 0.001) parts.push(`brightness(${s.brightness})`);
  if (Math.abs(s.contrast - 1) > 0.001) parts.push(`contrast(${s.contrast})`);
  if (Math.abs(s.saturation - 1) > 0.001) parts.push(`saturate(${s.saturation})`);
  if (s.grayscale > 0) parts.push(`grayscale(${s.grayscale})`);
  return parts.join(' ');
}

const KOK = '.monaco-workbench'.repeat(6);

function transparentRules(area) {
  const line = '  background-color: transparent !important;';
  const editor = [
    '.part.editor',
    '.part.editor .content',
    '.part.editor .part-body',
    '.part.editor .title',
    '.part.editor .editor-group-container',
    '.part.editor .editor-group-container .editor-group-header',
    '.part.editor .tabs-and-actions-container',
    '.part.editor .breadcrumbs-below-tabs',
    '.part.editor .breadcrumbs-control',
    '.part.editor .breadcrumbs-editor-type',
    '.part.editor .monaco-scrollable-element',
    '.part.editor .monaco-breadcrumbs',
    '.part.editor .editor-container',
    '.part.editor .editor-instance',
    '.part.editor .monaco-editor',
    '.part.editor .monaco-editor .margin',
    '.part.editor .monaco-editor .monaco-editor-background',
    '.part.editor .monaco-editor .overflow-guard',
    '.part.editor .monaco-editor .scroll-decoration',
    '.part.editor .scroll-decoration'
  ];
  const all = [
    '.monaco-grid-view',
    '.part',
    '.part .content',
    '.part .part-body',
    '.part .title',
    '.editor-group-container',
    '.editor-group-container .editor-group-header',
    '.editor-group-container .tabs-and-actions-container',
    '.tabs-and-actions-container',
    '.breadcrumbs-below-tabs',
    '.breadcrumbs-control',
    '.breadcrumbs-editor-type',
    '.monaco-scrollable-element',
    '.monaco-breadcrumbs',
    '.editor-container',
    '.editor-instance',
    '.monaco-editor',
    '.monaco-editor .margin',
    '.monaco-editor .monaco-editor-background',
    '.monaco-editor .overflow-guard',
    '.monaco-editor .scroll-decoration',
    '.scroll-decoration',
    '.monaco-pane-view .pane',
    '.pane',
    '.monaco-list',
    '.monaco-list-rows'
  ];
  const selectors = (area === 'editor' ? editor : all).map((s) => KOK + ' ' + s);
  return selectors.join(',\n') + ' {\n' + line + '\n}';
}

function extraRules(s) {
  const parts = [];
  if (!s.stickyScroll) {
    parts.push(`${KOK} .sticky-widget,\n${KOK} .sticky-widget-lines-scrollable {\n  display: none !important;\n}`);
  }
  if (s.transparentTabs) {
    parts.push(`${KOK} .tab-fill {\n  background-color: transparent !important;\n}`);
  }
  return parts.join('\n\n');
}

function createBlock(s, dataUri) {
  const dim = `linear-gradient(rgba(0,0,0,${s.dim}), rgba(0,0,0,${s.dim}))`;
  const layers = `${dim}, url("${dataUri}")`;
  const size = SIZE_CSS[s.size] || 'cover';
  const position = POSITION_CSS[s.position] || 'center';
  const bleed = Math.min(60, Math.ceil(s.blur * 2));
  const box = bleed > 0
    ? `  top: -${bleed}px; right: -${bleed}px; bottom: -${bleed}px; left: -${bleed}px;`
    : '  top: 0; right: 0; bottom: 0; left: 0;';
  const filter = filterText(s);
  const anchor = s.area === 'editor'
    ? '.monaco-workbench .part.editor'
    : '.monaco-workbench';

  const lines = [
    START,
    `${anchor} { position: relative; isolation: isolate; }`,
    `${anchor}::before {`,
    '  content: "";',
    '  position: absolute;',
    box,
    '  z-index: -1;',
    '  pointer-events: none;',
    `  background-image: ${layers};`,
    `  background-size: ${size}, ${size};`,
    `  background-position: ${position}, ${position};`,
    `  background-repeat: ${s.repeat}, ${s.repeat};`,
    `  opacity: ${s.opacity};`
  ];
  if (filter) lines.push(`  filter: ${filter};`);
  lines.push('}');
  lines.push(transparentRules(s.area));
  const extra = extraRules(s);
  if (extra) lines.push(extra);
  lines.push(END);
  return lines.join('\n');
}

function findCssFile() {
  if (cssPathCache !== undefined) return cssPathCache || null;

  const dir = path.dirname(process.execPath);
  const rel = path.join('resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
  const candidates = [
    path.join(dir, rel),
    path.join(dir, '..', 'Resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.css'),
    path.join(dir, 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.css')
  ];

  try {
    for (const entry of fs.readdirSync(dir)) {
      candidates.push(path.join(dir, entry, rel));
    }
  } catch (_) { }

  let found = null;
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) { found = candidate; break; }
    } catch (_) { }
  }
  cssPathCache = found || false;
  return cssPathCache || null;
}

let htmlPathCache = undefined;

function findHtmlFile(cssFile) {
  if (htmlPathCache !== undefined) return htmlPathCache || null;
  const outDir = path.resolve(path.dirname(cssFile), '..', '..');
  const candidates = [
    path.join(outDir, 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
    path.join(outDir, 'vs', 'code', 'electron-browser', 'workbench.html'),
    path.join(outDir, 'vs', 'workbench', 'workbench.html')
  ];
  let found = null;
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) { found = candidate; break; }
    } catch (_) { }
  }
  htmlPathCache = found || false;
  return htmlPathCache || null;
}

const HREF_RE = /(href="[^"]*workbench\.desktop\.main\.css)(?:\?[^"]*)?(")/;

function rewriteHtmlLink(mode) {
  const css = findCssFile();
  const html = css ? findHtmlFile(css) : null;
  if (!html) return;
  let raw;
  try { raw = fs.readFileSync(html, 'utf8'); } catch (_) { return; }
  const found = raw.match(HREF_RE);
  if (!found) return;
  const hasStamp = found[0].indexOf('?v=') !== -1;
  if (mode === 'ensure' && hasStamp) return;
  if (mode === 'clear' && !hasStamp) return;
  const stamp = mode === 'clear' ? '' : '?v=' + Date.now();
  const next = raw.replace(HREF_RE, (full, head, tail) => head + stamp + tail);
  if (next === raw) return;
  try { fs.writeFileSync(html, next, 'utf8'); } catch (_) { return; }
  let hasBlock = false;
  try { hasBlock = existingBlock(css) !== null; } catch (_) { }
  syncChecksum(css, hasBlock);
}

const CHECKSUM_ENTRIES = [
  ['vs/workbench/workbench.desktop.main.css', 'backgroundImageOriginalChecksum'],
  ['vs/code/electron-browser/workbench/workbench.html', 'backgroundImageOriginalHtmlChecksum']
];

function productJsonPath(cssFile) {
  return path.resolve(path.dirname(cssFile), '..', '..', '..', 'product.json');
}

function htmlStamped(cssFile) {
  const html = findHtmlFile(cssFile);
  if (!html) return false;
  try {
    const raw = fs.readFileSync(html, 'utf8');
    const found = raw.match(HREF_RE);
    return !!found && found[0].indexOf('?v=') !== -1;
  } catch (_) {
    return false;
  }
}

function syncChecksum(cssFile, blockPresent) {
  const pj = productJsonPath(cssFile);
  if (!fs.existsSync(pj)) return;
  let raw;
  try { raw = fs.readFileSync(pj, 'utf8'); } catch (_) { return; }
  let data;
  try { data = JSON.parse(raw); } catch (_) { return; }
  const checksums = data.checksums;
  if (!checksums || typeof checksums !== 'object') return;

  const states = [blockPresent, htmlStamped(cssFile)];
  let changed = false;
  for (let i = 0; i < CHECKSUM_ENTRIES.length; i++) {
    const key = CHECKSUM_ENTRIES[i][0];
    const savedKey = CHECKSUM_ENTRIES[i][1];
    if (states[i]) {
      if (typeof checksums[key] === 'string') {
        if (!(savedKey in data)) data[savedKey] = checksums[key];
        delete checksums[key];
        changed = true;
      }
    } else if (savedKey in data) {
      if (typeof data[savedKey] === 'string') checksums[key] = data[savedKey];
      delete data[savedKey];
      changed = true;
    }
  }
  if (!changed) return;

  try {
    const pretty = /[\r\n]/.test(raw);
    fs.writeFileSync(pj, JSON.stringify(data, null, pretty ? 2 : 0), 'utf8');
  } catch (_) { }
}

function existingBlock(file) {
  const css = fs.readFileSync(file, 'utf8');
  const s = css.indexOf(START);
  const e = css.indexOf(END);
  if (s === -1 || e === -1 || e < s) return null;
  return css.slice(s, e + END.length);
}

function writeError(err, file) {
  const code = err && err.code;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return 'No write permission for the VS Code install folder: ' + path.dirname(file) +
      '. Start VS Code once as administrator, or install VS Code to your user folder.';
  }
  return 'Could not write the interface file: ' + (err && err.message ? err.message : String(err));
}

function updateCss(fn) {
  const file = findCssFile();
  if (!file) {
    throw new Error('workbench.desktop.main.css was not found. This extension works through that file.');
  }
  let css;
  try {
    css = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(writeError(err, file));
  }
  const next = fn(css);
  if (next === css) return false;
  try {
    fs.writeFileSync(file, next, 'utf8');
  } catch (err) {
    throw new Error(writeError(err, file));
  }
  const hasBlock = next.indexOf(START) !== -1;
  rewriteHtmlLink(hasBlock ? 'stamp' : 'clear');
  syncChecksum(file, hasBlock);
  return true;
}

function placeBlock(block) {
  return updateCss((css) => {
    const s = css.indexOf(START);
    const e = css.indexOf(END);
    if (s !== -1 && e !== -1 && e > s) {
      return css.slice(0, s) + block + css.slice(e + END.length);
    }
    return css.replace(/\s*$/, '') + '\n\n' + block + '\n';
  });
}

function removeBlock() {
  return updateCss((css) => {
    const s = css.indexOf(START);
    const e = css.indexOf(END);
    if (s === -1 || e === -1 || e < s) return css;
    return css.slice(0, s) + css.slice(e + END.length);
  });
}

function isPatched() {
  try {
    const file = findCssFile();
    if (!file) return false;
    return existingBlock(file) !== null;
  } catch (_) {
    return false;
  }
}

function imageFile() {
  return path.join(EXT_CTX.globalStorageUri.fsPath, 'background.datauri');
}

function sniffMime(buf) {
  if (buf.length > 4) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
    if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  }
  const head = buf.slice(0, 300).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return 'image/png';
}

function fileToDataUri(file) {
  const buf = fs.readFileSync(file);
  return `data:${sniffMime(buf)};base64,${buf.toString('base64')}`;
}

async function writeImageDataUri(dataUri) {
  await fs.promises.mkdir(EXT_CTX.globalStorageUri.fsPath, { recursive: true });
  await fs.promises.writeFile(imageFile(), dataUri, 'utf8');
}

function resolvePath(value) {
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length) return path.join(folders[0].uri.fsPath, value);
  return path.resolve(value);
}

async function findImageDataUri() {
  try {
    if (fs.existsSync(imageFile())) {
      const content = fs.readFileSync(imageFile(), 'utf8').trim();
      if (content.startsWith('data:image/')) return content;
    }
  } catch (_) { }

  const s = readSettings();
  const file = resolvePath(s.image);
  if (file && fs.existsSync(file)) {
    try {
      const dv = fileToDataUri(file);
      await writeImageDataUri(dv);
      await EXT_CTX.globalState.update('sourcePath', s.image);
      importedSource = s.image;
      return dv;
    } catch (err) {
      console.error('[background] could not read image', err);
    }
  }
  return null;
}

async function importImage(value) {
  if (!value) {
    importedSource = '';
    await EXT_CTX.globalState.update('sourcePath', '');
    await EXT_CTX.globalState.update('imageName', '');
    try { if (fs.existsSync(imageFile())) await fs.promises.unlink(imageFile()); } catch (_) { }
    return true;
  }

  const full = resolvePath(value);
  if (!full || !fs.existsSync(full)) {
    vscode.window.showWarningMessage(`Background: image not found: ${value}`);
    return false;
  }

  try {
    const dv = fileToDataUri(full);
    await writeImageDataUri(dv);
    await EXT_CTX.globalState.update('sourcePath', value);
    await EXT_CTX.globalState.update('imageName', path.basename(full));
    importedSource = value;

    if (dv.length > 3000000) {
      vscode.window.showWarningMessage(
        'Background: the image is very large and may hurt performance. 1-2 MB is recommended.'
      );
    }
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(`Background: could not process the image: ${err.message || err}`);
    return false;
  }
}

async function chooseImage() {
  const selection = await vscode.window.showOpenDialog({
    title: 'Choose a background image',
    canSelectMany: false,
    canSelectFolders: false,
    canSelectFiles: true,
    openLabel: 'Choose',
    filters: {
      'Images': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif']
    }
  });

  if (!selection || !selection.length) return;

  const file = selection[0].fsPath;
  try {
    const dv = fileToDataUri(file);
    post({ type: 'image', dataUri: dv, name: path.basename(file), path: file });
  } catch (err) {
    vscode.window.showErrorMessage(`Background: could not read the image: ${err.message || err}`);
  }
}

async function saveImage(dataUri, name, source) {
  if (!dataUri || !dataUri.startsWith('data:image/')) return false;

  await writeImageDataUri(dataUri);
  await EXT_CTX.globalState.update('imageName', name || 'image');

  const cfg = vscode.workspace.getConfiguration('background');
  if (source) {
    importedSource = source;
    await EXT_CTX.globalState.update('sourcePath', source);
    await cfg.update('image', source, vscode.ConfigurationTarget.GLOBAL);
  } else {
    importedSource = String(cfg.get('image', '') || '');
    await EXT_CTX.globalState.update('sourcePath', importedSource);
  }

  if (!cfg.get('enabled', false)) {
    await cfg.update('enabled', true, vscode.ConfigurationTarget.GLOBAL);
  }

  if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
  await apply({ notify: true });
  return true;
}

async function apply(options = {}) {
  const notify = options.notify !== false;
  const s = readSettings();

  if (!s.enabled) {
    try {
      const changed = removeBlock();
      rewriteHtmlLink('clear');
      post({ type: 'message', level: 'info', text: 'Background removed.' });
      if (changed && notify) notifyReload('Background removed.');
    } catch (err) {
      vscode.window.showErrorMessage('Background: ' + err.message);
    }
    sendStatus();
    return false;
  }

  const dataUri = await findImageDataUri();
  if (!dataUri) {
    const text = 'Choose an image first.';
    post({ type: 'message', level: 'warning', text });
    if (notify && !panel) vscode.window.showWarningMessage('Background: ' + text);
    sendStatus();
    return false;
  }

  try {
    const changed = placeBlock(createBlock(s, dataUri));
    if (!changed) rewriteHtmlLink('ensure');
    if (changed && notify) notifyReload('Background applied.');
    post({
      type: 'message',
      level: 'info',
      text: changed
        ? 'Applied. Reload the window to see the changes.'
        : 'Already up to date.'
    });
    return true;
  } catch (err) {
    vscode.window.showErrorMessage('Background: ' + err.message);
    post({ type: 'message', level: 'error', text: err.message });
    return false;
  } finally {
    sendStatus();
  }
}

function scheduleApply(delay = 450) {
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(() => {
    applyTimer = null;
    apply({ notify: true }).catch((err) => {
      console.error('[background]', err);
    });
  }, delay);
}

function notifyReload(text) {
  const message = text + ' Reload the window to see the changes.';

  if (panel) {
    post({ type: 'reloadNeeded', text: message });
    return;
  }

  const now = Date.now();
  if (now - lastNotify < 25000) return;
  lastNotify = now;

  vscode.window.showInformationMessage(message, 'Reload Window').then((choice) => {
    if (choice === 'Reload Window') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });
}

async function statusObject() {
  const s = readSettings();
  const dataUri = await findImageDataUri();
  let imageName = EXT_CTX.globalState.get('imageName') || '';
  if (!imageName && s.image) imageName = path.basename(s.image);
  return {
    type: 'status',
    settings: s,
    image: dataUri,
    imageName,
    patched: isPatched(),
    css: findCssFile() || ''
  };
}

function sendStatus() {
  statusObject().then((obj) => post(obj)).catch((err) => console.error('[background]', err));
}

function buildHtml(webview) {
  const uri = (name) => webview.asWebviewUri(vscode.Uri.joinPath(EXT_CTX.extensionUri, 'media', name));
  const nonce = getNonce();

  const sliders = SLIDERS.map(([id, label, min, max, step]) => `
        <div class="ctl">
          <div class="ctl-head">
            <label for="${id}">${label}</label>
            <output for="${id}" id="${id}-out">-</output>
          </div>
          <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" />
        </div>`).join('');

  const selects = SELECTS.map(([id, label, options]) => `
        <div class="ctl">
          <div class="ctl-head"><label for="${id}">${label}</label></div>
          <select id="${id}">
            ${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${uri('panel.css')}" />
  <title>Background Settings</title>
</head>
<body>
  <header class="head">
    <div class="head-left">
      <h1>Background Image</h1>
      <span class="pill off" id="pill">Off</span>
    </div>
    <div class="head-right">
      <label class="check"><input type="checkbox" id="enabled" /><span>Enabled</span></label>
      <label class="check"><input type="checkbox" id="stickyScroll" /><span>Sticky scroll band</span></label>
      <label class="check"><input type="checkbox" id="transparentTabs" /><span>Transparent tabs</span></label>
      <label class="check"><input type="checkbox" id="autoApply" /><span>Auto apply</span></label>
    </div>
  </header>

  <section class="preview-wrap">
    <div class="preview" id="preview">
      <div class="layer" id="layer"></div>
      <div class="empty" id="empty">
        <span>Drop an image here</span>
        <em>or pick a file with "Choose Image..." below</em>
      </div>
      <div class="mock mode-all" id="mock">
        <div class="m-side">
          <i></i><i></i><i></i><i></i>
        </div>
        <div class="m-main">
          <div class="m-tabs"><b class="active">app.ts</b><b>panel.css</b></div>
          <div class="m-code">
            <div class="m-sticky" id="mSticky"><u>2</u> <k>function</k> <f>apply</f><d>(</d><v>opacity</v><d>)</d> <d>{</d></div>
            <div><u>1</u> <k>const</k> <v>background</v> <d>=</d> <s>"subtle"</s>;</div>
            <div><u>2</u> <k>function</k> <f>apply</f><d>(</d><v>opacity</v><d>:</d><t>number</t><d>)</d> <d>{</d></div>
            <div><u>3</u>&nbsp;&nbsp;<c>// keep the code readable</c></div>
            <div><u>4</u>&nbsp;&nbsp;<v>image</v><d>.</d><f>opacity</f> <d>=</d> <v>opacity</v><d>;</d></div>
            <div><u>5</u> <d>}</d></div>
            <div><u>6</u></div>
            <div><u>7</u> <f>apply</f><d>(</d><n>0.75</n><d>);</d></div>
          </div>
        </div>
        <div class="m-status"><b>Ready</b><b>UTF-8</b><b>Background Image</b></div>
      </div>
    </div>
    <div class="row">
      <button id="btnChoose" class="secondary">Choose Image...</button>
      <span class="file" id="file">No image selected</span>
      <span class="path" id="path"></span>
    </div>
  </section>

  <section class="grid">
    ${sliders}
  </section>

  <section class="grid">
    ${selects}
  </section>

  <footer class="footer">
    <div class="footer-buttons">
      <button id="btnApply" class="primary">Apply</button>
      <button id="btnReload" class="secondary">Reload Window</button>
      <button id="btnReset" class="secondary">Reset to Defaults</button>
      <button id="btnRemove" class="danger">Remove Background</button>
    </div>
    <div class="message info" id="message"></div>
    <div class="detail" id="detail"></div>
  </footer>

  <script nonce="${nonce}" src="${uri('panel.js')}"></script>
</body>
</html>`;
}

function bindPanel(p) {
  p.webview.html = buildHtml(p.webview);

  p.webview.onDidReceiveMessage(async (msg) => {
    try {
      await handleMessage(msg);
    } catch (err) {
      console.error('[background]', err);
      post({ type: 'message', level: 'error', text: String(err && err.message ? err.message : err) });
    }
  });

  p.onDidDispose(() => {
    if (panel === p) panel = null;
  });
}

function openPanel(column = vscode.ViewColumn.Beside) {
  if (panel) {
    panel.reveal(column);
    sendStatus();
    return panel;
  }
  panel = vscode.window.createWebviewPanel(
    'backgroundSettings',
    'Background Settings',
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(EXT_CTX.extensionUri, 'media')]
    }
  );
  bindPanel(panel);
  return panel;
}

async function resetDefaults() {
  const cfg = vscode.workspace.getConfiguration('background');
  for (const [key] of SLIDERS) {
    await cfg.update(key, DEFAULTS[key], vscode.ConfigurationTarget.GLOBAL);
  }
  for (const [key] of SELECTS) {
    await cfg.update(key, DEFAULTS[key], vscode.ConfigurationTarget.GLOBAL);
  }
  if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
  await apply({ notify: true });
  post({ type: 'message', level: 'info', text: 'Visual settings restored to defaults.' });
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const cfg = vscode.workspace.getConfiguration('background');

  switch (msg.type) {
    case 'ready':
      sendStatus();
      break;

    case 'chooseImage':
      await chooseImage();
      break;

    case 'image':
      post({ type: 'message', level: 'info', text: 'Processing image...' });
      post({ type: 'image', dataUri: msg.dataUri, name: msg.name || 'image', path: msg.path || '' });
      break;

    case 'saveImage':
      await saveImage(msg.dataUri, msg.name, msg.path || '');
      break;

    case 'setting':
      if (!ALLOWED_SETTINGS.has(msg.key)) return;
      await cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.GLOBAL);
      break;

    case 'apply':
      if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
      await apply({ notify: true });
      break;

    case 'reload':
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
      break;

    case 'reset':
      await resetDefaults();
      break;

    case 'remove':
      await cfg.update('enabled', false, vscode.ConfigurationTarget.GLOBAL);
      if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
      await apply({ notify: true });
      break;

    default:
      break;
  }
}

async function startupCheck() {
  const s = readSettings();
  const file = findCssFile();
  if (!file) return;

  let current = null;
  try { current = existingBlock(file); } catch (err) { console.error('[background]', err); return; }

  if (!s.enabled) {
    if (current !== null) {
      await apply({ notify: false });
    } else {
      rewriteHtmlLink('clear');
      syncChecksum(file, false);
    }
    return;
  }

  const dataUri = await findImageDataUri();
  if (!dataUri) return;

  if (current === createBlock(s, dataUri)) {
    rewriteHtmlLink('ensure');
    syncChecksum(file, true);
    return;
  }
  await apply({ notify: true });
}

function activate(context) {
  EXT_CTX = context;
  importedSource = context.globalState.get('sourcePath', null);

  const register = (command, handler) =>
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));

  register('background.settings', () => openPanel());
  register('background.chooseImage', async () => {
    openPanel();
    await chooseImage();
  });
  register('background.apply', async () => {
    if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
    await apply({ notify: true });
  });
  register('background.remove', async () => {
    await vscode.workspace.getConfiguration('background')
      .update('enabled', false, vscode.ConfigurationTarget.GLOBAL);
    if (applyTimer) { clearTimeout(applyTimer); applyTimer = null; }
    await apply({ notify: true });
  });
  register('background.reset', () => resetDefaults());

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (!e.affectsConfiguration('background')) return;

    const s = readSettings();

    if (importedSource === null) importedSource = s.image;
    if (s.image !== importedSource) {
      const ok = await importImage(s.image);
      if (!ok) return;
    }

    sendStatus();

    if (s.autoApply) scheduleApply();
  }));

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('backgroundSettings', {
      async deserializeWebviewPanel(saved) {
        panel = saved;
        panel.webview.options = {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
        };
        bindPanel(saved);
      }
    })
  );

  startupCheck().catch((err) => console.error('[background]', err));
}

function deactivate() {
  if (applyTimer) clearTimeout(applyTimer);
}

module.exports = { activate, deactivate };
