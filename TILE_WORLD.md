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
| `elevation` | `float` | Absolute elevation of this cell |
| `occupantId` | `string \| null` | Building Actor occupying this cell, if any |
| `zoneId` | `string \| null` | Zone this cell belongs to, if any |

Stored as flat array indexed by `y * mapWidth + x`.

### 1.3 Elevation & Pathfinding

Elevation is a per-tile scalar. When evaluating a path edge, the elevation delta between
source and destination tile is compared against the traversing unit's effective height delta
limit. An edge is impassable if:

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
| `elevationCostFactor` | `float` | Scalar applied to elevation delta in edge cost formula. `0.0` = elevation costless but still blocks. `1.0` = 1 unit elevation = 1.0 added to edge cost. Default: `1.0` |
| `pathBudgetPerTick` | `int` | Maximum path requests processed per simulation tick. Recommended range: 50–200 depending on map size and expected unit density. Prevents burst spikes on group move orders. |

---

## 2. Zones

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
- Zones do not restrict unit movement.
- Ownership transfer is handled via Game Events (see [Buildings/Jobs §10](BUILDINGS_JOBS.md)).

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
  coord:   ClusterCoord
  dirty:   bool             // triggers edge recomputation next tick
  edges:   ClusterEdge[]
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
  priority:      int          // higher = processed sooner this tick
  requestedAt:   float
}
```

Processed at up to `world.pathBudgetPerTick` per tick. Group move orders share one
high-level cluster path; local paths are computed per-unit on demand as each cluster
is reached.

### 12.7 Edge Cost Formula

```
edgeCost = resolvedMovementCost(unitTypeId, destTile)
           + abs(destTile.elevation - srcTile.elevation) * world.elevationCostFactor
           + lateralBias(unitId, destTileCoord)
```

Edge rejected (impassable) if:
- `destTile.passable == false`
- `destTile.occupantId != null` and occupant blocks traversal
- `abs(destTile.elevation - srcTile.elevation) > resolvedHeightDeltaLimit(unitTypeId, destTile)`

Where `resolvedHeightDeltaLimit` follows the per-tile-type override chain defined in
[Entities/Workers §6.1](ENTITIES_WORKERS.md): check unit's `heightDeltaLimits` table for
`destTile.tileDefId`, fall back to `heightDeltaLimitDefault`. Tiles carry no height delta
limit of their own.

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
- **Path requests are queued.** No burst of simultaneous path computations. Budget is
  enforced by `World.pathBudgetPerTick`.
- **World objects do not block pathfinding.** Units overlap them freely.
- **Building destruction clears tile occupancy and invalidates clusters.** A destroyed
  building's footprint tiles are immediately freed and affected clusters marked dirty.
- **The World is the single source of truth.** Nothing is cached outside World state
  during a live simulation session.
- **Placement rules are evaluated at placement time only.** Already-placed buildings are
  not re-validated if surrounding world state changes.
