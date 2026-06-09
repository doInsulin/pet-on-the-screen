# Pet on the Screen

A tiny Windows desktop pet app starring Xiao Budian, a playful white Bichon Frise. The pet lives in a transparent always-on-top Electron window, reacts to clicks and keyboard shortcuts, and can wander, nap, beg for food, tug, drink water, dig, sniff, and run around the screen.

## Features

- Transparent, frameless, always-on-top desktop pet window
- Sprite-sheet based Bichon rendering with a canvas-drawn fallback
- Right-click to quit, tray menu support, and draggable window
- Needs-driven behavior: energy, sleepiness, hunger, social need, playfulness, curiosity, thirst, and calm
- Parkour mode moves the desktop window around the screen, then returns home
- Long sleep behavior for quiet companionship
- Keyboard shortcuts for every animation state
- Local-only app; no network service is required

## Requirements

- Windows
- Node.js and npm

## Install

```powershell
git clone https://github.com/doInsulin/pet-on-the-screen.git
cd pet-on-the-screen
npm install
```

## Run

Use `npm.cmd` in PowerShell if your execution policy blocks direct `npm` scripts.

```powershell
npm.cmd run dev
```

The pet appears near the lower-right corner of the screen. Drag the transparent window area to move it.

## Interactions

| Action | Result |
| --- | --- |
| Click the pet | Head pat |
| Double-click the pet | Tug-of-war |
| Right-click the pet | Quit |
| Tray menu | Show / hide or quit |

## Animation shortcuts

Focus the pet window, then press a key:

| Key | State | Description |
| --- | --- | --- |
| `I` | idle | Quiet companion mode |
| `H` | pat | Head pat |
| `C` | cuddle | Clingy cuddle mode |
| `P` | parkour | Runs around the screen and returns home |
| `T` | tug | Tug-of-war |
| `F` | beg | Begs for food |
| `M` | food | Excited food/meat alert |
| `W` | drink | Water break |
| `D` | dig | Digging / nest-making |
| `L` | flop | Flops down to rest |
| `S` | sleep | Long sleep mode |
| `N` | sniff | Sniffs around |

## Pet profile

Xiao Budian's personality and behavior weights live in:

```text
src/pet-profile.json
```

You can tune behavior frequency by changing `behaviorWeights`. Larger numbers make a behavior more likely.

Example:

```json
"parkour": 35
```

## Assets

The current pet uses a generated 4x4 Bichon sprite reference:

```text
参考/gpt_generate比熊.png
```

The renderer also keeps a canvas-drawn fallback dog, so the app can still show a pet if the sprite image fails to load.

Photo and cutout assets live under:

```text
assets/pet/
assets/pet-cutouts/
```

There is also a helper script for generating transparent cutouts from photos:

```powershell
npm.cmd run cutout
```

The cutout pipeline uses local Python/ONNX/rembg tooling if you have the local environment and model cache set up.

## Build a Windows package

```powershell
npm.cmd run package:win
```

The packaged app is written to `dist/`.

## Notes

This is a personal desktop-pet project built around a specific Bichon. The sprite sheet is not a fully professional transparent animation sheet yet, so some future improvements may involve replacing it with cleaner per-frame transparent PNGs or a more consistent sprite sheet.
