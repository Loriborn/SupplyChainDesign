# Bastion — Tile / World

> Part of the [Bastion RTS Engine Data Structures](README.md) reference.
> Related domains: [Entities/Workers](ENTITIES_WORKERS.md) · [Resources](RESOURCES.md) · [Buildings/Jobs](BUILDINGS_JOBS.md)

---

## 1. Tile Definitions

### 1.1 Tile Definition Struct

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier |
| `name` | `string` | Display name |
| `icon` | `asset ref` | Visual representation |
| `passable` | `bool` | Whether Units can traverse this tile at all (universal) |
| `movementCostDefault` | `float` | Fallback pathing weight for unlisted unit types (1.0 = normal) |
| `movementCosts` | `MovementCostEntry[]` | Per-unit-type cost overrides |
| `allowedForBuilding` | `bool` | Default permission for building placement |
| `tags` | `string[]` | Classification labels used by placement rule scripts |

#### MovementCostEntry Struct

```
MovementCostEntry {
  unitTypeId:  string
  cost:        float
}
```

**Cost resolution** for a unit crossing a tile edge:
1. Check tile's `movementCosts` for this unit's `unitTypeId`.
2. Fall back to tile's `movementCostDefault`.
3. Fall back to universal default `1.0`.

#### TileCoord Struct

```
TileCoord {
  x:  int
  y:  int
}
```

### 1.2 Tile Instance Struct (World State)

| Field | Type | Description |
|---|---|---|
| `tileDefId` | `string` | Reference to Tile Definition |
| `elevation` | `int` | Elevation of this cell in height units above the base datum (0 = water level). Multiply by `World.heightScalar` to get world-unit height. |
| `occupantId` | `string \| null` | Building Actor occupying this cell, if any. Units never set this field — only buildings do. |
| `zoneId` | `string \| null` | Zone this cell belongs to, if any. `null` = unclaimed; any player may build on unclaimed tiles unless a placement rule prevents it. |

Stored as flat array indexed by `y * mapWidth + x`.

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
| `mapWidth` | `int` | Map width in tiles |
| `mapHeight` | `int` | Map height in tiles |
| `tileSize` | `float` | Physical size of one tile in world units (UE: cm) |
| `clusterSize` | `int` | Tiles per cluster edge for hierarchical pathfinding |
| `heightScalar` | `float` | World-unit height per elevation integer unit. Multiply `TileInstance.elevation` by this to get world-unit height (e.g. UE: cm). Default: `100.0`. |
| `elevationCostFactor` | `float` | Scalar applied to elevation delta in edge cost formula. `0.0` = elevation costless but still blocks. `1.0` = 1 elevation unit = 1.0 added to edge cost. Default: `1.0` |
| `pathBudgetPerTick` | `int` | Maximum path requests processed per simulation tick. Recommended range: 50–200 depending on map size and expected unit density. Prevents burst spikes on group move orders. |

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
   ZoneColorEntry { color: color, zoneDefId: string }
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
| `id` | `string` | Unique identifier |
| `name` | `string` | Display name |
| `color` | `color` | Map overlay color |
| `startingOwnerId` | `string \| null` | Owning player or faction at world start |

### 2.2 Zone Instance (World State)

| Field | Type | Description |
|---|---|---|
| `zoneDefId` | `string` | Reference to Zone Definition |
| `currentOwnerId` | `string \| null` | Current owner; `null` = unclaimed |
| `scopedInventory` | `ScopedInventorySlot[]` | Zone-level abstract resource quantities |

### 2.3 Zone-Scoped Resources

```
ScopedInventorySlot {
  resourceDefId:  string
  quantity:       float
  capacity:       float     // -1 = uncapped
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
ZoneObjective {
  id:              string
  zoneId:          string
  description:     string
  resourceDefId:   string
  targetQuantity:  float
  scope:           "available_inventory" | "scoped_inventory" | "either"
  completionEvent: GameEventRef
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
| `mapWidth` | `int` | Map width in tiles |
| `mapHeight` | `int` | Map height in tiles |
| `tileSize` | `float` | World-unit size of one tile (UE: cm) |
| `clusterSize` | `int` | Tiles per cluster edge |
| `heightScalar` | `float` | See §1.4 |
| `elevationCostFactor` | `float` | See §1.4 |
| `pathBudgetPerTick` | `int` | See §1.4 |
| `tiles` | `TileInstance[]` | Flat array; index = `y * mapWidth + x` |
| `clusterGraph` | `ClusterGraph` | Hierarchical pathfinding graph; see §12 |
| `pathRequestQueue` | `PathRequest[]` | Pending pathfinding requests |
| `zones` | `ZoneInstance[]` | All zone instances |
| `buildingActors` | `BuildingActor[]` | All placed buildings |
| `unitActors` | `UnitActor[]` | All active units (managed by `AUnitManagerActor`) |
| `worldObjectActors` | `WorldObjectActor[]` | All active world objects (dropped items, relics, etc.) |
| `playerStateActors` | `PlayerStateActor[]` | One per player; holds player-scoped abstract resources |
| `activeTechs` | `ActiveTech[]` | Technologies currently in effect |
| `clock` | `float` | Simulation time elapsed in seconds |
| `eventQueue` | `GameEvent[]` | Pending events |
| `eventFlags` | `Map<string, bool>` | Named boolean flags |
| `objectives` | `ZoneObjective[]` | Active objectives |

**Time model:** Delta time per frame (UE: `DeltaSeconds`), framerate-agnostic. Speed multiplier
applied as scalar on delta time. Python demo uses fixed delta time per loop iteration.

### 7.1 Supporting Structs

**`ResourceCost`** — a quantity of a specific resource required or consumed by a system
operation (construction cost, tech cost, etc.):

```
ResourceCost {
  resourceDefId:  string
  quantity:       int
}
```

**`GameEventRef`** — a string reference to a named `EventDefinition` id. Used wherever a
system hook needs to fire a designer-authored event:

```
GameEventRef = string    // the id of an EventDefinition
```

### 7.2 Player State Actor

The **Player State Actor** is a non-spatial, per-player data container that accumulates
abstract resources scoped to a player globally (i.e. not zone- or building-specific).
It has no tile footprint and is not placed on the map. One instance exists per player
for the lifetime of the simulation session.

```
PlayerStateActor {
  playerId:          string
  abstractInventory: AbstractInventorySlot[]
}
```

Abstract resources with `storageScope: "player"` read from and write to this actor.
Examples include global prestige, total accumulated faith, or dynasty-wide honour — values
that belong to the player rather than any specific zone or building.

---

## 12. Pathfinding & Movement

### 12.1 Why Tiles Are Not Pathfinding Nodes

Tile-as-node A* does not scale. A 480×480 map contains 230,400 nodes; NavMesh was considered
and rejected because per-tile movement costs (grass vs stone per unit type) break polygon
simplification assumptions. **HPA\*** operates on a coarser cluster graph; local A* within
each cluster uses full tile cost data.

### 12.2 ClusterCoord Struct

```
ClusterCoord {
  x:  int
  y:  int
}
```

### 12.3 Cluster Graph

```
ClusterGraph {
  clusters:  Cluster[][]    // [clusterY][clusterX]
}

Cluster {
  coord:      ClusterCoord
  dirty:      bool               // triggers edge recomputation next tick
  edges:      ClusterEdge[]
  boundaries: ClusterBoundary[]  // one per adjacent cluster; populated at init / recompute
}

ClusterEdge {
  targetCluster:  ClusterCoord
  costs:          ClusterEdgeCost[]   // pre-computed per unit type
  impassableFor:  string[]            // unitTypeIds that cannot cross this boundary;
                                       // accounts for movement cost and the unit's own
                                       // resolvedHeightDeltaLimit for the boundary tiles
}

ClusterEdgeCost {
  unitTypeId:  string
  cost:        float    // pre-computed traversal cost incorporating tile movement costs
                        // and elevation deltas at the cluster boundary
}
```

**Scale example (480×480, clusterSize=16):**
```
Cluster grid:        30×30 = 900 nodes for high-level search
Local A* per cluster: 256 nodes maximum
Flat tile A*:         230,400 nodes — ~40× more expensive
```

### 12.3.1 Cluster Boundaries and Entry Points

A **cluster boundary** is the shared tile edge between two horizontally or vertically adjacent
clusters. For a `clusterSize`-wide cluster grid, a horizontal boundary is the column of tiles
at `x = (clusterX + 1) * clusterSize` (the rightmost column of the left cluster / leftmost
column of the right cluster). Diagonal cluster adjacency is not used — boundaries are
axis-aligned only.

```
ClusterBoundary {
  neighborCluster:  ClusterCoord     // the cluster on the other side of this boundary
  direction:        "north" | "south" | "east" | "west"
  entryPoints:      EntryPoint[]     // passable crossing points along this shared edge
}

EntryPoint {
  tileA:    TileCoord    // tile on this cluster's side of the boundary
  tileB:    TileCoord    // tile on the neighbor cluster's side (adjacent to tileA)
  intraClusterCosts: IntraClusterCost[]  // cost from this entry point to every other
                                          // entry point within the same cluster
}

IntraClusterCost {
  toEntryPointIndex:  int     // index into the same ClusterBoundary's entryPoints array,
                               // or cross-referenced by global id; implementation detail
  unitTypeId:         string
  cost:               float   // local A* cost within the cluster between the two points
}
```

**Entry point selection algorithm:**

Entry points are computed from the contiguous runs of passable tile pairs along a shared edge.
A tile pair `(tileA, tileB)` is passable if both tiles have `passable == true`, neither has
`occupantId != null`, and the elevation delta between them does not exceed any unit type's
`resolvedHeightDeltaLimit` (pairs are considered per unit type during cost precomputation).

From each contiguous run of passable tile pairs, **one representative entry point** is selected:
the pair at the midpoint of the run (rounding down for even-length runs). This keeps the
abstract graph compact while preserving path coverage. A run of length 1 produces exactly one
entry point at that single tile pair.

> **Why one per run:** Selecting every passable tile as an entry point is maximally accurate
> but quadratically expensive. One per contiguous run is the standard HPA* approximation —
> paths may be slightly suboptimal near boundaries but the high-level search remains fast.
> Implementors may increase density (e.g. one per N tiles of a run) at the cost of a larger
> abstract graph.

**Intra-cluster cost precomputation:** For each unit type, local A* is run within the cluster
between every pair of entry points on its boundaries. The resulting costs populate
`IntraClusterCost[]`. This is the dominant precomputation cost and is the work triggered by
`Cluster.dirty == true`.

### 12.4 Per-Unit-Type Edge Weights

Edge weights are **pre-computed per unit type** at world init and after cluster invalidation.
Memory cost: `unitTypeCount × clusterBoundaryCount` — trivial at tens of unit types.

### 12.5 Cluster Invalidation

Building placed or removed → all overlapping clusters marked `dirty`. Next tick: dirty
clusters recompute all edge costs and clear flag. Units with `clusterPath` passing through
dirty clusters are re-queued. Unaffected units keep their paths.

### 12.6 Path Request Queue

```
PathRequest {
  unitActorId:   string
  destination:   TileCoord
  priority:      int          // higher = processed sooner this tick; caller-assigned
                              // Suggested convention: player_command=100, task=50, background=10
  requestedAt:   float        // world clock time; secondary sort key when priority is equal
}
```

Requests are sorted descending by `priority`, then ascending by `requestedAt` (earlier
requests win on ties). Up to `world.pathBudgetPerTick` requests are processed per tick;
remaining requests stay in queue for the next tick.

The priority value is an unconstrained integer set by the caller at request time. No system
enforces a particular range — the convention above is a recommended starting point. A directly
commanded unit (`controllable: true`) should use a high priority so its path is computed before
background task units when the budget is constrained.

Group move orders share one high-level cluster path; local paths are computed per-unit on
demand as each cluster is reached.

### 12.7 Edge Cost Formula

```
edgeCost = resolvedMovementCost(unitTypeId, destTile)
           + abs(destTile.elevation - srcTile.elevation) * world.elevationCostFactor
           + lateralBias(unitId, destTileCoord)
```

Edge rejected (impassable) if:
- `destTile.passable == false`
- `destTile.occupantId != null`  ← any building occupant makes the tile fully impassable;
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

The hash is computed once per edge evaluation and requires no persistent state.
The maximum bias (0.75) is intentionally small relative to normal movement costs (≥ 1.0),
so routing decisions are influenced but not dominated by the bias term.

Implementors must use the same hash algorithm consistently to ensure reproducible paths
across ticks (important for simulation replay and determinism).

### 12.8 Movement

Units advance along `localPath` by `effectiveMovementSpeed * deltaTime` per tick.
`effectiveMovementSpeed = getEffectiveAttribute(unitId, "movementSpeed")`.
On cluster boundary reached: next cluster's `localPath` computed on demand.
Units overlap freely; no reservation or avoidance system.

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
  actor. Units never set it and never block pathfinding.
- **Cluster boundaries use one entry point per contiguous passable run.** This is the
  standard HPA* approximation. All inter-cluster pathfinding passes through entry points.
- **Path requests are queued and prioritized.** Priority is caller-set; the recommended
  convention is player_command=100, task=50, background=10. `requestedAt` breaks ties.
- **World objects do not block pathfinding.** Units overlap them freely.
- **Building destruction clears tile occupancy and invalidates clusters.** A destroyed
  building's footprint tiles are immediately freed and affected clusters marked dirty.
- **The World is the single source of truth.** Nothing is cached outside World state
  during a live simulation session.
- **Zone tile assignment is fixed at map load.** Zone boundaries come from a designer-
  authored colour map image. Tiles do not change zones mid-session; only ownership changes.
- **Placement rules are evaluated at placement time only.** Already-placed buildings are
  not re-validated if surrounding world state changes.
