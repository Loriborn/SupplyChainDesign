# Bastion — Buildings / Jobs

> Part of the [Bastion RTS Engine Data Structures](README.md) reference.
> Related domains: [Tile/World](TILE_WORLD.md) · [Entities/Workers](ENTITIES_WORKERS.md) · [Resources](RESOURCES.md)

---

## 4. Building Definitions

A **Building Definition** is the primary authored blueprint in Design Mode. Never modified
at runtime. Effective values are always computed as base Definition values composed with the
entity's active modifier stack (see [Entities/Workers §13](ENTITIES_WORKERS.md)).

### 4.1 Core Fields

| Field | Type | Description |
|---|---|---|
| `id` | `FName` | Unique identifier |
| `name` | `FString` | Display name |
| `icon` | `TSoftObjectPtr<UTexture2D>` | Visual / map representation |
| `footprint` | `TArray<TArray<bool>>` | Binary occupancy grid; see §4.1.1 |
| `createsElevatedSurface` | `bool` | `true` if this building contributes its footprint tiles to the elevated nav graph. Default `false`. See §4.1.2. |
| `wallElevation` | `int32` | Height of the elevated walkable surface in height units above the tile's base `elevation`. Used for unit visual Z positioning and attack calculations. Only relevant when `createsElevatedSurface: true`. Default `0`. |
| `archPassableCells` | `TArray<FIntPoint>` | Footprint cells `(row, col)` that are owned by this building but remain ground-passable (e.g. gatehouse arch tiles). Sets `TileInstance.archPassable = true` on placement. Default empty. See §4.1.2. |
| `elevatedTransitionCells` | `TArray<FIntPoint>` | Footprint cells that act as ground↔elevated nav transitions (stairs, ramps). Each entry registers an `FNavTransition` at placement. Default empty. See §4.1.2. |
| `tags` | `TArray<FName>` | Arbitrary classification labels |

#### 4.1.1 Footprint Grid

The building's physical shape is defined as a 2D boolean grid where `true` cells are
occupied structure and `false` cells are open space within the bounding box. The grid is
row-major (`footprint[row][col]`), with `[0][0]` at the top-left origin tile.

```
// Example: An L-shaped gatehouse
footprint: [
  [ true,  true,  true,  false ],
  [ true,  true,  true,  true  ],
  [ true,  true,  true,  false ]
]
// Bounding box: 3 rows × 4 cols
// Occupied cells: 10 of 12
// Open cells (O): top-right and bottom-right corners
```

Only `true` cells participate in:
- Tile occupancy checking during placement
- Placement rule evaluation (the script receives only occupied cells)
- Cluster dirty-marking on placement or demolition
- Pathfinding blockage (only occupied cells set `TileInstance.occupantId`)

`false` cells within the bounding box remain fully traversable and are not owned by the
building. The building's logical origin tile is always `footprint[0][0]`'s world position.

Rotation (0°, 90°, 180°, 270°) transforms the grid at placement time. The rotated grid
is computed from the Definition grid and stored on the Building Actor instance.

#### 4.1.2 Elevated Surface Properties

Buildings that form wall tops, towers, or gatehouses declare elevated surface properties
via the fields in §4.1. These work together as follows:

**`createsElevatedSurface`** — when `true`, all `footprint[row][col] == true` cells are
registered into the elevated nav graph (`FElevatedNavGraph`) on placement. The tiles join
an existing adjacent elevated component or form a new one. On demolition, tiles are removed
and affected components are flood-filled for connectivity.

**`wallElevation`** — the height of the elevated walkable surface, in the same height units
as `TileInstance.elevation`. A unit standing on an elevated tile computes its visual Z as:
```
visualZ = (tile.elevation + buildingDef.wallElevation) * World.heightScalar
```
This value is also used by the combat system for elevation-advantage calculations.

**`archPassableCells`** — a list of footprint cells `(row, col)` that the building owns
(sets `TileInstance.occupantId`) but does not block at ground level. On placement the
system sets `TileInstance.archPassable = true` for each listed cell; on demolition it is
cleared. These cells are included in `createsElevatedSurface` tile registration if that
flag is also true.

Example — a 3×3 gatehouse where the central column is the arch passage:
```
footprint:           archPassableCells:   createsElevatedSurface: true
[ T  T  T ]         [ (0,1), (1,1),      wallElevation: 4
[ T  T  T ]           (2,1) ]
[ T  T  T ]
```
Ground units path through the three center tiles freely. Wall units path across all nine
tiles at elevation. Stair buildings placed adjacent to the gatehouse register
`elevatedTransitionCells` to connect the wall-top to ground.

**`elevatedTransitionCells`** — footprint cells that serve as ground↔elevated crossing
points (stairs, ramps, ladders). Each listed cell `(row, col)` registers an
`FNavTransition` linking the ground-layer tile to the elevated tile at `wallElevation`.
The transition cost is a designer-set value on the building definition.

```
FTransitionCellEntry {
  FootprintCell:  FIntPoint    // (row, col) within the footprint
  TransitionCost: float        // cost added when a unit changes nav layers here
}
```

`elevatedTransitionCells` is the sole mechanism by which units change between the ground
graph and an elevated component. A wall chain with no reachable transition tile is
inaccessible to ground units.

**Stair height rules** — which stair types can bridge which height differences is enforced
at placement time via placement rules (§4.4). A stair building definition declares its
`maxBridgeableElevation` attribute; placement is rejected if the elevation difference
between the adjacent ground tile and the target wall's `wallElevation` exceeds this value.
This prevents a single-step stair from connecting to a tall tower without intermediate
stair sections.

### 4.2 Attributes

Buildings declare their base attribute values here. Core attributes present on all entities
are defined in [Entities/Workers §13.1](ENTITIES_WORKERS.md). Additional designer-defined
custom attributes may be declared here.

```
FAttributeDeclaration {
  AttributeId:  FName     // "maxHealth", "armour", or a custom attribute id
  BaseValue:    float
}
```

At minimum every Building Definition declares `maxHealth` and `armour`.

### 4.3 Construction

Construction uses the Work Task / Work Step paradigm. The **Construction Task** is a
`WorkTaskDefinition` executed once while the building is in `"constructing"` state. Its
terminal step must be `BUILDING_COMPLETE`.

```
// Example: Stone Keep construction task (illustrative — not an authoritative template)
WorkTaskDefinition {
  id:      "construct_stone_keep"
  name:    "Build Stone Keep"
  trigger: "loop"          // construction tasks loop until BUILDING_COMPLETE fires;
                           // the system enforces "once" execution at the building level
  enabled: true
  concurrency: {
    selfConcurrency: "none"       // only one construction process at a time
    crossTaskMode:   "exclusive"  // no other task runs during construction
    crossTaskRefs:   []
  }
  steps: [
    { id: "deliver_stone",   type: COLLECT_RESOURCE, duration: 0,
      workerRequirements: [{ unitTypeId: "builder", count: 1, role: "required", tagRequirements: [] }],
      preconditions: [],
      vars: { sourceBuildingId: null, resourceDefId: "stone",  quantity: 50,
              destinationNamespace: "local" } },
    { id: "deliver_timber",  type: COLLECT_RESOURCE, duration: 0,
      workerRequirements: [{ unitTypeId: "builder", count: 1, role: "required", tagRequirements: [] }],
      preconditions: [],
      vars: { sourceBuildingId: null, resourceDefId: "timber", quantity: 20,
              destinationNamespace: "local" } },
    { id: "lay_foundations", type: CONSUME_RESOURCE, duration: 30,
      workerRequirements: [{ unitTypeId: "builder", count: 1, role: "required", tagRequirements: [] }],
      preconditions: [{ type: "inventory_min", resourceDefId: "stone",
                        namespace: "local", quantity: 50 }],
      vars: { resourceDefId: "stone",  quantity: 50, sourceNamespace: "local" } },
    { id: "frame_structure", type: CONSUME_RESOURCE, duration: 20,
      workerRequirements: [{ unitTypeId: "builder", count: 1, role: "required", tagRequirements: [] }],
      preconditions: [],
      vars: { resourceDefId: "timber", quantity: 20, sourceNamespace: "local" } },
    { id: "complete",        type: BUILDING_COMPLETE, duration: 0,
      workerRequirements: [], preconditions: [] }
  ]
}
```

The building's `local` inventory is available during construction and carries forward into
operation. Constructor units (`canConstruct: true`) are released when `BUILDING_COMPLETE` fires.

### 4.4 Placement Rules

```
PlacementRule {
  script: <expression>
  // Script context:
  //   cells           — array of occupied TileInstances (footprint true-cells only)
  //   cell.elevation  — elevation of this cell
  //   cell.neighbors  — array of 4 or 8 adjacent TileInstances
  //   building        — the Building Definition being placed
  //   zone            — the Zone Instance for this cell, if any
  // Must return: bool
}
```

The script is evaluated once per occupied footprint cell. Placement is rejected if the
script returns `false` for any cell. The script may also aggregate across all cells
(e.g. "max elevation delta across all occupied cells must be <= 1") by iterating the
`cells` array.

**Placement is additionally blocked by the following hard gates, independent of the script:**

| Gate | Condition |
|---|---|
| Tile occupied | Any `true` footprint cell maps to a tile where `occupantId != null` |
| Zone ownership | Any occupied cell's `zoneId` belongs to a zone not owned by the placing player |
| Building prohibited | Any occupied cell's `allowedForBuilding == false` *and* the placement rule script does not explicitly return `true` for that cell |

The placement rule script may override the `allowedForBuilding` gate — a building designed
to be placed on water, for example, can include `tile.allowedForBuilding == false` and still
pass by returning `true` from its script. The tile-occupied and zone-ownership gates are
always enforced and cannot be overridden by script.

### 4.5 Access Points

```
FAccessPoint {
  Id:      FName
  Offset:  FIntPoint        // tile offset from building origin
  Tags:    TArray<FName>    // labels used to filter which units may use this access point
}
```

Units path to the **nearest reachable Access Point they are permitted to use**. If no access
points are declared, any adjacent tile is valid.

**Access point tag filtering:** A `WorkerRequirement` entry on a step may optionally declare
`accessPointTags: string[]`. If set, the assigned unit must path to an access point whose
`tags` contain **all** of the specified tags. Units that cannot reach a valid tagged access
point enter `"waiting_on_unit"` state.

Example use cases:
- A gatehouse with separate `"entry"` and `"exit"` access points that control unit flow direction.
- A mill with a `"delivery"` access point for COLLECT_RESOURCE workers and a `"production"`
  access point for operating workers, allowing physical separation of roles.
- An access point tagged `"authorized_only"` used by a step requiring a specific unit type
  or tag, while general workers use untagged access points.

If `accessPointTags` is empty or omitted on the `WorkerRequirement`, any access point is
eligible (nearest reachable is selected).

### 4.6 Inventory Declarations

```
FInventorySlotDeclaration {
  ResourceDefId:  FName
  Capacity:       int32
  Namespace:      "local" | "available"    // UENUM
}
```

| Namespace | Access |
|---|---|
| **Local** | This building's own task steps only |
| **Available** | Accessible to external units and Connections |

### 4.7 Unit Roster

```
FUnitRosterEntry {
  UnitTypeId:  FName
  MinCount:    int32    // building enters "blocked" if not met
  MaxCount:    int32    // maximum simultaneously assigned units of this type
  bDerived:    bool     // true if sourced from a task step requirement
}
```

### 4.8 Equipment Slot Declarations

Buildings declare named equipment slots. Equippable resources are placed into these slots
via task steps or event actions, applying their modifiers to the building.

```
FEquipmentSlotDeclaration {
  SlotId:    FName      // unique within this building e.g. "millstone", "furnace"
  SlotType:  FName      // matched against resource fitsSlotTypes
  Label:     FString    // display name shown in UI
}
```

Equipment slots on buildings represent structural improvements. By convention, building
equipment should use resources with `removable: false` to represent permanent upgrades
(a better millstone, a reinforced furnace). Designer-authored event actions or task steps
may place equipment into building slots. See [Resources §14](RESOURCES.md).

---

## 5. Work Tasks & Work Steps

### 5.1 Work Task Definition

```
FWorkTaskDefinition {
  Id:           FName
  Name:         FString
  Trigger:      "loop" | "event"    // UENUM
  EventRef:     FName               // GameEventRef; NAME_None if trigger = "loop"
  Concurrency:  FTaskConcurrencyRules
  Steps:        TArray<FWorkStepDefinition>
  bEnabled:     bool
}
```

### 5.2 Concurrency Rules

```
FTaskConcurrencyRules {
  SelfConcurrency:  "none" | "unlimited" | int32    // UENUM + optional count
  CrossTaskMode:    "exclusive" | "open" | "script"  // UENUM
  CrossTaskScript:  FString    // Blueprint-callable expression when CrossTaskMode = "script";
                               // receives: thisTask, candidateTask → returns bool (can coexist)
}
```

**`crossTaskMode` values:**
- `"exclusive"` — this task cannot run alongside any other task on the same building.
  Construction tasks use this.
- `"open"` — no restriction; this task may run alongside any other task.
- `"script"` — a script expression determines compatibility. The script receives the running
  task and a candidate task as context and returns `true` (can coexist) or `false` (blocked).
  This replaces the former `"whitelist"` / `"blacklist"` enum values with a more expressive
  option: whitelist logic is `candidateTask.id in ["taskA", "taskB"]`, blacklist logic is
  `candidateTask.id not in ["taskC"]`.

**Conflict resolution:**
1. Check this task's `crossTaskMode` against the candidate task.
2. Check the candidate task's `crossTaskMode` against this task.
3. The more restrictive result wins. If either direction returns `false` (blocked), the
   lower-priority task enters `"blocked_concurrency"`.

- Blocked tasks persist in `"blocked_concurrency"` until a concurrency recalculation dispatch runs.
- Self-concurrency is always capped by the minimum of `selfConcurrency` and the sum of
  `UnitRosterEntry.maxCount` across all relevant unit types.

### 5.3 Work Step Definition

```
FWorkStepDefinition {
  Id:                FName
  Type:              EWorkStepType               // UENUM
  Duration:          float                       // seconds; 0 = instantaneous
  WorkerRequirements: TArray<FWorkerRequirement> // all must be simultaneously present
  Preconditions:     TArray<FStepPrecondition>
  Vars:              FStepVars
}

FWorkerRequirement {
  UnitTypeId:       FName
  Count:            int32           // number of units of this type required (≥ 1)
  TagRequirements:  TArray<FName>   // present units must have ALL these tags
  AccessPointTags:  TArray<FName>   // unit must path to access point bearing ALL these tags;
                                    // empty = any access point (see §4.5)
  Role:             "required" | "bonus"    // UENUM
  BonusEffect:      TOptional<FBonusWorkerEffect>
}

FBonusWorkerEffect {
  AttributeId:  FName     // attribute on the building or step to scale
  ScalePerUnit: float     // additive multiplier per bonus worker (e.g. 0.2 = +20% per unit)
}
```

**Multi-worker steps:** A step with multiple `WorkerRequirement` entries (e.g. "1 baker AND
2 millers") requires all workers to be simultaneously present before execution begins. Steps
with unsatisfied requirements enter `"waiting_on_unit"`.

**Required workers:** Workers with `role: "required"` must all be present to start the step.
They must remain present for the full duration. If any required worker is removed mid-step
(player command or demolition), the step pauses immediately and enters `"waiting_on_unit"`
until the slot is refilled.

**Bonus workers:** Workers with `role: "bonus"` are optional — the step proceeds with only
the required workers. Each additional bonus worker present scales a specified attribute
(typically step speed or output rate) by `bonusEffect.scalePerUnit` per extra unit.

**Example:** A construction step requiring `[{unitTypeId: "builder", count: 1, role: "required"},
{unitTypeId: "builder", count: 3, role: "bonus", bonusEffect: {attributeId: "constructionSpeed",
scalePerUnit: 0.25}}]` — builds with 1 worker at base speed; each of up to 3 bonus builders
adds 25% speed. Maximum 4 builders total (1 required + 3 bonus).

`tagRequirements` on a `WorkerRequirement` enables steps requiring equipped items —
e.g. a jousting step requiring tag `"ROYALTY"` which may be granted by a MEDAL resource in a
NECK slot. Access point tags may additionally filter which access point a worker uses to
reach the building (see §4.5).

### 5.4 Step Preconditions

```
FStepPrecondition {
  Type:             "inventory_min" | "inventory_max" | "building_state" |
                    "zone_owned" | "event_flag" | "entity_has_tag" | "resource_has_tag"    // UENUM
  ResourceDefId:    FName        // NAME_None if unused
  Namespace:        "local" | "available"    // UENUM
  Quantity:         int32
  TargetBuildingId: FName        // NAME_None if unused
  RequiredState:    FName        // NAME_None if unused
  FlagId:           FName        // NAME_None if unused
  Tag:              FName        // for entity_has_tag / resource_has_tag types
}
```

| Type | Passes when |
|---|---|
| `inventory_min` | Slot holds >= `quantity` |
| `inventory_max` | Slot holds <= `quantity` |
| `building_state` | Referenced building is in `requiredState` |
| `zone_owned` | This building's zone is owned by the expected player |
| `event_flag` | Named world flag is `true` |
| `entity_has_tag` | This building or the executing unit has the specified tag |

### 5.5 Work Step Types

| Type | Description | Key `vars` |
|---|---|---|
| `GENERATE_RESOURCE` | Creates resource into an inventory slot | `resourceDefId`, `quantity`, `destinationNamespace` |
| `CONSUME_RESOURCE` | Removes resource from an inventory slot | `resourceDefId`, `quantity`, `sourceNamespace` |
| `TRANSFORM_RESOURCE` | Atomically consumes inputs, produces outputs. See §5.5.1. | `inputs[]`, `outputs[]` |
| `COLLECT_RESOURCE` | Sends unit to retrieve from external available inventory. See §5.5.2. | `sourceBuildingId`, `resourceDefId`, `quantity`, `destinationNamespace` |
| `DELIVER_RESOURCE` | Sends unit to deposit to external available inventory | `resourceDefId`, `quantity`, `sourceNamespace`, `destinationBuildingId` |
| `EQUIP_ITEM` | Places a resource from inventory into an equipment slot | `resourceDefId`, `slotId`, `targetEntityId \| "self"` |
| `UNEQUIP_ITEM` | Removes a non-locked resource from an equipment slot | `slotId`, `targetEntityId \| "self"`, `destinationNamespace` |
| `SPAWN_UNIT` | Spawns a new unit actor at the building's access point. See §5.5.3. | `unitTypeDefId`, `spawnPosition`, `inheritOwnerId` |
| `WAIT` | Pauses for duration; no state effect | *(none)* |
| `FLAVOR_TEXT` | Emits timestamped log message | `message: string` |
| `BUILDING_COMPLETE` | **Construction only.** Transitions to `"idle"`, releases constructors, fires event. Must be final step. | *(none)* |

#### 5.5.1 TRANSFORM_RESOURCE vars

`inputs[]` and `outputs[]` each contain an array of `TransformEntry`:

```
FTransformEntry {
  ResourceDefId:  FName
  Quantity:       int32
  Namespace:      "local" | "available"    // UENUM
}
```

The step atomically consumes all `inputs` and produces all `outputs` if and only if all
input quantities are available. If any input is insufficient, the step blocks in
`"waiting_on_precondition"` and is retried next tick.

#### 5.5.2 COLLECT_RESOURCE with null sourceBuildingId

When `sourceBuildingId` is `null`, the system resolves the source automatically:

1. Find all buildings the placing player owns that have the required `resourceDefId` in
   their `available` inventory with `quantity > 0`.
2. Filter to buildings reachable by the assigned unit.
3. Select the closest reachable building by pathing distance.
4. If no such building exists, the step enters `"waiting_on_precondition"` and is retried
   each tick until a valid source appears. The step does not fail — it waits indefinitely.

`Connection` priority is respected: buildings connected to this building with higher priority
are preferred among equidistant candidates.

#### 5.5.3 SPAWN_UNIT vars

```
FSpawnUnitVars {
  UnitTypeDefId:  FName              // unit type to spawn
  SpawnPosition:  "access_point"     // spawn at the building's primary access point
                | "nearest_passable" // spawn at the nearest passable tile adjacent to the footprint
                                     // UENUM
  bInheritOwnerId: bool              // if true, spawned unit inherits building's ownerId
}
```

**Spawn mechanics:**
- The spawned unit is created with full `maxHealth`, empty inventory, and initial `state: "idle"`.
- It inherits the building's `ownerId` if `inheritOwnerId: true` (recommended default).
- The spawned unit is not automatically assigned to any building — it is unassigned and idle.
  Designers who want the unit assigned immediately should follow the `SPAWN_UNIT` step with a
  `FIRE_EVENT` that triggers an assignment action.
- The `on_unit_spawned` event hook fires on successful spawn (see §10.1).

**Spawn capacity pattern (house example):**
```
// A "house" that spawns up to 5 workers, replacing each one that dies
WorkTaskDefinition {
  trigger: "loop"
  steps: [
    { type: WAIT, duration: 30 },      // 30-second gestation period
    { type: SPAWN_UNIT,
      workerRequirements: [],           // no worker needed; the building itself spawns
      preconditions: [
        { type: "inventory_max",        // block if spawned-worker count is at capacity
          resourceDefId: "spawned_worker_count",  // tracked via a custom abstract resource
          namespace: "local", quantity: 4 }        // max 5 workers (0-4 = 5 slots)
      ],
      vars: { unitTypeDefId: "villager", spawnPosition: "access_point", inheritOwnerId: true } },
    { type: GENERATE_RESOURCE,
      vars: { resourceDefId: "spawned_worker_count", quantity: 1, destinationNamespace: "local" } }
  ]
}
// On on_unit_death, fire event that decrements "spawned_worker_count" by 1 to allow respawn
```

### 5.6 Simulation-Level Task Controls

```
FTaskInstanceControl {
  TaskDefId:        FName
  bEnabled:         bool
  Priority:         "high" | "medium" | "low"    // UENUM
  ExecutionMode:    "forever" | "once" | "count"  // UENUM
  ExecutionCount:   int32     // required when ExecutionMode = "count"; decrements each cycle
  CompleteBehavior: "terminal" | "reset"    // UENUM
                    // "terminal": when ExecutionCount reaches 0, State = "complete" permanently
                    // "reset":    when ExecutionCount reaches 0, task loops from step 0 again
  State:            "idle" | "running" | "blocked_concurrency" |
                    "waiting_on_precondition" | "waiting_on_unit" | "complete"    // UENUM
  CurrentStepIndex: int32
  StepElapsed:      float
}
```

`executionMode: "complete"` is fully designer-controlled. There is no hardcoded terminal
state — the `completeBehavior` field determines what happens when the count is exhausted.
An `ENABLE_TASK` event action (or a new `RESET_TASK_COUNT` action) can restart a terminal
task if the game design requires it.

---

## 8. Building Actors

`BuildingActor` implements: `IDamageable`, `IAttributeHolder`, `IModifiable`, `IEquippable`,
`IInventoryHolder` (see [Entities/Workers §0](ENTITIES_WORKERS.md)). Fields from these
interfaces are not repeated inline below.

```
// ABuildingActor — UE AActor
// Implements IDamageable, IAttributeHolder, IModifiable, IEquippable, IInventoryHolder

FBuildingRuntimeData {
  // IDamageable:
  CurrentHealth:        float

  // IAttributeHolder:
  Attributes:           TArray<FAttributeDeclaration>

  // IModifiable:
  ModifierStack:        TArray<FModifier>

  // IEquippable:
  EquipmentSlots:       TArray<FEquipmentSlotInstance>

  // Runtime fields:
  Id:                   FName
  DefId:                FName
  OwnerId:              FName
  OriginTile:           FIntPoint             // top-left of bounding box in world tiles
  Rotation:             int32                 // 0, 90, 180, or 270
  RotatedFootprint:     TArray<TArray<bool>>  // Definition footprint transformed by rotation
  State:                "constructing" | "idle" | "working" | "blocked" | "disabled"    // UENUM
                        // "disabled": fully non-functional — no tasks run, no new assignments.
                        //   Set/cleared by DISABLE_BUILDING / ENABLE_BUILDING event actions.
  ConstructionControl:  TOptional<FTaskInstanceControl>
  LocalInventory:       TArray<FInventorySlot>
  AvailableInventory:   TArray<FInventorySlot>
  AbstractInventory:    TArray<FAbstractInventorySlot>
  TaskControls:         TArray<FTaskInstanceControl>
  AssignedUnits:        TArray<FAssignedUnit>
}

FInventorySlot {
  ResourceDefId:  FName
  Quantity:       int32
  Capacity:       int32    // from FInventorySlotDeclaration; not a modifier target
}

FAbstractInventorySlot {
  ResourceDefId:  FName
  Quantity:       float
  Capacity:       float    // -1.0f = uncapped
}

FAssignedUnit {
  UnitTypeId:   FName
  UnitActorId:  FName
}
```

**Building inventory slots** are declared per resource type with explicit capacities (§4.6).
Building slot capacity is fixed and is not an attribute modifier target — capacity changes
are handled by replacing or upgrading the slot declaration via equipment (see [Resources §14](RESOURCES.md)).

---

## 10. Game Events

### 10.1 Event Hooks

| Hook | Fires when | Payload |
|---|---|---|
| `on_building_placed` | Building successfully placed | `buildingActorId`, `tileCoord`, `zoneId` |
| `on_building_demolished` | Building removed by player (see §10.4 for demolition mechanics) | `buildingActorId`, `defId`, `tileCoord`, `zoneId` |
| `on_building_damaged` | Building takes damage | `buildingActorId`, `damage`, `currentHealth`, `attackerId` |
| `on_building_destroyed` | Building health reaches 0 | `buildingActorId`, `defId`, `ownerId`, `tileCoord` |
| `on_construction_complete` | Building finishes constructing | `buildingActorId` |
| `on_task_complete` | Task completes one full cycle | `buildingActorId`, `taskDefId` |
| `on_resource_threshold` | Resource quantity crosses a designer-configured threshold (see §10.5) | `buildingActorId \| zoneId`, `resourceDefId`, `quantity`, `direction` |
| `on_zone_ownership_change` | Zone changes owner | `zoneId`, `previousOwnerId`, `newOwnerId` |
| `on_unit_assigned` | Unit assigned to building | `unitActorId`, `buildingActorId` |
| `on_unit_damaged` | Unit takes damage | `unitActorId`, `damage`, `currentHealth`, `attackerId` |
| `on_unit_death` | Unit health reaches 0 | `unitActorId`, `unitTypeDefId`, `ownerId`, `position`, `assignedBuildingId` |
| `on_item_equipped` | Resource placed in equipment slot | `entityId`, `slotId`, `resourceDefId` |
| `on_item_unequipped` | Resource removed from equipment slot | `entityId`, `slotId`, `resourceDefId` |
| `on_world_object_spawned` | World object created | `worldObjectActorId`, `resourceDefId`, `position` |
| `on_world_object_expired` | World object timer elapsed | `worldObjectActorId`, `resourceDefId`, `position` |
| `on_world_object_pickup` | World object collected by a unit | `worldObjectActorId`, `unitActorId` |
| `on_tech_applied` | Technology takes effect | `techDefId`, `ownerId` |
| `on_objective_complete` | Zone objective threshold met | `objectiveId`, `zoneId` |
| `on_unit_spawned` | Unit created by a `SPAWN_UNIT` step | `unitActorId`, `unitTypeDefId`, `buildingActorId`, `position` |
| `on_faction_stance_changed` | Faction relationship stance updated | `factionId`, `targetFactionId`, `newStance` |
| `on_flag_set` | Named event flag set to `true` | `flagId` |

### 10.2 Event Definition

```
FEventDefinition {
  Id:       FName
  Name:     FString
  Hook:     FName    // HookId — one of the hook names in §10.1
  Filter:   TOptional<FEventFilter>
  Actions:  TArray<FEventAction>
}

FEventFilter {
  BuildingDefId:  FName     // NAME_None = any
  UnitTypeDefId:  FName
  ZoneId:         FName
  OwnerId:        FName
  Radius:         float     // 0.0f = no radius filter
  ResourceTag:    FName     // filter by resource tag; NAME_None = any
  // all non-None/non-zero fields are ANDed
}
```

### 10.3 Event Actions

| Action Type | Description | Key fields |
|---|---|---|
| `APPLY_MODIFIER` | Applies a modifier to an entity | `modifierTemplate`, `target: entityId \| "self" \| "nearby(radius, tags?)"` |
| `REMOVE_MODIFIER` | Removes modifiers by source or tag | `target`, `removeBySource \| removeByTag` |
| `EQUIP_ITEM` | Places a resource into an entity's equipment slot | `resourceDefId`, `slotId`, `target` |
| `SET_ZONE_OWNER` | Transfers zone ownership | `zoneId`, `newOwnerId` |
| `ADD_SCOPED_RESOURCE` | Adds to zone-scoped resource | `zoneId`, `resourceDefId`, `quantity` |
| `SET_FLAG` | Sets named world flag | `flagId`, `value: bool` |
| `FIRE_EVENT` | Fires another event immediately. Designer is responsible for avoiding infinite event loops. | `eventDefId` |
| `ENABLE_TASK` | Enables/disables a task on a building | `buildingActorId`, `taskDefId`, `enabled: bool` |
| `RESET_TASK_COUNT` | Resets `executionCount` and state to "idle" for a count-mode task | `buildingActorId`, `taskDefId`, `newCount: int` |
| `DISABLE_BUILDING` | Disables a building — fully non-functional, no tasks run | `buildingActorId` |
| `ENABLE_BUILDING` | Re-enables a previously disabled building | `buildingActorId` |
| `SPAWN_WORLD_OBJECT` | Creates a container world object at a position | `contents: [{resourceDefId, quantity}]`, `position \| "self"` |
| `GRANT_ABILITY` | Grants an ability to a specific unit or building actor | `abilityDefId`, `targetEntityId` |
| `SET_FACTION_STANCE` | Changes the relationship stance between two factions | `factionId`, `targetFactionId`, `stance: "friendly" \| "neutral" \| "hostile"` |
| `APPLY_TECH` | Applies a technology | `techDefId`, `ownerId` |
| `EMIT_LOG` | Writes to simulation log | `message: string` |

**Event loop note:** `FIRE_EVENT` can trigger another `FIRE_EVENT`, creating a chain. There
is no system-level cycle detection or recursion depth limit. Designers are responsible for
ensuring event chains terminate. Circular chains (Event A fires Event B which fires Event A)
will loop indefinitely — this is a designer error, not an engine concern.

### 10.4 Demolition Mechanics

Demolition is initiated by a player action on a placed building. It is **instantaneous** —
no animation timer or staged process. On demolition:

1. All `localInventory` and `availableInventory` resources are **dropped at the building's
   origin tile** as a single `ContainerWorldObject` holding all non-zero resource slots.
   Empty slots produce no container entry. If all slots are empty, no world object is spawned.
2. All units currently assigned to the building are **unassigned** (`assignedBuildingId` set
   to `null`). Their current task step is cancelled with no resource refund.
3. Any resources those units are currently carrying are **dropped at their current positions**
   as individual container world objects (one per unit, or merged if the unit carries multiple
   resource types — same container model as unit death drops).
4. The building's footprint tiles have `occupantId` cleared, affected clusters are marked
   `dirty`, and the `BuildingActor` is removed from the world.
5. `on_building_demolished` fires with the building's last known state in the payload.

Container world objects spawned by demolition use the **world-level generic container decay
behavior** (see [Resources §16.3](RESOURCES.md)) unless the designer's `on_building_demolished`
event handler overrides the behavior by intercepting and re-spawning with custom settings.

**Abstract inventory:** Abstract resources stored in a building's `abstractInventory` are
**not dropped** — they live in zone- or player-scoped storage and persist after demolition.

### 10.5 Resource Threshold Configuration

The `on_resource_threshold` hook requires a designer-authored **threshold configuration**
attached to the building definition or zone. This tells the system what constitutes a
crossing event.

```
FResourceThreshold {
  Id:            FName
  ResourceDefId: FName
  Namespace:     "local" | "available" | "scoped_inventory"    // UENUM
  Threshold:     float           // the quantity value to watch
  Direction:     "rising"        // fires when quantity crosses threshold upward
               | "falling"       // fires when quantity crosses threshold downward
               | "either"        // UENUM
  EventRef:      FName           // GameEventRef — id of EventDefinition to fire
}
```

Thresholds are declared in the **Building Definition** (for building-scoped resources) or
in the **Zone Definition** (for zone-scoped resources). A building may declare multiple
thresholds on different resources or different directions for the same resource.

**Crossing detection:** A threshold is crossed when the resource quantity transitions from
one side to the other between ticks. A quantity that starts above threshold and falls below
it in one tick fires a `"falling"` threshold. The event fires once per crossing — a quantity
that stays above or below without crossing does not re-fire.

---

## 11. Connections

```
FConnection {
  Id:                   FName
  SourceBuildingId:     FName
  SourceResourceDefId:  FName
  DestBuildingId:       FName
  DestResourceDefId:    FName
  Priority:             int32
  TransferMode:         "unit_driven" | "automatic"    // UENUM
  RateLimit:            float    // 0.0f = no limit (for automatic mode)
}
```

- **`unit_driven`:** Advisory. Units prefer higher-priority connections when selecting
  `COLLECT` / `DELIVER` targets.
- **`automatic`:** Transfers up to `rateLimit` resource units per second each tick.

---

## 15. Technologies

**Technologies** are globally or zone-scoped effects that apply modifiers to all current and
future instances of a target definition type, or trigger resource creation / event firing.

### 15.1 Tech Definition

```
FTechDefinition {
  Id:             FName
  Name:           FString
  Description:    FString
  Prerequisites:  TArray<FName>       // techDefIds that must be active before this may be applied
  Scope:          "global" | "zone" | "team" | "faction"    // UENUM
  ZoneId:         FName               // required if Scope = "zone"; NAME_None otherwise
  // "global"  — affects all instances of TargetDefId owned by OwnerId, worldwide
  // "zone"    — affects only instances within the specified zone
  // "team"    — affects all players sharing the same faction as OwnerId
  // "faction" — synonym for "team"; affects all units/buildings of the OwnerId's faction
  TargetType:     "unit_type" | "building_type"    // UENUM
  TargetTags:     TArray<FName>       // if non-empty, tech affects only entities with ALL these tags
  TargetDefId:    FName               // NAME_None = any entity of TargetType (filtered by TargetTags)
  Cost:           TArray<FResourceCost>
  Effects:        TArray<FTechEffect>
}
```

**Tech tree:** Prerequisites form a directed acyclic graph. The engine validates that all
listed prerequisite tech ids are already active for `ownerId` before allowing `APPLY_TECH`.
There is no built-in tier or tree UI structure — the prerequisite graph is the tree. Designers
layer prerequisites to create linear chains or branching trees (CIV / AOE style).

**Revocation:** There is no `REVOKE_TECH` action. Technologies applied with `"indefinite"`
effects are permanent for the session. To counteract a technology's effects, designers apply
a new technology whose `ModifierTemplate` inverts the modifier (e.g. additive with negative
value, or multiplicative with a complementary factor). Tag grants can be removed by a
subsequent modifier that removes that tag. This is by design — tech acquisition is a
one-way progression within a session.

### 15.2 Tech Effects

```
FTechEffect {
  Type:              "apply_modifier" | "create_resource" | "fire_event"    // UENUM
  ApplicationRule:   "indefinite" | "once"    // UENUM
  //   indefinite:  for apply_modifier — modifier applied to all current instances and
  //                every future instance of TargetDefId spawned while tech is active
  //   once:        effect fires once at application time; future instances unaffected
  ModifierTemplate:  TOptional<FModifierTemplate>    // for apply_modifier
  ResourceDefId:     FName               // for create_resource; NAME_None if unused
  Quantity:          int32
  SpawnPosition:     FName               // "player_keep" or NAME_None for TileCoord
  SpawnTileCoord:    TOptional<FIntPoint>
  EventDefId:        FName               // for fire_event; NAME_None if unused
}
```

**`apply_modifier` + `indefinite`:** Instantiates the `modifierTemplate` on all current
instances of `targetDefId`. Records the tech as active in `World.activeTechs`. When any new
instance of `targetDefId` is spawned, the simulation checks `activeTechs` and applies the
modifier immediately on creation.

**`apply_modifier` + `once`:** Applies the modifier to all instances alive at application
time only. Does not affect future spawns. Use for one-time buffs tied to a specific event
or milestone rather than a permanent capability unlock.

**`create_resource`:** Spawns a world object at the specified position. `applicationRule`
governs whether this happens once (a single item spawns) or indefinitely (an item spawns
each time a new instance of the target type is created — useful for "every new bakery
receives a starter millstone" patterns).

**`fire_event`:** Fires a named event. `"once"` fires it once at application; `"indefinite"`
fires it every time a new instance of `targetDefId` is created.

### 15.3 Active Tech Instance (World State)

```
FActiveTech {
  TechDefId:           FName
  OwnerId:             FName
  AppliedAt:           float
  AppliedModifierIds:  TArray<FName>    // modifier ids applied to existing instances
}
```

---

## Key Constraints (Buildings/Jobs Domain)

- **Building footprints are binary grids, not rectangles.** Only `true` cells participate
  in tile occupancy, placement validation, pathfinding blockage, and cluster invalidation.
  `false` cells within the bounding box remain freely traversable.
- **Building inventory capacity is fixed per slot declaration.** Building slot capacities
  are declared explicitly and are not modifier targets.
- **Work Steps are the only mechanism for building-internal state change.** Inventory
  cannot change except through step execution.
- **Multi-worker steps require all required workers simultaneously.** Partial fulfillment
  does not start the step. Bonus workers are optional but may accelerate execution.
- **Blocked tasks persist.** A concurrency-blocked task waits for a recalculation dispatch.
  It does not skip or cancel.
- **Cross-task compatibility uses scripts, not whitelist/blacklist enums.** `crossTaskMode:
  "script"` is the expressive option; `"exclusive"` and `"open"` remain for simple cases.
- **Building "disabled" is fully non-functional.** No tasks run. Only `ENABLE_BUILDING`
  event action clears this state.
- **Demolition is instantaneous.** All inventory drops as a container at the origin tile.
  Assigned units are unassigned; their carried resources drop at their positions.
- **Placement rules are evaluated at placement time only.** Already-placed buildings are
  not re-validated if surrounding world state changes.
- **Tech prerequisites must be satisfied.** `APPLY_TECH` is rejected if any listed
  prerequisite tech is not already active for the same owner. Prerequisites form a DAG.
- **Tech revocation is not supported.** Counter a tech's effects by applying an inverting
  tech. The progression is one-way within a session.
- **Technologies apply to types, not instances.** An `"indefinite"` tech modifier applies
  to all current instances and all future spawns of the target definition. A `"once"` tech
  effect applies only to instances alive at application time.
- **Event loop safety is the designer's responsibility.** `FIRE_EVENT` chains are not
  cycle-detected. Circular chains loop indefinitely.
