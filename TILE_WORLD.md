# Bastion — Tile / World

> Part of the [Bastion RTS Engine Data Structures](README.md) reference.
> Related domains: [Entities/Workers](ENTITIES_WORKERS.md) · [Resources](RESOURCES.md) · [Buildings/Jobs](BUILDINGS_JOBS.md)

---

## 1. Tile Definitions

### 1.1 Tile Definition Struct

| Field | Type | Description |
|---|---|---|
| `id` | `FName` | Unique identifier |
| `name` | `FString` | Display name |
| `icon` | `TSoftObjectPtr<UTexture2D>` | Visual representation |
| `passable` | `bool` | Whether Units can traverse this tile at all (universal) |
| `movementCostDefault` | `float` | Fallback pathing weight for unlisted unit types (1.0 = normal) |
| `movementCosts` | `TArray<FMovementCostEntry>` | Per-unit-type cost overrides |
| `allowedForBuilding` | `bool` | Default permission for building placement |
| `tags` | `FGameplayTagContainer` | Classification labels used by placement rule scripts |

#### MovementCostEntry Struct

```
FMovementCostEntry {
  UnitTypeId:  FName
  Cost:        float
}
```

**Cost resolution** for a unit crossing a tile edge:
1. Check tile's `movementCosts` for this unit's `unitTypeId`.
2. Fall back to tile's `movementCostDefault`.
3. Fall back to universal default `1.0`.

#### TileCoord

Tile coordinates use `FIntPoint` (`X`, `Y`).

### 1.2 Tile Instance Struct (World State)

| Field | Type | Description |
|---|---|---|
| `tileDefId` | `FName` | Reference to Tile Definition |
| `elevation` | `int32` | Elevation of this cell in height units above the base datum (0 = water level). Multiply by `World.heightScalar` to get world-unit height. |
| `occupantId` | `TOptional<FName>` | Building Actor occupying this cell, if any. Units never set this field — only buildings do. |
| `archPassable` | `bool` | Set `true` by buildings that own this tile but leave the ground-level passage open (e.g. gatehouse arch tiles). When `true`, `occupantId != null` does not block ground-level pathing. Default `false`. |
| `zoneId` | `TOptional<FName>` | Zone this cell belongs to, if any. Unset = unclaimed; any player may build on unclaimed tiles unless a placement rule prevents it. |

Stored as flat `TArray<FTileInstance>` indexed by `Y * MapWidth + X`.

### 1.3 Elevation & Pathfinding

Elevation is a per-tile **integer** expressing height units above an arbitrary base datum
(0 = water level, 200 = 200 × `World.heightScalar` above water). To convert to world units
multiply by `heightScalar`. When evaluating a path edge, the elevation delta between source
and destination tile is compared against the traversing unit's effective height delta limit.
An edge is impassable if:

```
abs(dest.elevation - src.elevation) > resolvedHeightDeltaLimit(unit.unitTypeDefId, destTile)
```

Height delta limits are declared entirely on the unit type — tiles have no opinion on who
can climb them. Resolution follows the same chain as movement cost (see §6.1 in
[Entities/Workers](ENTITIES_WORKERS.md)):

1. Check the unit type's `heightDeltaCosts` table for an entry matching `destTile.tileDefId`.
2. If found, use that limit.
3. If not found, use the unit type's `heightDeltaLimitDefault`.

Elevation also contributes an additive cost to passable edges, scaled by
`World.elevationCostFactor`. See §12.7 (Edge Cost Formula) below.

### 1.4 World Map Parameters

| Field | Type | Description |
|---|---|---|
| `mapWidth` | `int32` | Map width in tiles |
| `mapHeight` | `int32` | Map height in tiles |
| `tileSize` | `float` | Physical size of one tile in world units (cm) |
| `heightScalar` | `float` | World-unit height per elevation integer unit. Multiply `TileInstance.elevation` by this to get world-unit height (cm). Default: `100.0`. |
| `elevationCostFactor` | `float` | Scalar applied to elevation delta in edge cost formula. `0.0` = elevation costless but still blocks. `1.0` = 1 elevation unit = 1.0 added to edge cost. Default: `1.0` |
| `pathBudgetPerTick` | `int32` | Maximum path requests processed per simulation tick. Recommended range: 50–200. Prevents burst spikes on group move orders or mass building invalidation. |

---

## 2. Zones

### 2.0 Zone Tile Assignment (Authoring)

Zone tile assignment is resolved once at map load from a designer-authored **zone map image**.
Each pixel in the zone map corresponds to one tile in the world. The pixel colour is decoded
against a designer-supplied `color → zoneDefId` dictionary. Tiles whose colour has no entry
receive `zoneId: null` (unclaimed).

**Workflow:**
1. Author the zone map as a separate image asset alongside the tile heightmap.
2. Define a colour-to-zone dictionary in the world definition:
   ```
   FZoneColorEntry { Color: FLinearColor, ZoneDefId: FName }
   ```
3. At world load, iterate every tile and set `TileInstance.zoneId` from the decoded entry.
4. Tiles with `zoneId: null` are unclaimed. Any player may build on them unless a
   placement rule script explicitly rejects the placement.

**Polygon workflow (alternative):** Designers may author zones as polygons in a supported
map editor. The editor rasterizes polygons to pixels and exports the same colour-map format;
the runtime import path is identical.

Tile zone assignments are fixed after map load. A tile's `zoneId` does not change when
zone ownership changes — ownership is tracked on `ZoneInstance.currentOwnerId`, not on the
tile. To change which zone a tile belongs to requires re-authoring and reloading the map.

### 2.1 Zone Definition Struct

| Field | Type | Description |
|---|---|---|
| `id` | `FName` | Unique identifier |
| `name` | `FString` | Display name |
| `color` | `FLinearColor` | Map overlay color |
| `startingOwnerId` | `TOptional<FName>` | Owning player or faction at world start; unset = unclaimed |

### 2.2 Zone Instance (World State)

| Field | Type | Description |
|---|---|---|
| `zoneDefId` | `FName` | Reference to Zone Definition |
| `currentOwnerId` | `TOptional<FName>` | Current owner; unset = unclaimed |
| `scopedInventory` | `TArray<FScopedInventorySlot>` | Zone-level abstract resource quantities |

### 2.3 Zone-Scoped Resources

```
FScopedInventorySlot {
  ResourceDefId:  FName
  Quantity:       float
  Capacity:       float     // -1.0f = uncapped
}
```

Resources with `abstract: true` and `storageScope: "zone"` accumulate here. See
[Resources §3.3](RESOURCES.md) for abstract storage details.

### 2.4 Zone Rules

- Players may only place buildings on tiles in zones they own.
- Tiles with `zoneId: null` (unclaimed) are buildable by any player unless a placement rule
  script rejects the placement.
- Zones do not restrict unit movement.
- Ownership transfer is entirely designer-authored via Game Events and scripted actions (e.g.
  `SET_ZONE_OWNER`). No built-in acquisition mechanic exists; designers configure triggers such
  as interactable structures, resource payments, unit presence in a radius, or scripted events.
  See [Buildings/Jobs §10](BUILDINGS_JOBS.md).

### 2.5 Zone Objectives

```
FZoneObjective {
  Id:              FName
  ZoneId:          FName
  Description:     FString
  ResourceDefId:   FName
  TargetQuantity:  float
  Scope:           "available_inventory" | "scoped_inventory" | "either"    // UENUM
  CompletionEvent: FName    // GameEventRef — id of an EventDefinition
}
```

**`scope` semantics:**
- `"available_inventory"` — checks the sum across all `available` inventory slots of
  buildings in the zone owned by the relevant player.
- `"scoped_inventory"` — checks the zone's own `ScopedInventorySlot` quantity.
- `"either"` — the objective is satisfied if **either** namespace independently meets
  `targetQuantity`. Reaching the threshold in one namespace is sufficient; a combined total
  is not required.

**Completion and reversal:** Objective completion fires `completionEvent` the moment the
threshold is first crossed. Whether the objective can be re-triggered or reversed (e.g. if
the resource quantity drops back below threshold) is determined entirely by what the
`completionEvent` does — the system fires the event and records no permanent completion
state of its own. Designers who need a one-shot, non-reversible objective should have the
completion event disable or remove the objective's monitoring trigger.

---

## 7. The World

The `World` struct is the single source of truth during a live simulation session.
Nothing is cached outside of World state.

| Field | Type | Description |
|---|---|---|
| `mapWidth` | `int32` | Map width in tiles |
| `mapHeight` | `int32` | Map height in tiles |
| `tileSize` | `float` | World-unit size of one tile (cm) |
| `heightScalar` | `float` | See §1.4 |
| `elevationCostFactor` | `float` | See §1.4 |
| `pathBudgetPerTick` | `int32` | See §1.4 |
| `tiles` | `TArray<FTileInstance>` | Flat array; index = `Y * MapWidth + X` |
| `elevatedGraph` | `FElevatedNavGraph` | Sparse elevated navigation graph; see §12.8 |
| `pathRequestQueue` | `TArray<FPathRequest>` | Pending pathfinding requests |
| `zones` | `TArray<FZoneInstance>` | All zone instances |
| `buildingActors` | `TArray<ABuildingActor*>` | All placed buildings |
| `unitActors` | `TArray<FUnitState>` | All active units (owned by `AUnitManagerActor`) |
| `worldObjectActors` | `TArray<AWorldObjectActor*>` | All active world objects |
| `playerStateActors` | `TArray<FPlayerStateData>` | One per player; player-scoped abstract resources |
| `activeTechs` | `TArray<FActiveTech>` | Technologies currently in effect |
| `clock` | `float` | Simulation time elapsed in seconds |
| `eventQueue` | `TArray<FGameEvent>` | Pending events |
| `eventFlags` | `TMap<FName, bool>` | Named boolean flags |
| `objectives` | `TArray<FZoneObjective>` | Active objectives |

**Time model:** Delta time per frame (`DeltaSeconds`), framerate-agnostic. Speed multiplier
applied as scalar on delta time.

### 7.1 Supporting Structs

**`FResourceCost`** — a quantity of a specific resource required or consumed by a system
operation (construction cost, tech cost, etc.):

```
FResourceCost {
  ResourceDefId:  FName
  Quantity:       int32
}
```

**`GameEventRef`** — an `FName` referencing a named `EventDefinition` id. `NAME_None` = no
event.

### 7.2 Player State Actor

The **Player State Actor** is a non-spatial, per-player data container that accumulates
abstract resources scoped to a player globally (not zone- or building-specific). It has no
tile footprint. One instance exists per player for the simulation session.

```
FPlayerStateData {
  PlayerId:          FName
  AbstractInventory: TArray<FAbstractInventorySlot>
}

FAbstractInventorySlot {
  ResourceDefId:  FName
  Quantity:       float
  Capacity:       float    // -1.0f = uncapped
}
```

Abstract resources with `storageScope: "player"` read from and write to this actor.
Examples include global prestige, total accumulated faith, or dynasty-wide honour — values
that belong to the player rather than any specific zone or building.

---

## 12. Pathfinding & Movement

### 12.1 Overview

Pathfinding uses A\* on the full tile grid. Units never set `occupantId` and never block
tiles, so inter-unit avoidance is not a pathfinding concern.

Group move orders (box-select) share a single A\* result across all selected units. This is
the primary scalability mechanism — a 200-unit military selection costs one search, not 200.

Paths are cached on the unit. Replanning is triggered only when a building change makes a
unit's stored path impassable. Unaffected units keep their paths indefinitely.

### 12.2 Data Structures

```
// Per unit currently moving
FUnitPath {
  Destination:  FIntPoint           // final tile target
  Path:         TArray<FIntPoint>   // full tile sequence, source→destination; front = next step
}

// Shared across all units in a group move order
FGroupPath {
  GroupId:      FName
  Path:         TArray<FIntPoint>   // computed once; all group members reference this directly
  Destination:  FIntPoint
}
```

Units in a group move hold a reference to their `FGroupPath` and consume `Path` independently
(each unit tracks its own index into the shared sequence). Group path invalidation triggers
one A\* replan; all members adopt the result immediately.

### 12.3 Path Computation

- **Graph:** full tile grid, 4-connected (axis-aligned only)
- **Heuristic:** Manhattan distance
- **Open set:** binary heap
- **Closed set:** flat `bool[mapWidth * mapHeight]` array; allocated once, cleared per search
- **Output:** tile sequence written to `FUnitPath.Path` or `FGroupPath.Path`

A path is recomputed when:
- A move command is issued (unit or group)
- A building change makes any tile in the unit's current `Path` impassable (see §12.4)

### 12.4 Map Change Handling

When a building is placed or removed:

1. Collect all fine tiles in the building footprint.
2. For each unit or group whose `Path` contains any of those tiles: enqueue a replan request.
3. Unaffected units are untouched.

Replans are processed via the path request queue (§12.5). Units with a stale path continue
moving along it until their replan is processed; if the next step in their path is now
impassable, they wait in place.

### 12.5 Path Request Queue

```
FPathRequest {
  UnitActorId:   FName
  Destination:   FIntPoint    // tile coord
  Priority:      int32        // higher = processed sooner; caller-assigned
                               // Convention: player_command=100, task=50, background=10
  RequestedAt:   float        // world clock time; secondary sort key when priority is equal
}
```

Requests are sorted descending by `priority`, then ascending by `requestedAt`. Up to
`world.pathBudgetPerTick` requests are processed per tick; remaining requests stay queued.

A directly commanded unit (`controllable: true`) should use a high priority so player orders
resolve before background task replans when the budget is constrained.

Group move orders submit one `FPathRequest` for the group, not one per unit.

### 12.6 Edge Cost Formula

```
edgeCost = resolvedMovementCost(unitTypeId, destTile)
           + abs(destTile.elevation - srcTile.elevation) * world.elevationCostFactor
           + lateralBias(unitId, destTileCoord)
```

Edge rejected (impassable) if:
- `destTile.passable == false`
- `destTile.occupantId != null && !destTile.archPassable`  ← any building occupant makes
                                     the tile impassable unless the building explicitly
                                     declares it ground-passable (e.g. gatehouse arch tiles);
                                     units never set `occupantId` and never block tiles
- `abs(destTile.elevation - srcTile.elevation) > resolvedHeightDeltaLimit(unitTypeId, destTile)`

Where `resolvedHeightDeltaLimit` follows the per-tile-type override chain defined in
[Entities/Workers §6.1](ENTITIES_WORKERS.md): check unit's `heightDeltaLimits` table for
`destTile.tileDefId`, fall back to `heightDeltaLimitDefault`. Tiles carry no height delta
limit of their own.

**`lateralBias` specification:**

`lateralBias(unitId, tileCoord)` is a small deterministic additive noise term that causes
each unit to consistently prefer slightly different routes when multiple low-cost paths exist.
This prevents all units from perfectly overlapping on a single tile path, producing natural
column-like movement rather than a single-file blob.

```
lateralBias(unitId, tileCoord) =
    (hash(unitId ++ tileCoord.x ++ tileCoord.y) % BIAS_STEPS) * BIAS_SCALE

// Where:
//   hash()      — any deterministic integer hash (e.g. FNV-1a or xxHash over a concatenated
//                 byte string of the three values); implementors may choose any stable hash
//   BIAS_STEPS  — 16  (divides the bias range into 16 discrete levels)
//   BIAS_SCALE  — 0.05 (each step adds 0.05 to edge cost; max bias = 0.75)
//   ++          — concatenation as bytes (e.g. unitId string bytes + int32 x + int32 y)
```

The hash is computed once per edge evaluation and requires no persistent state. The maximum
bias (0.75) is intentionally small relative to normal movement costs (≥ 1.0).

### 12.7 Movement

Units advance along `FUnitPath.Path` by `effectiveMovementSpeed * deltaTime` per tick.
`effectiveMovementSpeed = getEffectiveAttribute(unitId, "movementSpeed")`.
Units overlap freely; no reservation or avoidance system.

### 12.9 Elevated Navigation (Verticality)

The ground nav layer covers the full tile grid at ground level. When wall structures, towers,
or gatehouses are placed, a second sparse nav graph — the **elevated graph** — is built from
those buildings' elevated-surface tiles.

The two graphs are fully independent. A unit belongs to exactly one at any time,
tracked by `FUnitState.currentNavLayer` and `FUnitState.currentElevatedComponentId`.

#### Elevated Graph Structure

The elevated graph is a sparse collection of connected components — one per disconnected wall
chain. A wall chain is any group of elevated-surface tiles reachable from one another without
descending to ground. Wall chains are inherently narrow structures (typically 1–2 tiles wide),
so elevated navigation uses direct fine-tile A\* within the component's `TileSet` rather than
a coarse grid; the node counts are small enough that no further abstraction is needed.

```
FElevatedNavGraph {
  Components:    TArray<FElevatedComponent>
  Transitions:   TArray<FNavTransition>       // indexed by tile coord for fast lookup
}

FElevatedComponent {
  Id:            FName                        // stable until graph rebuild
  TileSet:       TArray<FIntPoint>            // all tiles belonging to this wall chain
}
```

#### Transition Tiles

Stair and ramp buildings register specific footprint tiles as ground↔elevated transitions
via `elevatedTransitionCells` (see [Buildings/Jobs §4.1.2](BUILDINGS_JOBS.md)). Each
produces an `FNavTransition` linking a ground-layer tile to an elevated component tile.

```
FNavTransition {
  GroundTile:         FIntPoint
  ElevatedTile:       FIntPoint
  ComponentId:        FName       // which elevated component this connects to
  Cost:               float       // traversal cost to change levels
}
```

Transitions are the only mechanism connecting the two graphs. A unit on a wall chain
can only reach ground by pathing to a transition tile and crossing it.

#### Unit Nav Layer State

`FUnitState` gains:

| Field | Type | Description |
|---|---|---|
| `currentNavLayer` | `"ground" \| "elevated"` | Which graph this unit currently belongs to |
| `currentElevatedComponentId` | `TOptional<FName>` | Elevated component ID; `NAME_None` when on ground |

Path queries include source and destination layer. If a unit on an elevated component
needs to reach a ground-layer target, the abstract path must include a transition edge
to descend. Visual Z for a unit on an elevated surface is derived from the `wallElevation`
value on the building definition occupying that tile (see [Buildings/Jobs §4.1.2](BUILDINGS_JOBS.md)).

#### Graph Invalidation on Demolition

When a wall-type building is demolished:

1. Its tiles are removed from the elevated component's `TileSet`.
2. A flood-fill over remaining tiles determines whether the component stays connected or
   splits into two or more disconnected components.
3. Split components are assigned new `Id` values and re-registered.
4. Units on components that are now entirely disconnected from any transition tile are
   flagged as stranded; the game logic layer is responsible for handling this case
   (e.g. forcing a teleport to ground, triggering an event, or treating the unit as lost).
5. Ground-layer units with paths through the demolished footprint are re-queued per §12.4.

#### Variable Wall Heights

Wall height is a visual and gameplay property of the building definition (`wallElevation`),
not a nav property. Two adjacent wall segments at different heights are nav-disconnected
unless a stair building explicitly bridges them — the nav graph encodes this naturally
since stairs are the sole source of transition edges. Actual Z height matters for:
- Rendering (unit visual Z offset on the elevated surface)
- Attack range and line-of-sight calculations (elevation advantage)
- Determining which stair types are valid connectors between height levels

The nav graphs require no knowledge of actual Z height — only tile connectivity.

---

## 17. Terrain Rendering

Tiles are pure simulation data (§1). The world tile grid has no associated mesh or world
actor. The visible terrain surface is a procedural mesh managed by the
**RealtimeMeshComponent** (RMC), a third-party UE5 plugin by TriAxis Games.

### 17.1 Chunking

The terrain mesh is divided into chunks — one per zone or one per fixed NxN tile region.
Each chunk is an independent `ARealtimeMeshActor`. Only the chunk(s) covering changed tiles
are regenerated; all other chunks are untouched.

### 17.2 Tile Height

Each chunk vertex is positioned at world-unit height `TileInstance.elevation * World.heightScalar`.
Terrain geometry is regenerated from live tile data whenever tiles in the chunk are modified.

### 17.3 Tile Type → Material

Tile visual type (grass, stone, sand, etc.) is encoded as a per-vertex **material blend
index** written into a UV channel, not vertex colors. A single terrain material samples a
texture array by index, with interpolated UV values providing smooth blending between
adjacent tile types. This approach:

- Avoids vertex color instability (no Nanite dependency, no cluster-boundary flicker)
- Supports smooth tile-type transitions without additional geometry
- Is forward-compatible with future rendering pipeline changes

### 17.4 Building Footprint Flattening

When a building is placed, the terrain chunk(s) under its footprint are regenerated with
all footprint-tile vertices forced to a uniform height. The target height is
designer-configurable per building definition (average of footprint elevations, minimum,
or a fixed offset). This is a **visual-only operation** — `TileInstance.elevation` data
is not modified. When the building is demolished the chunk regenerates from original tile
elevation data.

### 17.5 Collision

The terrain mesh carries **no physics collision**. Units path via the mathematical tile
graph (§12); no world-space mesh raycasts are performed for unit movement. Visual-only
physics (particle collision, cosmetic debris) may use a lightweight collision
representation if needed, configured independently from the navigation system.

### 17.6 Plugin Dependency

RMC is not an Epic-shipped plugin. Engine minor version upgrades (5.5 → 5.7) may lag RMC
release support — verify compatibility before committing to an engine upgrade. The free
RMC Core version covers all terrain needs described here; the Pro spatial-loading system
is not required for this use case.

---

## 19. Spatial Unit Index

Unit actors are managed by `AUnitManagerActor` as a flat `TArray<FUnitState>`. At 1000+
units, naive O(n) scans for proximity queries — auto-engage detection, ability radius
targeting, adjacency bonus evaluation — are prohibitively expensive. The unit manager
maintains a **spatial unit grid**: a derived acceleration structure updated incrementally
as units move. It is not part of canonical `World` state and is neither replicated nor
persisted.

### 19.1 Grid Structure

```
// Maintained by AUnitManagerActor. Derived from unit positions; not in World state.
FSpatialUnitGrid {
  CellTilesWide:  int32                    // tiles per cell in X; default 1
  CellTilesHigh:  int32                    // tiles per cell in Y; default 1
  GridW:          int32                    // = ceil(mapWidth  / CellTilesWide)
  GridH:          int32                    // = ceil(mapHeight / CellTilesHigh)
  Cells:          TArray<TArray<FName>>    // [cellY * GridW + cellX] → unit IDs in this cell
}
```

With `CellTilesWide = CellTilesHigh = 1` (the default), each cell corresponds to exactly
one tile. Larger cell sizes reduce per-move update cost at the expense of a slightly wider
query envelope — tune if unit density per tile is consistently low.

### 19.2 Update Policy

The grid is updated when a unit's **cell coordinates change**, not on every position delta.
A unit's current cell is:

```
cellX = floor(position.X / (world.tileSize * CellTilesWide))
cellY = floor(position.Y / (world.tileSize * CellTilesHigh))
```

When these change from one tick to the next, the unit is removed from the old cell and
inserted into the new cell. Units that stay within the same cell incur zero grid maintenance
cost that tick. On `on_unit_death`, the unit is removed from its cell immediately before
being removed from `World.unitActors`.

### 19.3 Proximity Query

```
FSpatialQueryFilter {
  RequesterId:    FName
  FactionStance:  "enemy" | "friendly" | "neutral" | "any"    // relative to RequesterId
  RequiredTags:   TArray<FName>    // result units must have ALL these tags
  ExcludedTags:   TArray<FName>    // result units must have NONE of these tags
}

// Returns unit IDs within tileRadius tiles of centerTile matching filter
TArray<FName> getUnitsInRadius(centerTile: FIntPoint, tileRadius: int32,
                                filter: FSpatialQueryFilter)
```

**Algorithm:**

1. Compute cell range: `[cx ± ceil(tileRadius / CellTilesWide)] × [cy ± ceil(tileRadius / CellTilesHigh)]`
2. Collect all unit IDs from cells in range (the square envelope).
3. Discard units whose actual Chebyshev tile distance from `centerTile` exceeds `tileRadius`
   (square-to-circle cull).
4. Apply `filter` (faction stance via `ownerId → factionId → relationship`;
   tags via `hasEntityTag`).

For typical combat ranges (1–4 tiles), step 1 touches at most 81 cells each holding O(1–5)
units — far cheaper than O(n) over 1000+ unit actors.

### 19.4 Building Proximity

Buildings do not move. Their proximity is resolved directly from tile data: iterate tiles
in a bounding square around the query origin and check `TileInstance.occupantId`. This is
O(r²) tile reads, which is acceptable because building queries are infrequent (placement,
demolition, adjacency evaluation) and tiles are small, cache-friendly structs.

---

## 22. Network & Multiplayer Model

Bastion uses a **server-authoritative** model. The full simulation runs on the server
(listen or dedicated). Clients are display and input nodes — they do not simulate the
economy or pathfinding and cannot write authoritative world state.

### 22.1 Authority Model

| System | Authority | Client receives |
|---|---|---|
| Economy (tasks, resources, inventory) | Server only | Summary quantities at reduced rate |
| Unit positions & state | Server; replicated | Positions within relevance range |
| Combat (damage, health) | Server only | Health values after resolution |
| Pathfinding | Server only | Not replicated; clients interpolate received positions |
| Zone ownership | Server | Replicated to all clients |
| Adjacency & modifier stacks | Server only | Net attribute values where needed for UI |
| Player commands | Client → Server | Applied by server; no client-side prediction |

### 22.2 Player Commands

Client input is transmitted as lightweight command structs. The server applies commands on
the next available simulation tick.

```
FPlayerCommand {
  Type:          EPlayerCommandType
  IssuerId:      FName
  UnitIds:       TArray<FName>           // units involved
  TargetId:      TOptional<FName>        // target entity (attack, assign)
  TargetTile:    TOptional<FIntPoint>    // target position (move, build)
  AbilityDefId:  TOptional<FName>
  BuildingDefId: TOptional<FName>
  Rotation:      TOptional<int32>        // for build commands
  ClientTime:    float                   // diagnostic only; server does not use for simulation
}

EPlayerCommandType:
  Move | AttackTarget | AttackMove | Assign | Unassign |
  Build | Demolish | UseAbility | PickupWorldObject    // UENUM
```

Commands are queued per-player on the server and processed at the start of each simulation
tick. Invalid commands (targeting an unowned unit, building in an unowned zone) are silently
discarded.

### 22.3 Bandwidth Reduction

**Relevance culling:** Unit position updates are sent to a client only when the unit is
within a configurable radius of that player's camera focus or lord actor. Units outside
the relevance region are not replicated that tick; clients hold the last received position.

**Variable replication rate:** Units close to a player replicate every tick (full rate).
Units near the outer relevance boundary replicate every Nth tick. Rate tiers are
configurable via `World.replicationRateTiers`.

**Economy replication is coarse:** Building task states and resource quantities replicate
to the owning player only at a coarse interval (default 2–5 seconds). Full per-tick
replication of every building's inventory is unnecessary — players observe the economy
through UI summaries. Abstract resources (player- and zone-scoped) replicate on the same
coarse schedule.

**`FFastArraySerializer`** on `AUnitManagerActor.unitActors` handles delta-serialization
of the unit state array, sending only changed entries each replication frame.

### 22.4 Simulation Determinism

The simulation is **not required to be deterministic** across clients. Clients do not run
the simulation, so identical floating-point results across machines are unnecessary. The
server's output (positions, health, resource counts) is authoritative; clients interpolate
received values visually.

The `lateralBias` hash (§12.7) is deterministic by design for **server-side** replay
reproducibility and bug reproduction. It has no multiplayer correctness requirement.

### 22.5 Session Configuration

```
FNetworkSessionConfig {
  Mode:              "listen" | "dedicated"    // UENUM
  MaxPlayers:        int32
  TickRate:          int32     // Hz; recommended 20–30
  RelevanceRadius:   float     // tiles; default 80
  EconomyReplicRate: float     // seconds per economy push; default 3.0
}
```

No peer-to-peer model is supported. Listen server mode co-locates one player with the
server process; dedicated server mode runs headlessly. Both use identical simulation code.

---

## Key Constraints (Tile/World Domain)

- **Tiles are the world primitive; clusters are the pathfinding primitive.** Cluster edge
  weights are derived from tile data and are per-unit-type. Tile data is never abstracted
  away — it is the source of truth for all movement cost calculations.
- **Tiles have no height delta opinion.** Elevation traversal limits are declared entirely
  on unit types via `heightDeltaLimitDefault` and a per-tile-type override table.
- **Elevation is an integer in height units.** Multiply by `World.heightScalar` for world-
  unit height. There is no float precision concern at the tile level.
- **Only buildings block tiles.** `TileInstance.occupantId` is only ever set by a building
  actor. Units never set it and never block pathfinding. A tile with `archPassable: true`
  is ground-passable despite having an occupant (e.g. gatehouse arch tiles).
- **Path requests are queued and prioritized.** Priority is caller-set; the recommended
  convention is player_command=100, task=50, background=10. `requestedAt` breaks ties.
- **World objects do not block pathfinding.** Units overlap them freely.
- **Building destruction clears tile occupancy and invalidates paths.** A destroyed
  building's footprint tiles are immediately freed; units with paths through those tiles
  are re-queued for replanning.
- **The World is the single source of truth.** Nothing is cached outside World state
  during a live simulation session.
- **Zone tile assignment is fixed at map load.** Zone boundaries come from a designer-
  authored colour map image. Tiles do not change zones mid-session; only ownership changes.
- **Placement rules are evaluated at placement time only.** Already-placed buildings are
  not re-validated if surrounding world state changes.
- **Elevated navigation is a sparse second graph, not a full tile layer.** The elevated
  graph is built only from tiles where wall-type buildings have been placed. It is
  naturally fragmented into one connected component per disconnected wall chain.
- **Transition tiles are the only ground↔elevated connection.** Stair and ramp buildings
  register specific footprint cells as transitions. Units cannot change nav layers except
  at these tiles.
- **Wall height is a building property, not a nav property.** Two wall segments at
  different heights are nav-disconnected unless a stair explicitly bridges them.
  `wallElevation` is used for visual Z positioning and combat calculations only.
- **Terrain mesh is visual only.** The RMC terrain mesh carries no physics collision and
  is not used for unit pathing. Tile elevation data is the authoritative source for all
  movement calculations. Footprint flattening on building placement is a visual operation
  only — tile elevation data is not modified.
- **The spatial unit grid is derived, not authoritative.** `FSpatialUnitGrid` is maintained
  by `AUnitManagerActor` as an acceleration structure. It is not part of `World` state,
  not replicated, and not persisted. It is rebuilt or updated incrementally from unit
  positions. Proximity queries go through it, never through O(n) unit actor scans.
- **Clients do not simulate.** All economy, combat, pathfinding, and skill resolution runs
  server-side. Clients receive replicated state within their relevance radius and interpolate
  positions visually. Player input is transmitted as `FPlayerCommand` structs and applied
  by the server.
