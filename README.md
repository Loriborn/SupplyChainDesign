# Supply Chain & RTS Simulation Editor — Project Plan

## Overview

A desktop editor and simulation tool for designing supply chain and RTS systems in a
data-driven way, then running them as a live simulation. The editor is a Windows-style
canvas with floating, dockable panels. The simulation is a Stronghold-style 2D RTS
rendered inside one of those panels.

---

## Tech Stack

| Layer | Library | Purpose |
|---|---|---|
| Window / GL context | `imgui-bundle` (SDL2 backend) | App shell, event loop |
| Editor UI | `Dear ImGui` (via imgui-bundle) | All panels, toolbars, docking |
| Simulation renderer | `ModernGL` | GPU-accelerated sprite batching via OpenGL |
| Render target | `ModernGL` framebuffer → ImGui `Image()` | Simulation runs in an FBO, displayed as a texture in a panel |
| Entity data | `numpy` structured arrays | Cache-friendly bulk entity state (position, velocity, etc.) |
| Pathfinding | Custom A\* over numpy grid | Tile-based, vectorised where possible |
| Data / schemas | `dataclasses` + JSON | Buildings, units, resources, rules — all serialisable |
| Asset loading | `Pillow` | Load sprite PNGs into GL textures |

### Why ModernGL instead of pygame-ce?

pygame-ce is easy but its CPU-side sprite blitting becomes the bottleneck around
500–1000 entities. ModernGL uses instanced rendering: all entity positions are uploaded
as a single numpy array to the GPU each frame, so thousands of sprites cost one draw
call regardless of count. The tradeoff is a little more setup code, which is worth it
given the project's performance goals.

---

## Project Structure

```
project/
├── main.py                  # Entry point — init SDL2, ImGui, GL context, run loop
│
├── editor/
│   ├── canvas.py            # Top-level ImGui dockspace / canvas host
│   ├── toolbar.py           # Main menu bar + toolbar (open tools, file ops)
│   ├── panel.py             # Base Panel class (open/close/pin state)
│   └── panels/
│       ├── building_editor.py   # Edit building rules
│       ├── resource_editor.py   # Edit resource types
│       ├── system_editor.py     # Edit supply chain / RTS system graphs
│       └── simulation_panel.py  # Hosts the simulation viewport
│
├── simulation/
│   ├── world.py             # World state: tile map, entity arrays, tick logic
│   ├── renderer.py          # ModernGL instanced sprite renderer
│   ├── entity.py            # Entity schema (numpy dtype definitions)
│   ├── pathfinding.py       # A* on tile grid
│   ├── systems/
│   │   ├── movement.py      # Bulk move entities toward targets
│   │   ├── production.py    # Building production tick logic
│   │   └── supply_chain.py  # Resource flow evaluation
│   └── shaders/
│       ├── sprite.vert      # Instanced sprite vertex shader
│       └── sprite.frag      # Sprite fragment shader (alpha discard)
│
├── data/
│   ├── schemas.py           # Dataclass definitions: Building, Unit, Resource, etc.
│   ├── loader.py            # Load/save JSON to dataclass instances
│   └── definitions/
│       ├── buildings.json   # Default building definitions
│       ├── units.json       # Default unit definitions
│       └── resources.json   # Default resource definitions
│
└── assets/
    └── sprites/             # PNG sprite sheets / individual sprites
```

---

## Architecture

### App Loop

```
main.py
  └── poll SDL events
  └── imgui.new_frame()
  └── editor.canvas.draw()          ← draws all open panels
        └── simulation_panel.draw()
              └── simulation.world.tick()     ← advances sim one step
              └── simulation.renderer.render() ← renders to FBO
              └── imgui.image(fbo_texture)    ← shows result in panel
  └── imgui.render() + SDL swap
```

### Editor Canvas

The canvas is a full-screen ImGui dockspace. Every tool is a `Panel` subclass with
`open`, `pinned`, and `title` state. The toolbar launches panels by flipping their
`open` flag. ImGui handles the actual docking, resizing, and drag behaviour natively.

```python
class Panel:
    title: str
    open: bool = False
    pinned: bool = False

    def draw(self):
        if not self.open:
            return
        flags = imgui.WINDOW_NO_CLOSE if self.pinned else 0
        expanded, self.open = imgui.begin(self.title, self.open, flags)
        if expanded:
            self.draw_contents()
        imgui.end()
```

### Simulation Renderer

The renderer owns a ModernGL framebuffer (FBO). On each tick it:
1. Uploads entity positions as a numpy array to a GL instance buffer
2. Draws all entities with a single `render_mesh.render(moderngl.POINTS, instances=n)`
3. Returns the FBO's colour texture ID, which the panel passes to `imgui.image()`

```python
# Entity positions stored as structured numpy array — bulk-updatable each frame
dtype = np.dtype([
    ('x',      np.float32),
    ('y',      np.float32),
    ('sprite', np.uint16),   # index into texture atlas
    ('state',  np.uint8),
])
entities = np.zeros(MAX_ENTITIES, dtype=dtype)
```

### Data Model

All game content (buildings, units, resources, system rules) is defined as plain
Python dataclasses serialised to JSON. The editor panels are thin wrappers that
read and write these dataclasses. The simulation consumes them at load time.

```python
@dataclass
class BuildingDef:
    id: str
    name: str
    sprite: str
    produces: list[str]
    consumes: list[str]
    production_rate: float
```

---

## Milestones

### 1 — Skeleton
- [x] SDL2 + ModernGL context opens
- [x] ImGui dockspace renders
- [x] Toolbar with placeholder panel launchers

### 2 — Editor Shell
- [ ] Panel base class with open/close/pin
- [ ] At least one data editor panel (resource editor)
- [ ] JSON save/load for a schema

### 3 — Simulation Viewport
- [ ] Tile map renders in FBO → displayed in panel
- [ ] Single entity moves across map (no pathfinding yet)
- [ ] Panel is dockable/moveable like all others

### 4 — Simulation Core
- [ ] A\* pathfinding on tile grid
- [ ] Multiple units with movement system
- [ ] Basic building placement from editor data

### 5 — Supply Chain Loop
- [ ] Production buildings tick and emit resources
- [ ] Resource flow between buildings (supply chain graph)
- [ ] Data-driven: rules come from JSON definitions

### 6 — Playable Prototype
- [ ] Stronghold-style worker assignment
- [ ] Win/lose condition evaluator
- [ ] Editor ↔ simulation round-trip (design → test → adjust)

---

## Setup

```bash
pip install imgui-bundle moderngl numpy Pillow
python main.py
```

> **Note:** `imgui-bundle` bundles SDL2 so no separate SDL install is needed on most
> platforms. ModernGL requires OpenGL 3.3+.

---

## Key Constraints & Notes

- **Performance target:** 1000–2000 entities at acceptable frame rate via instanced
  rendering. Python tick logic may need numpy vectorisation or selective Cython/C
  extension if it becomes the bottleneck.
- **No animation required:** Sprites are static; state changes (idle/moving/working)
  are handled by swapping sprite index, not playing animation frames.
- **Editor and simulation are decoupled:** The simulation reads from data definitions
  at startup. Changing a building rule in the editor and clicking "reload" re-initialises
  the simulation world — no hot-reload magic needed.
- **Single file format:** The entire scenario (map + definitions + system rules) saves
  to one JSON file for easy iteration and sharing.
