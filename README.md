# Background Image — VS Code Extension

Put your own photo or wallpaper behind the VS Code interface by uploading an image
directly, and manage **opacity, contrast, brightness, saturation, grayscale, blur,
dim, size, position, repeat and scope** from a single **live-preview panel**.

Unlike other background extensions you do not have to edit settings files: open the
Command Palette, run `Background: Background Image Settings`, pick your image, move the
sliders, then press **Apply → Reload Window**.

---

## Installation

1. Download `background-image-1.0.0.vsix` from the
   [latest release](../../releases/latest).
2. In VS Code press `Ctrl+Shift+P` and run **Extensions: Install from VSIX...** and
   pick the downloaded file.

   Command line alternative:

   ```bash
   code --install-extension background-image-1.0.0.vsix
   ```

3. **Quit VS Code completely and open it again once** (only required right after the
   first install — see [Important notes](#important-notes)).
4. Press `Ctrl+Shift+P` → **Background: Background Image Settings** → **Choose Image...**
   → adjust the sliders → **Apply → Reload Window**.

To uninstall, open the **Extensions** view, select **Background Image** and press
**Uninstall**.

---

## Features

| Feature | Description |
| --- | --- |
| 🖼️ Easy image picking | Pick a file from the panel **or drag and drop it onto the panel** |
| 🎚️ Every visual control | Opacity, contrast, brightness, saturation, grayscale, blur, dim |
| 📐 Layout | Size (cover / contain / stretch), position (9 anchors), repeat |
| 🎯 Scope | The entire interface **or** the editor area only |
| 📑 Interface bands | Sticky scroll band and tab fills can be toggled |
| 👀 Live preview | Real-time preview on a mock VS Code interface |
| ⚡ Auto apply | The background updates itself whenever a setting changes |
| 🔄 Update proof | If VS Code rewrites the CSS file, the extension re-applies itself |
| 🧹 One click to undo | `Background: Remove Background` restores the original files |

---

## Run from source (contributors)

1. Open this folder in VS Code (`vscode-background-image`).
2. Press **F5** to start an **Extension Development Host** window.
3. In the new window press `Ctrl+Shift+P` and run **Background: Background Image Settings**.
4. Click **Choose Image...** (drag and drop works too).
5. Adjust the sliders → **Apply** → **Reload Window**.

### Install permanently (without debugging)

```bash
cd vscode-background-image
npx @vscode/vsce package
code --install-extension background-image-1.0.0.vsix
```

---

## Important notes

- **"Your Code installation appears to be corrupt" warning:** to show the image, the
  extension appends a small CSS block to VS Code's own interface file
  (`resources/app/out/vs/workbench/workbench.desktop.main.css`). The extension removes
  the checksum entry of that file while the block is present, so the warning normally
  does not appear. Removing the background restores everything.
- **Write permission:** if VS Code is installed in a protected folder such as
  `C:/Program Files`, the first apply may fail with a permission error. Start VS Code
  **once as administrator**, or install it to your user folder.
- **Seeing the changes:** CSS files of an `vscode-file://` page are cached by Chromium
  and **"Reload Window" alone does not bypass that cache**. Every time the extension
  rewrites the CSS it also appends a `?v=<timestamp>` query to the stylesheet `<link>`
  in `workbench.html`, so a plain **Reload Window** always picks up the new CSS.
- **One full restart after installation:** the "installation appears to be corrupt"
  check is performed by the main process, which keeps `product.json` in memory. After
  installing (or updating) the extension, **quit VS Code completely once and open it
  again** so the checksum entries are read from disk.
- **Multiple windows:** keep the `background.*` values in your **user** settings. If a
  workspace `.vscode/settings.json` overrides them, two open windows can overwrite each
  other's CSS file.
- **Where is the image stored?** The selected image is copied (and downscaled) into the
  extension's global storage folder; the `background.image` setting only keeps the
  original file path, so large photos never bloat the CSS file.

---

## Settings (`settings.json`)

| Setting | Default | Description |
| --- | --- | --- |
| `background.enabled` | `false` | Enable the background |
| `background.image` | `""` | Image file path |
| `background.opacity` | `0.75` | Image opacity (0–1) |
| `background.contrast` | `1.1` | Contrast (0–3) |
| `background.brightness` | `1` | Brightness (0–3) |
| `background.saturation` | `1.1` | Color saturation (0–3) |
| `background.grayscale` | `0` | Grayscale amount (0–1) |
| `background.blur` | `0` | Blur in pixels (0–60) |
| `background.dim` | `0.35` | Dark overlay for readability (0–1) |
| `background.size` | `cover` | `cover` \| `contain` \| `stretch` |
| `background.position` | `center` | `center`, `top`, `bottom-left`, … |
| `background.repeat` | `no-repeat` | `no-repeat`, `repeat`, `repeat-x`, `repeat-y` |
| `background.area` | `all` | `all` (whole UI) \| `editor` (editor only) |
| `background.stickyScroll` | `true` | Show VS Code's sticky scroll band. Turn off for a seamless background |
| `background.transparentTabs` | `false` | Make the tab fills transparent |
| `background.autoApply` | `true` | Apply automatically when a setting changes |

---

## Commands

- `Background: Background Image Settings` — open the settings panel
- `Background: Choose Image...` — open the file picker
- `Background: Apply Background` — write the CSS file
- `Background: Remove Background` — undo every change
- `Background: Reset to Defaults` — restore the default visual settings

---

## How it works

1. The panel sliders update the `background.*` settings.
2. The extension builds a **marker-delimited CSS block** from the settings and the stored image.
3. The block is appended to `workbench.desktop.main.css` (an existing block is replaced).
4. The block draws the dim layer plus the image on `.monaco-workbench::before` and keeps
   the image **behind the interface** using `z-index: -1` together with `isolation: isolate`.
   Only the selected scope (`all` / `editor`) is made transparent with
   `background-color: transparent`, so the image shows up there and nowhere else.
   The breadcrumb bar, its type badge and the sticky scroll band are handled here as well.
5. Every CSS write also refreshes the `workbench.html` stylesheet link with a `?v=` query,
   so the Chromium cache cannot serve a stale stylesheet.
6. Reloading the window picks up the new CSS.
