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
| `id` | `string` | Unique identifier |
| `name` | `string` | Display name |
| `icon` | `asset ref` | Visual / map representation |
| `footprint` | `bool[][]` | Binary occupancy grid; see §4.1.1 |
| `tags` | `string[]` | Arbitrary classification labels |

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

### 4.2 Attributes

Buildings declare their base attribute values here. Core attributes present on all entities
are defined in [Entities/Workers §13.1](ENTITIES_WORKERS.md). Additional designer-defined
custom attributes may be declared here.

```
AttributeDeclaration {
  attributeId:  string    // "maxHealth", "armour", or a custom attribute id
  baseValue:    float
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
    { id: "deliver_stone",   type: COLLECT_RESOURCE, unitTypeId: "builder", duration: 0,
      tagRequirements: [], preconditions: [],
      vars: { sourceBuildingId: null, resourceDefId: "stone",  quantity: 50,
              destinationNamespace: "local" } },
    { id: "deliver_timber",  type: COLLECT_RESOURCE, unitTypeId: "builder", duration: 0,
      tagRequirements: [], preconditions: [],
      vars: { sourceBuildingId: null, resourceDefId: "timber", quantity: 20,
              destinationNamespace: "local" } },
    { id: "lay_foundations", type: CONSUME_RESOURCE, unitTypeId: "builder", duration: 30,
      tagRequirements: [],
      preconditions: [{ type: "inventory_min", resourceDefId: "stone",
                        namespace: "local", quantity: 50 }],
      vars: { resourceDefId: "stone",  quantity: 50, sourceNamespace: "local" } },
    { id: "frame_structure", type: CONSUME_RESOURCE, unitTypeId: "builder", duration: 20,
      tagRequirements: [], preconditions: [],
      vars: { resourceDefId: "timber", quantity: 20, sourceNamespace: "local" } },
    { id: "complete",        type: BUILDING_COMPLETE, duration: 0,
      tagRequirements: [], preconditions: [] }
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
AccessPoint {
  id:      string
  offset:  { x: int, y: int }
  tags:    string[]
}
```

Units path to the nearest reachable Access Point. If none declared, any adjacent tile is valid.

### 4.6 Inventory Declarations

```
InventorySlotDeclaration {
  resourceDefId:  string
  capacity:       int
  namespace:      "local" | "available"
}
```

| Namespace | Access |
|---|---|
| **Local** | This building's own task steps only |
| **Available** | Accessible to external units and Connections |

### 4.7 Unit Roster

```
UnitRosterEntry {
  unitTypeId:  string
  minCount:    int     // building enters "blocked" if this is not met
  maxCount:    int     // maximum simultaneously assigned units of this type
  derived:     bool    // true if sourced from a task step requirement
}
```

### 4.8 Equipment Slot Declarations

Buildings declare named equipment slots. Equippable resources are placed into these slots
via task steps or event actions, applying their modifiers to the building.

```
EquipmentSlotDeclaration {
  slotId:              string    // unique within this building e.g. "millstone", "furnace"
  slotType:            string    // type string matched against resource fitsSlotTypes
  label:               string    // display name shown in UI
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
WorkTaskDefinition {
  id:           string
  name:         string
  trigger:      "loop" | "event"
  eventRef:     GameEventRef?
  concurrency:  TaskConcurrencyRules
  steps:        WorkStepDefinition[]
  enabled:      bool
}
```

### 5.2 Concurrency Rules

```
TaskConcurrencyRules {
  selfConcurrency:  "none" | "unlimited" | int
  crossTaskMode:    "exclusive" | "open" | "whitelist" | "blacklist"
  crossTaskRefs:    string[]
}
```

- Conflict resolution: the more restrictive rule always wins, checked in both directions.
- Blocked tasks persist in `"blocked_concurrency"` until a concurrency recalculation dispatch runs.
- Self-concurrency is always capped by `UnitRosterEntry.maxCount` for the relevant unit type.

### 5.3 Work Step Definition

```
WorkStepDefinition {
  id:            string
  type:          WorkStepType
  duration:      float              // seconds; 0 = instantaneous
  unitTypeId:    string?            // step blocks until a unit of this type is present
  tagRequirements: string[]         // the present unit must have ALL of these tags
                                    // (checks definition tags + modifier-granted tags)
  preconditions: StepPrecondition[]
  vars:          StepVars
}
```

`tagRequirements` enables task steps that require equipped items — e.g. a jousting step
requiring `"ROYALTY"` which may be granted by a MEDAL resource in a NECK slot.

### 5.4 Step Preconditions

```
StepPrecondition {
  type:             "inventory_min" | "inventory_max" | "building_state" |
                    "zone_owned" | "event_flag" | "entity_has_tag"
  resourceDefId:    string?
  namespace:        "local" | "available"?
  quantity:         int?
  targetBuildingId: string?
  requiredState:    string?
  flagId:           string?
  tag:              string?     // for entity_has_tag type
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
| `TRANSFORM_RESOURCE` | Atomically consumes inputs, produces outputs | `inputs[]`, `outputs[]` |
| `COLLECT_RESOURCE` | Sends unit to retrieve from external available inventory | `sourceBuildingId`, `resourceDefId`, `quantity`, `destinationNamespace` |
| `DELIVER_RESOURCE` | Sends unit to deposit to external available inventory | `resourceDefId`, `quantity`, `sourceNamespace`, `destinationBuildingId` |
| `EQUIP_ITEM` | Places a resource from inventory into an equipment slot | `resourceDefId`, `slotId`, `targetEntityId \| "self"` |
| `UNEQUIP_ITEM` | Removes a non-locked resource from an equipment slot | `slotId`, `targetEntityId \| "self"`, `destinationNamespace` |
| `WAIT` | Pauses for duration; no state effect | *(none)* |
| `FLAVOR_TEXT` | Emits timestamped log message | `message: string` |
| `BUILDING_COMPLETE` | **Construction only.** Transitions to `"idle"`, releases constructors, fires event. Must be final step. | *(none)* |

### 5.6 Simulation-Level Task Controls

```
TaskInstanceControl {
  taskDefId:       string
  enabled:         bool
  priority:        "high" | "medium" | "low"
  executionMode:   "forever" | "once" | "count"
  executionCount:  int?
  state:           "idle" | "running" | "blocked_concurrency" |
                   "waiting_on_precondition" | "waiting_on_unit" | "complete"
  progress: {
    currentStepIndex:  int
    stepElapsed:       float
  }
}
```

---

## 8. Building Actors

`BuildingActor` implements: `IDamageable`, `IAttributeHolder`, `IModifiable`, `IEquippable`,
`IInventoryHolder` (see [Entities/Workers §0](ENTITIES_WORKERS.md)). Fields from these
interfaces are not repeated inline below.

```
BuildingActor {
  // IDamageable:     currentHealth
  // IAttributeHolder: attributes
  // IModifiable:     modifierStack
  // IEquippable:     equipmentSlots
  // IInventoryHolder: localInventory, availableInventory, abstractInventory

  id:                   string
  defId:                string
  ownerId:              string
  originTile:           { x: int, y: int }          // top-left of bounding box in world tiles
  rotation:             0 | 90 | 180 | 270
  rotatedFootprint:     bool[][]                     // Definition footprint transformed by rotation
  state:                "constructing" | "idle" | "working" | "blocked" | "disabled"
  constructionControl:  TaskInstanceControl | null
  localInventory:       InventorySlot[]
  availableInventory:   InventorySlot[]
  abstractInventory:    AbstractInventorySlot[]
  taskControls:         TaskInstanceControl[]
  assignedUnits:        AssignedUnit[]
}

InventorySlot {
  resourceDefId:  string
  quantity:       int
  capacity:       int    // from InventorySlotDeclaration; not modified by attribute stack
}

AbstractInventorySlot {
  resourceDefId:  string
  quantity:       float
  capacity:       float
}

AssignedUnit {
  unitTypeId:   string
  unitActorId:  string
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
| `on_building_demolished` | Building removed by player | `buildingActorId`, `defId`, `tileCoord`, `zoneId` |
| `on_building_damaged` | Building takes damage | `buildingActorId`, `damage`, `currentHealth`, `attackerId` |
| `on_building_destroyed` | Building health reaches 0 | `buildingActorId`, `defId`, `ownerId`, `tileCoord` |
| `on_construction_complete` | Building finishes constructing | `buildingActorId` |
| `on_task_complete` | Task completes one full cycle | `buildingActorId`, `taskDefId` |
| `on_resource_threshold` | Resource quantity crosses threshold | `buildingActorId \| zoneId`, `resourceDefId`, `quantity` |
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
| `on_flag_set` | Named event flag set to `true` | `flagId` |

### 10.2 Event Definition

```
EventDefinition {
  id:       string
  name:     string
  hook:     HookId
  filter:   EventFilter?
  actions:  EventAction[]
}

EventFilter {
  buildingDefId:  string?
  unitTypeDefId:  string?
  zoneId:         string?
  ownerId:        string?
  radius:         float?
  // all specified filters are ANDed
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
| `FIRE_EVENT` | Fires another event immediately | `eventDefId` |
| `ENABLE_TASK` | Enables/disables a task on a building | `buildingActorId`, `taskDefId`, `enabled: bool` |
| `SPAWN_WORLD_OBJECT` | Creates a world object at a position | `resourceDefId`, `quantity`, `position \| "self"` |
| `APPLY_TECH` | Applies a technology | `techDefId`, `ownerId` |
| `EMIT_LOG` | Writes to simulation log | `message: string` |

---

## 11. Connections

```
Connection {
  id:                   string
  sourceBuildingId:     string
  sourceResourceDefId:  string
  destBuildingId:       string
  destResourceDefId:    string
  priority:             int
  transferMode:         "unit_driven" | "automatic"
  rateLimit:            float?
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
TechDefinition {
  id:             string
  name:           string
  description:    string
  scope:          "global" | "zone"
  zoneId:         string?             // required if scope = "zone"
  targetType:     "unit_type" | "building_type"
  targetDefId:    string              // which definition type this tech affects
  cost:           ResourceCost[]      // { resourceDefId, quantity }[] to apply this tech
  effects:        TechEffect[]
}
```

### 15.2 Tech Effects

```
TechEffect {
  type:              "apply_modifier" | "create_resource" | "fire_event"
  applicationRule:   "indefinite" | "once"
  //   indefinite:  for apply_modifier — modifier is applied to all current instances and
  //                to every future instance of targetDefId spawned while this tech is active
  //   once:        effect fires once at application time for current instances only;
  //                future instances do not receive it; used for create_resource and
  //                one-shot fire_event effects
  modifierTemplate:  ModifierTemplate?   // for apply_modifier
  resourceDefId:     string?             // for create_resource
  quantity:          int?
  spawnPosition:     "player_keep" | TileCoord?
  eventDefId:        string?             // for fire_event
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
ActiveTech {
  techDefId:   string
  ownerId:     string
  appliedAt:   float     // world clock time
  appliedModifierIds: string[]   // modifier ids applied to existing instances
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
- **Blocked tasks persist.** A concurrency-blocked task waits for a recalculation dispatch.
  It does not skip or cancel.
- **Placement rules are evaluated at placement time only.** Already-placed buildings are
  not re-validated if surrounding world state changes.
- **Technologies apply to types, not instances.** An `"indefinite"` tech modifier applies
  to all current instances and all future spawns of the target definition. A `"once"` tech
  effect applies only to instances alive at application time.
