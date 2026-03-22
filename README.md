# Bastion — RTS Engine Data Structures

## Purpose

This document defines the game-data structures for **Bastion**, an RTS sub-system framework
for designing and building real-time strategy games with complex supply chains, unit systems,
tile-based worlds, and event-driven simulation. It covers the full data model: world
representation, entity definitions, simulation state, pathfinding, combat, resources,
technologies, and events.

Bastion is implemented in **C++ and Blueprints for Unreal Engine 5.5** (primary target), with
UE 5.7 as a forward-compatibility target depending on stability. All data structures and
runtime logic are expressed exclusively in UE-native terms. Implementation is entirely
in-engine in C++ and Blueprints.

> **Critical UE constraints:** Units do **not** use `APawn`, `ACharacter`, or the built-in
> `UNavigationSystem` / NavMesh. All movement and pathfinding is custom HPA\* (§12). Units
> are data entries managed by `AUnitManagerActor`, not individual world actors. Buildings and
> World Objects use `AActor`. Built-in UE pawns, character movement, and navigation are
> explicitly excluded from this system.

This document is concerned exclusively with data structures and simulation logic. UI,
rendering, and engine integration layers are out of scope.

---

## Domain Reference

The full data model is split across four domain documents:

| Domain | File | Contents |
|---|---|---|
| **Tile / World** | [TILE_WORLD.md](TILE_WORLD.md) | Tile definitions, zones, world map parameters, player state, pathfinding & movement, elevated navigation, terrain rendering, spatial unit index, network model (§1, §2, §7, §12, §17, §19, §22) |
| **Entities / Workers** | [ENTITIES_WORKERS.md](ENTITIES_WORKERS.md) | Entity interfaces, unit type definitions, unit actors, attributes & modifiers, abilities, combat & damage types, skill system / veterancy (§0, §6, §9, §13, §18, §20, §21) |
| **Resources** | [RESOURCES.md](RESOURCES.md) | Resource definitions, equipment, world objects (§3, §14, §16) |
| **Buildings / Jobs** | [BUILDINGS_JOBS.md](BUILDINGS_JOBS.md) | Building definitions, work tasks & steps, building actors, game events, connections, technologies, adjacency bonuses (§4, §5, §8, §10, §11, §15, §23) |

---

## Terminology & Platform Conventions

Bastion uses Unreal Engine 5 terminology throughout. All class bases are prescriptive — this
is a UE 5.5/5.7 C++ and Blueprints implementation.

| Concept | UE Class Basis | Term Used Here |
|---|---|---|
| Anything placed in the world | `AActor` | **Actor** |
| A mobile unit (worker or combat) | See note below | **Unit** |
| A placed structure | `AActor` | **Building** |
| A world-placed resource or item | `AActor` | **World Object** |
| A pure data / value container | `USTRUCT(BlueprintType)` | **Struct** |
| A design-mode data asset | `UPrimaryDataAsset` | **Definition** |
| A runtime instance of a Definition | `AActor` instance | **Instance** / **Actor** |

`UObject` is avoided as a raw base for any replicated gameplay class.

**Shared base — composable interfaces:** Units, Buildings, and World Objects share
capabilities through a set of composable `UInterface` types rather than a shared base class.
Each entity type implements only the interfaces relevant to its role. See §0 for the
full interface definitions and implementation summary.

**Unit implementation:** All units use a **Manager Actor + `FFastArraySerializer`** pattern
(`AUnitManagerActor` owning a replicated `TArray<FUnitState>`). RTS zoom-out capability
eliminates distance-based relevancy, collapsing worst-case channel count to ~10,400
(2,600 units × 4 clients) and making replication manager CPU cost the binding constraint.
`FFastArraySerializer` collapses this to 4 channels. Rendering uses **AnimToTexture + HISMCs**.
Position is full `float` X/Y. Units may overlap; path wobble via deterministic lateral bias
(seeded from unit ID) provides visual variation.

**Units do not use APawn, ACharacter, or UNavigationSystem.** Units are entries in
`AUnitManagerActor`'s replicated state array. The built-in UE character movement component
and NavMesh are not used anywhere in this system.

---

## UE Type Conventions

All struct and field definitions use the following UE-native type notation:

| Doc Type | UE / C++ Type | Notes |
|---|---|---|
| `FName` | `FName` | All IDs, tag labels, slot IDs, reference keys. `NAME_None` = absent/null. |
| `FString` | `FString` | Display names, descriptions, UI labels, log messages. |
| `int32` | `int32` | Integer values. |
| `float` | `float` | Floating-point values. |
| `bool` | `bool` | Boolean values. |
| `TArray<T>` | `TArray<T>` | Dynamic array. |
| `TMap<K,V>` | `TMap<K,V>` | Hash map. |
| `FVector2D` | `FVector2D` | 2D float coordinate (world / unit position). |
| `FIntPoint` | `FIntPoint` | 2D integer coordinate (tile coord, cluster coord). |
| `FLinearColor` | `FLinearColor` | RGBA color value. |
| `TSoftObjectPtr<UTexture2D>` | `TSoftObjectPtr<UTexture2D>` | Lazy-loaded icon/texture asset reference. |
| `TOptional<FName>` | `TOptional<FName>` | Nullable ID (e.g. `occupantId`, `assignedBuildingId`). |

**Enums** are shown as string literals (e.g. `"idle" | "pathing"`) in code blocks for
readability. In C++ they are `UENUM(BlueprintType)` with `uint8` underlying type.

**Structs** are `USTRUCT(BlueprintType)`. **Interfaces** are pure virtual `UInterface`
types. **Definitions** inherit from `UPrimaryDataAsset`.

---

## 0. Entity Interfaces

Rather than a single monolithic base, Bastion defines a set of composable interfaces. Each
entity type implements only the interfaces relevant to its role. This avoids forcing
capabilities onto entities that don't need them — a dropped resource world object has no
need for equipment slots; a cosmetic building prop may not need a modifier stack.

The interfaces are structural contracts, not class hierarchies. Implemented as pure virtual
`UInterface` types in C++.

---

### `IDamageable`

Implemented by: **Units**, **Buildings**, **World Objects** (optional — only when the
designer declares a non-zero `maxHealth`)

```
IDamageable {
  currentHealth:  float    // runtime scalar; decrements on damage
                           // ceiling: getEffectiveAttribute(id, "maxHealth")
                           // when maxHealth increases: currentHealth unchanged
                           // when maxHealth decreases below currentHealth: clamped
}
```

Entities implementing `IDamageable` may be targeted by unit attacks and may fire
`on_unit_damaged` / `on_building_damaged` event hooks. When `currentHealth` reaches `0`,
the entity fires its death/destruction event and is removed from the world.

---

### `IAttributeHolder`

Implemented by: **Units**, **Buildings**, **World Objects** (optional)

```
IAttributeHolder {
  attributes:  AttributeDeclaration[]    // base values declared in the Definition
}
```

An entity implementing `IAttributeHolder` exposes named attribute base values that can be
read via `getBaseAttribute(entityId, attributeId)`. Without `IModifiable`, these values
are static for the lifetime of the instance.

---

### `IModifiable`

Requires: `IAttributeHolder`

Implemented by: **Units**, **Buildings**

```
IModifiable {
  modifierStack:  Modifier[]    // active modifiers composed over base attribute values
}
```

Effective attribute values are computed as base + modifier stack. The Definition is never
mutated. Modifier stack evaluation, expiry, and querying are defined in §13.

---

### `IEquippable`

Requires: `IModifiable`

Implemented by: **Units**, **Buildings**

```
IEquippable {
  equipmentSlots:  EquipmentSlotInstance[]    // runtime state of declared equipment slots
}
```

An entity implementing `IEquippable` may have resources placed into named equipment slots.
Equipment applies modifiers to the entity's modifier stack and may enable or disable tasks.
Equipment slots are declared in the entity's Definition (§4.8, §6.6). See §14.

---

### `IInventoryHolder`

Implemented by: **Units** (carry slots), **Buildings** (local + available slots),
**World Objects** (resource quantity container)

The interface has no shared field definition because each entity type holds inventory
differently. It is a capability marker: entities implementing it participate in resource
flow — they may be the source or destination of `COLLECT_RESOURCE`, `DELIVER_RESOURCE`,
`GENERATE_RESOURCE`, and `CONSUME_RESOURCE` steps, and may be queried by `inventory_min`
and `inventory_max` preconditions.

Inventory structures per entity type:
- **Units** — `CarrySlot[]` (generic, count-bounded; see §6.5 and §9)
- **Buildings** — `InventorySlot[]` for local and available namespaces (see §4.6 and §8)
- **World Objects** — `{ resourceDefId, quantity }` single-resource container (see §16.3)

---

### Interface Implementation Summary

| Entity | IDamageable | IAttributeHolder | IModifiable | IEquippable | IInventoryHolder |
|---|---|---|---|---|---|
| **Unit** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Building** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **World Object** | optional | optional | — | — | ✓ |

---

## Core Concepts

Bastion operates in two complementary modes that share the same underlying data layer:

- **Design Mode** — A structured environment for authoring Definitions for tiles, buildings,
  resources, unit types, equipment, technologies, and events. What something *is* and how
  it *behaves* is declared here. Design Mode is engine-agnostic and runs in the editor tool.
- **Simulation Mode** — A live environment where Definitions are instantiated as Actors,
  placed on a tile-based map, and allowed to interact per their authored rules. In UE this
  maps to a running game session; in the editor it runs as an in-tool preview simulation.

The separation between *Definition* and *Instance* is the foundational principle. Nothing
in Simulation Mode is defined there — it is only placed and observed.

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
| `tags` | `TArray<FName>` | Classification labels used by placement rule scripts |

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
| `elevation` | `int32` | Elevation in height units above base datum (0 = water level). Multiply by `World.heightScalar` for world-unit height. |
| `occupantId` | `TOptional<FName>` | Building Actor occupying this cell; unset = no occupant. Units never set this. |
| `zoneId` | `TOptional<FName>` | Zone this cell belongs to; unset = unclaimed. |

Stored as flat `TArray<FTileInstance>` indexed by `Y * MapWidth + X`.

### 1.3 Elevation & Pathfinding

Elevation is a per-tile scalar. When evaluating a path edge, the elevation delta between
source and destination tile is compared against the traversing unit's effective height delta
limit. An edge is impassable if:

```
abs(dest.elevation - src.elevation) > resolvedHeightDeltaLimit(unit.unitTypeDefId, destTile)
```

Height delta limits are declared entirely on the unit type — tiles have no opinion on who
can climb them. Resolution follows the same chain as movement cost (see §6.1):

1. Check the unit type's `heightDeltaCosts` table for an entry matching `destTile.tileDefId`.
2. If found, use that limit.
3. If not found, use the unit type's `heightDeltaLimitDefault`.

Elevation also contributes an additive cost to passable edges, scaled by
`World.elevationCostFactor`. See §12.7.

### 1.4 World Map Parameters

| Field | Type | Description |
|---|---|---|
| `mapWidth` | `int32` | Map width in tiles |
| `mapHeight` | `int32` | Map height in tiles |
| `tileSize` | `float` | Physical size of one tile in world units (cm in UE) |
| `clusterSize` | `int32` | Tiles per cluster edge for hierarchical pathfinding |
| `heightScalar` | `float` | World-unit height per elevation integer unit. Multiply `TileInstance.elevation` by this to get world-unit height (cm). Default: `100.0`. |
| `elevationCostFactor` | `float` | Scalar applied to elevation delta in edge cost formula. `0.0` = elevation costless but still blocks. `1.0` = 1 elevation unit = 1.0 added to edge cost. Default: `1.0` |
| `pathBudgetPerTick` | `int32` | Maximum path requests processed per simulation tick. Recommended range: 50–200 depending on map size and expected unit density. Prevents burst spikes on group move orders. |

---

## 2. Zones

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

Resources with `abstract: true` and `storageScope: "zone"` accumulate here.

### 2.4 Zone Rules

- Players may only place buildings on tiles in zones they own.
- Zones do not restrict unit movement.
- Ownership transfer is handled via Game Events (§10).

### 2.5 Zone Objectives

```
FZoneObjective {
  Id:              FName
  ZoneId:          FName
  Description:     FString
  ResourceDefId:   FName
  TargetQuantity:  float
  Scope:           "available_inventory" | "scoped_inventory" | "either"  // UENUM
  CompletionEvent: FName    // GameEventRef — id of an EventDefinition
}
```

---

## 3. Resource Definitions

Resources are passive data. They are produced, consumed, transported, stored, dropped as World
Objects, and optionally equipped into equipment slots on units and buildings.

### 3.1 Physical vs Abstract

| Class | Description |
|---|---|
| **Physical** | Occupies inventory space. Carried by units. Flows between buildings. |
| **Abstract** | Not carried. Accumulates in a designated storage actor (Player State, Zone, or tagged Building). |

### 3.2 Resource Definition Fields

| Field | Type | Description |
|---|---|---|
| `id` | `FName` | Unique identifier |
| `name` | `FString` | Display name |
| `icon` | `TSoftObjectPtr<UTexture2D>` | Visual representation |
| `unit` | `FString` | Unit label (e.g. "kg", "units", "happiness") |
| `abstract` | `bool` | If true, abstract resource; not carried or stored in inventory |
| `storageScope` | `"player" \| "zone" \| "building_tag"` | **Abstract only** (UENUM) |
| `storageBuildingTag` | `FName` | **Abstract, `building_tag` scope only.** `NAME_None` if unused. |
| `stackSize` | `int32` | **Physical only.** Max quantity per inventory slot |
| `tags` | `TArray<FName>` | Classification labels |
| `worldObjectBehavior` | `TOptional<FWorldObjectBehavior>` | Defines behavior when dropped as a world entity; unset = cannot be dropped. See §16 |
| `equippable` | `bool` | Whether this resource can be placed into an equipment slot |
| `fitsSlotTypes` | `TArray<FName>` | **Equippable only.** Slot type names this resource fits into |
| `unitTypeConstraints` | `TArray<FName>` | **Equippable only.** If non-empty, only unit types with a matching id may equip this resource |
| `tagConstraints` | `TArray<FName>` | **Equippable only.** The equipping entity must possess all listed tags |
| `removable` | `bool` | **Equippable only.** Default `true`. If `false`, once equipped cannot be removed. Used for building upgrades. |
| `modifiers` | `TArray<FModifierTemplate>` | **Equippable only.** Modifiers applied while this resource is equipped. See §13 |
| `exclusiveCarry` | `bool` | If `true`, a unit carrying this resource cannot carry other resources simultaneously |

### 3.3 Abstract Storage

| `storageScope` | Storage location |
|---|---|
| `"player"` | Player State Actor (§7) — global to that player |
| `"zone"` | Zone Instance scoped inventory (§2.3) |
| `"building_tag"` | The owning player's Building Actor bearing `storageBuildingTag` |

**Silent discard:** If a step produces an abstract resource and no valid storage actor is
resolved (e.g. the designated building was demolished), the quantity is silently discarded.

> **Designer guidance:** Abstract resources should target permanent storage. `"player"` and
> `"zone"` scopes are always resolvable. A `"building_tag"` storage building should be treated
> as indestructible.

### 3.4 Resource Instances

A physical resource instance is `{ FName ResourceDefId, int32 Quantity }` held in an
`FInventorySlot` on a Building Actor, Unit Actor, or World Object Actor. Abstract resource
instances are held in `FAbstractInventorySlot` on Zone Instances or Player State Actors.
Every quantity has a defined owning actor at all times. When a unit dies, carried resources
are discarded by default. See §16.5 for drop-on-death.

---

## 4. Building Definitions

A **Building Definition** is the primary authored blueprint in Design Mode. Never modified
at runtime. Effective values are always computed as base Definition values composed with the
entity's active modifier stack (§13).

### 4.1 Core Fields

| Field | Type | Description |
|---|---|---|
| `id` | `FName` | Unique identifier |
| `name` | `FString` | Display name |
| `icon` | `TSoftObjectPtr<UTexture2D>` | Visual / map representation |
| `footprint` | `TArray<TArray<bool>>` | Binary occupancy grid; see §4.1.1 |
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

### 4.2 Attributes

Buildings declare their base attribute values here. Core attributes present on all entities
are defined in §13.1. Additional designer-defined custom attributes may be declared here.

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
FAccessPoint {
  Id:      FName
  Offset:  FIntPoint    // tile offset from building origin
  Tags:    TArray<FName>
}
```

Units path to the nearest reachable Access Point. If none declared, any adjacent tile is valid.

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
equipment should use resources with `removable: false` to represent permanent upgrades.
See §14.

---

## 5. Work Tasks & Work Steps

### 5.1 Work Task Definition

```
FWorkTaskDefinition {
  Id:           FName
  Name:         FString
  Trigger:      "loop" | "event"    // UENUM
  EventRef:     FName               // GameEventRef — id of EventDefinition; NAME_None if unused
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
  CrossTaskScript:  FString?    // evaluated when CrossTaskMode = "script";
                                // receives thisTask, candidateTask → returns bool
}
```

- `"exclusive"` — cannot run alongside any other task. Construction tasks use this.
- `"open"` — no restriction; may run alongside any other task.
- `"script"` — a Blueprint-callable expression determines compatibility.
- Conflict resolution: the more restrictive result wins, checked in both directions.
- Blocked tasks persist in `"blocked_concurrency"` until a concurrency recalculation dispatch.

### 5.3 Work Step Definition

```
FWorkStepDefinition {
  Id:                 FName
  Type:               WorkStepType              // UENUM
  Duration:           float                     // seconds; 0 = instantaneous
  WorkerRequirements: TArray<FWorkerRequirement> // all must be simultaneously present
  Preconditions:      TArray<FStepPrecondition>
  Vars:               FStepVars
}

FWorkerRequirement {
  UnitTypeId:       FName
  Count:            int32          // number of units of this type required (≥ 1)
  TagRequirements:  TArray<FName>  // present units must have ALL these tags
  AccessPointTags:  TArray<FName>  // unit must path to access point bearing ALL these tags
  Role:             "required" | "bonus"    // UENUM
  BonusEffect:      TOptional<FBonusWorkerEffect>
}
```

`TagRequirements` enables steps requiring equipped items — e.g. a jousting step requiring
`"ROYALTY"` which may be granted by a MEDAL resource in a NECK slot.

### 5.4 Step Preconditions

```
FStepPrecondition {
  Type:             "inventory_min" | "inventory_max" | "building_state" |
                    "zone_owned" | "event_flag" | "entity_has_tag"    // UENUM
  ResourceDefId:    FName
  Namespace:        "local" | "available"    // UENUM; NAME_None if unused
  Quantity:         int32
  TargetBuildingId: FName     // NAME_None if unused
  RequiredState:    FName     // NAME_None if unused
  FlagId:           FName     // NAME_None if unused
  Tag:              FName     // for entity_has_tag type
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
FTaskInstanceControl {
  TaskDefId:        FName
  bEnabled:         bool
  Priority:         "high" | "medium" | "low"    // UENUM
  ExecutionMode:    "forever" | "once" | "count"  // UENUM
  ExecutionCount:   int32     // required when ExecutionMode = "count"
  CompleteBehavior: "terminal" | "reset"          // UENUM
  State:            "idle" | "running" | "blocked_concurrency" |
                    "waiting_on_precondition" | "waiting_on_unit" | "complete"    // UENUM
  CurrentStepIndex: int32
  StepElapsed:      float
}
```

---

## 6. Unit Type Definitions

Workers and combat units are the same type. Role is expressed entirely through fields.

### 6.1 Identity & Movement

| Field | Type | Description |
|---|---|---|
| `id` | `FName` | Unique identifier |
| `name` | `FString` | Display name |
| `icon` | `TSoftObjectPtr<UTexture2D>` | Visual representation |
| `tags` | `TArray<FName>` | Classification labels (e.g. `"military"`, `"civilian"`, `"mounted"`) |
| `heightDeltaLimitDefault` | `float` | Max elevation change this unit type can traverse per tile edge when no per-tile-type override is defined |
| `heightDeltaLimits` | `TArray<FHeightDeltaEntry>` | Per-tile-type override table; mirrors the `movementCosts` pattern |

#### HeightDeltaEntry Struct

```
FHeightDeltaEntry {
  TileDefId:  FName     // reference to a Tile Definition
  Limit:      float     // max elevation delta this unit type can traverse entering that tile type
}
```

**Height delta resolution order** for a unit crossing an edge into a destination tile:

1. Check the unit type's `heightDeltaLimits` table for an entry matching `destTile.tileDefId`.
2. If found, use that limit.
3. If not found, use the unit type's `heightDeltaLimitDefault`.

This allows fine-grained terrain traversal authoring — a Giant may have a high default limit
but a low limit for ice tiles, while a Mountain Dwarf has a moderate default but an elevated
limit for stone tiles. Tiles carry no height delta opinion of their own.

### 6.2 Attributes

Unit Type Definitions declare base attribute values for all core unit attributes plus any
custom attributes. See §13.1 for the full core attribute set.

```
FAttributeDeclaration {
  AttributeId:  FName
  BaseValue:    float
}
```

At minimum every Unit Type Definition declares: `maxHealth`, `armour`, `movementSpeed`,
`attackDamage`, `attackRange`, `attackSpeed`.

### 6.3 Construction

| Field | Type | Description |
|---|---|---|
| `canConstruct` | `bool` | Whether this unit type may execute Construction Tasks |

### 6.4 Combat Flags

Combat behavior is declared as boolean flags. Numeric combat values are handled through
the attribute system (§13).

| Field | Type | Description |
|---|---|---|
| `controllable` | `bool` | Player may issue direct move/attack commands |
| `fightsBack` | `bool` | Retaliates when attacked |
| `autoEngages` | `bool` | Automatically attacks nearby enemies without a command |
| `targetSelectionPolicy` | `"nearest" \| "weakest" \| "strongest" \| "first"` | Controls target selection (UENUM) |

### 6.5 Inventory Slots

A unit's carry capacity is the **number of inventory slots** declared on its Unit Type
Definition. Each slot is generic — holds any one resource type up to that resource's
`stackSize`.

```
FUnitInventoryDeclaration {
  SlotCount:  int32    // number of generic carry slots this unit type has
}
```

Slots are not pre-bound to a resource type. At runtime each occupied slot holds
`{ FName ResourceDefId, int32 Quantity }`. Carry capacity is not a modifier target — slot
count is fixed by definition.

### 6.6 Equipment Slot Declarations

```
FEquipmentSlotDeclaration {
  SlotId:    FName      // unique within this unit type e.g. "head", "body", "neck", "weapon"
  SlotType:  FName      // matched against resource fitsSlotTypes
  Label:     FString
}
```

### 6.7 Behavioral Notes

The following are illustrative examples of how Unit Type Definition fields compose to
produce different unit roles. They are not authoritative archetypes — designers are free
to define unit types with any combination of values. These examples exist solely to
demonstrate the model's expressiveness.

- **Farmer (example):** `controllable: false`, `fightsBack: true`, `autoEngages: false`,
  low combat attribute values, 5 carry slots, no military equipment slots. Attacks back if
  struck but does not seek enemies. Capable of construction.
- **Knight (example):** `controllable: true`, `fightsBack: true`, `autoEngages: true`,
  high combat attribute values, 2 carry slots, equipment slots for head, body, weapon,
  neck. Can be assigned to a building (jousting hall, barracks) or commanded directly.
- **Monk (example):** `controllable: true`, `fightsBack: false`, `autoEngages: false`,
  minimal combat values, equipment slots for robe and neck. Produces abstract resources
  (e.g. piety) via building task assignment. Will not retaliate if attacked.

Any unit type — regardless of combat flags — may be assigned to a building and perform
work tasks. Any unit type with `controllable: true` may be directly commanded by the
player. The distinction between "worker" and "combat unit" exists only in how the designer
configures the definition, not in any structural difference in the data model.

---

## 7. The World

| Field | Type | Description |
|---|---|---|
| `mapWidth` | `int32` | Map width in tiles |
| `mapHeight` | `int32` | Map height in tiles |
| `tileSize` | `float` | World-unit size of one tile (cm) |
| `clusterSize` | `int32` | Tiles per cluster edge |
| `heightScalar` | `float` | See §1.4 |
| `elevationCostFactor` | `float` | See §1.4 |
| `pathBudgetPerTick` | `int32` | See §1.4 |
| `tiles` | `TArray<FTileInstance>` | Flat array; index = `Y * MapWidth + X` |
| `clusterGraph` | `FClusterGraph` | Hierarchical pathfinding graph; see §12 |
| `pathRequestQueue` | `TArray<FPathRequest>` | Pending pathfinding requests |
| `zones` | `TArray<FZoneInstance>` | All zone instances |
| `buildingActors` | `TArray<ABuildingActor*>` | All placed buildings |
| `unitActors` | `TArray<FUnitState>` | All active units (owned by `AUnitManagerActor`) |
| `worldObjectActors` | `TArray<AWorldObjectActor*>` | All active world objects |
| `playerStateActors` | `TArray<FPlayerStateData>` | One per player; player-scoped abstract resources |
| `activeTechs` | `TArray<FActiveTech>` | Technologies currently in effect; see §15 |
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

**`GameEventRef`** — an `FName` referencing a named `EventDefinition` id. Used wherever a
system hook needs to fire a designer-authored event. `NAME_None` = no event.

### 7.2 Player State Actor

The **Player State Actor** is a non-spatial, per-player data container that accumulates
abstract resources scoped to a player globally (not zone- or building-specific). It has no
tile footprint. One instance exists per player for the simulation session.

```
FPlayerStateData {
  PlayerId:          FName
  AbstractInventory: TArray<FAbstractInventorySlot>
}
```

Abstract resources with `storageScope: "player"` read from and write to this data.
Examples: global prestige, total accumulated faith, dynasty-wide honour.

---

## 8. Building Actors

`BuildingActor` implements: `IDamageable`, `IAttributeHolder`, `IModifiable`, `IEquippable`,
`IInventoryHolder` (see §0). Fields from these interfaces are not repeated inline below.

```
// ABuildingActor — UE AActor; implements IDamageable, IAttributeHolder, IModifiable,
//                 IEquippable, IInventoryHolder
// (Interface fields not repeated inline)

FBuildingRuntimeData {
  Id:                   FName
  DefId:                FName
  OwnerId:              FName
  OriginTile:           FIntPoint             // top-left of bounding box in world tiles
  Rotation:             int32                 // 0, 90, 180, or 270
  RotatedFootprint:     TArray<TArray<bool>>  // Definition footprint transformed by rotation
  State:                "constructing" | "idle" | "working" | "blocked" | "disabled"  // UENUM
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
  Capacity:       int32    // from InventorySlotDeclaration; not a modifier target
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

**Building inventory slot capacity is fixed** per declaration and is not a modifier target —
capacity changes are handled via equipment (§14).

---

## 9. Unit Actors

`UnitActor` implements: `IDamageable`, `IAttributeHolder`, `IModifiable`, `IEquippable`,
`IInventoryHolder` (see §0). Fields from these interfaces are not repeated inline below.

```
// FUnitState — entry in AUnitManagerActor's FFastArraySerializer TArray
// (IDamageable, IAttributeHolder, IModifiable, IEquippable, IInventoryHolder fields included)

FUnitState {
  Id:                  FName
  UnitTypeDefId:       FName
  OwnerId:             FName
  AssignedBuildingId:  TOptional<FName>
  Position:            FVector2D              // world-unit X/Y (no Z; elevation is tile data)
  State:               "idle" | "pathing" | "working" | "waiting" | "returning" |
                       "constructing" | "combat" | "dead"    // UENUM
  ClusterPath:         TArray<FIntPoint>      // high-level cluster route
  LocalPath:           TArray<FIntPoint>      // tile-level path within current cluster
  CurrentJob:          TOptional<FJobAssignment>
  Inventory:           TArray<FCarrySlot>

  // Interface data
  CurrentHealth:       float
  Attributes:          TArray<FAttributeDeclaration>
  ModifierStack:       TArray<FModifier>
  EquipmentSlots:      TArray<FEquipmentSlotInstance>

  // Combat runtime
  AttackTargetId:      TOptional<FName>
  AttackCooldown:      float
  GrantedAbilities:    TArray<FName>
}

FCarrySlot {
  ResourceDefId:  FName     // NAME_None = empty slot
  Quantity:       int32
}

FJobAssignment {
  TaskDefId:           FName
  StepDefId:           FName
  TargetBuildingId:    TOptional<FName>
  TargetAccessPointId: TOptional<FName>
  StepProgress:        float
}
```

### 9.1 Assignment Rules

- One building per unit at a time.
- Assignment persists until demolished or player reassigns.
- Removal mid-step: step cancelled, no resource refund. Carried resources remain on the unit
  until deposited or the unit dies (see §16.5).
- When a player directly commands a unit (`controllable: true`), the unit is implicitly
  unassigned from its current building job. Carried resources remain on the unit and are
  not automatically deposited. The unit may be manually tasked to deliver them.

### 9.2 Job Selection

When a unit arrives at its assigned building and enters `"idle"`:

1. Filter tasks: `enabled`, not `complete`, not `blocked_concurrency`, has a step matching
   this unit's type, and this unit satisfies any `tagRequirements` on that step.
2. Sort by `priority` (High → Medium → Low), then task declaration order.
3. Claim first eligible slot atomically.

### 9.3 Pathfinding

See §12 for the full pathfinding architecture. The canonical edge cost formula is defined
in §12.7:

```
edgeCost = resolvedMovementCost(unit.unitTypeDefId, destTile)
           + abs(destTile.elevation - srcTile.elevation) * world.elevationCostFactor
           + lateralBias(unit.id, destTileCoord)
```

`lateralBias` is a deterministic hash of `(unit.id, tileCoord)` scaled to a small float,
producing consistent route variation per unit without runtime randomness or reservation.

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
| `on_resource_threshold` | Resource quantity crosses a designer-configured threshold | `buildingActorId \| zoneId`, `resourceDefId`, `quantity`, `direction` |
| `on_zone_ownership_change` | Zone changes owner | `zoneId`, `previousOwnerId`, `newOwnerId` |
| `on_unit_assigned` | Unit assigned to building | `unitActorId`, `buildingActorId` |
| `on_unit_spawned` | Unit created by a `SPAWN_UNIT` step | `unitActorId`, `unitTypeDefId`, `buildingActorId`, `position` |
| `on_unit_damaged` | Unit takes damage | `unitActorId`, `damage`, `currentHealth`, `attackerId` |
| `on_unit_death` | Unit health reaches 0 | `unitActorId`, `unitTypeDefId`, `ownerId`, `position`, `assignedBuildingId` |
| `on_item_equipped` | Resource placed in equipment slot | `entityId`, `slotId`, `resourceDefId` |
| `on_item_unequipped` | Resource removed from equipment slot | `entityId`, `slotId`, `resourceDefId` |
| `on_world_object_spawned` | World object created | `worldObjectActorId`, `resourceDefId`, `position` |
| `on_world_object_expired` | World object timer elapsed | `worldObjectActorId`, `resourceDefId`, `position` |
| `on_world_object_pickup` | World object collected by a unit | `worldObjectActorId`, `unitActorId` |
| `on_tech_applied` | Technology takes effect | `techDefId`, `ownerId` |
| `on_objective_complete` | Zone objective threshold met | `objectiveId`, `zoneId` |
| `on_faction_stance_changed` | Faction relationship updated | `factionId`, `targetFactionId`, `newStance` |
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
  ResourceTag:    FName     // filter by resource tag on triggering hook; NAME_None = any
  // all specified non-None/non-zero filters are ANDed
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
| `ENABLE_TASK` | Enables/disables a task on a building | `buildingActorId`, `taskDefId`, `bEnabled: bool` |
| `RESET_TASK_COUNT` | Resets `executionCount` and state to "idle" for a count-mode task | `buildingActorId`, `taskDefId`, `newCount: int32` |
| `DISABLE_BUILDING` | Disables a building — no tasks run | `buildingActorId` |
| `ENABLE_BUILDING` | Re-enables a previously disabled building | `buildingActorId` |
| `SPAWN_WORLD_OBJECT` | Creates a container world object at a position | `contents: [{resourceDefId, quantity}]`, `position \| "self"` |
| `GRANT_ABILITY` | Grants an ability to a specific unit or building | `abilityDefId`, `targetEntityId` |
| `SET_FACTION_STANCE` | Changes relationship stance between two factions | `factionId`, `targetFactionId`, `stance` |
| `APPLY_TECH` | Applies a technology | `techDefId`, `ownerId` |
| `EMIT_LOG` | Writes to simulation log | `message: FString` |

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

## 12. Pathfinding & Movement

### 12.1 Why Tiles Are Not Pathfinding Nodes

Tile-as-node A* does not scale. A 480×480 map contains 230,400 nodes; NavMesh was considered
and rejected because per-tile movement costs (grass vs stone per unit type) break polygon
simplification assumptions. **HPA\*** operates on a coarser cluster graph; local A* within
each cluster uses full tile cost data.

### 12.2 ClusterCoord

Cluster coordinates use `FIntPoint` (`X`, `Y`).

### 12.3 Cluster Graph

```
FClusterGraph {
  Clusters:  TArray<TArray<FCluster>>    // [ClusterY][ClusterX]
}

FCluster {
  Coord:   FIntPoint
  bDirty:  bool                   // triggers edge recomputation next tick
  Edges:   TArray<FClusterEdge>
  Boundaries: TArray<FClusterBoundary>
}

FClusterEdge {
  TargetCluster:  FIntPoint
  Costs:          TArray<FClusterEdgeCost>    // pre-computed per unit type
  ImpassableFor:  TArray<FName>               // unitTypeIds that cannot cross this boundary
}

FClusterEdgeCost {
  UnitTypeId:  FName
  Cost:        float    // pre-computed traversal cost (tile movement costs + elevation)
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
FPathRequest {
  UnitActorId:   FName
  Destination:   FIntPoint    // tile coord
  Priority:      int32        // higher = processed sooner; convention: player_command=100, task=50, background=10
  RequestedAt:   float        // world clock time; secondary sort key
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

Where `resolvedHeightDeltaLimit` follows the per-tile-type override chain defined in §6.1:
check unit's `heightDeltaLimits` table for `destTile.tileDefId`, fall back to
`heightDeltaLimitDefault`. Tiles carry no height delta limit of their own.

### 12.8 Movement

Units advance along `localPath` by `effectiveMovementSpeed * deltaTime` per tick.
`effectiveMovementSpeed = getEffectiveAttribute(unitId, "movementSpeed")`.
On cluster boundary reached: next cluster's `localPath` computed on demand.
Units overlap freely; no reservation or avoidance system.

---

## 13. Attributes & Modifiers

All entities (buildings, units, world objects where applicable) have an **attribute set** and
a **modifier stack**. Effective attribute values are always the Definition base composed with
the active modifier stack. The Definition is never mutated.

### 13.1 Core Attributes

The following attributes are fixed and always present on every entity that declares them.
Units and buildings declare which are applicable via `AttributeDeclaration` lists in their
Definitions with their base values.

| Attribute | Applies to | Description |
|---|---|---|
| `maxHealth` | All entities | Maximum health points |
| `armour` | All entities | Damage reduction factor (0.0 = none; values reduce incoming damage) |
| `movementSpeed` | Units | World units per second |
| `attackDamage` | Units | Damage per attack |
| `attackRange` | Units | Attack range in tiles |
| `attackSpeed` | Units | Attacks per second |

### 13.2 Custom Attributes

Designers may declare additional attributes on any Definition. Custom attributes follow
the same modifier system as core attributes.

```
FCustomAttributeDefinition {
  AttributeId:   FName      // e.g. "piety", "energy", "morale"
  DisplayName:   FString
  BaseValue:     float
  MinValue:      float      // optional clamp; use -BIG_NUMBER to indicate no minimum
  MaxValue:      float      // optional clamp; use BIG_NUMBER to indicate no maximum
  bHasMinValue:  bool
  bHasMaxValue:  bool
}
```

Custom attributes are declared at the Definition level and may be targeted by modifiers
from any source (equipment, techs, events).

### 13.3 Modifier

```
FModifier {
  Id:               FName              // unique instance id
  SourceId:         FName              // who applied this (tech id, resource def id, event id)
  Tags:             TArray<FName>      // queryable labels e.g. "cursed", "armour"
  GrantsTag:        FName              // NAME_None if not granting a tag;
                                       // e.g. MEDAL resource grants "ROYALTY" tag
  AttributeTarget:  FName              // attribute id this modifier affects; NAME_None if tag/task-only
  Operation:        "additive" | "multiplicative"    // UENUM
  Value:            float              // additive: flat delta; multiplicative: factor (0.1 = +10%)
  Duration:         float              // seconds; -1.0f = indefinite (until explicitly removed)
  Elapsed:          float              // runtime: seconds this modifier has been active
  EnablesTasks:     TArray<FName>      // task ids to enable while this modifier is active
  DisablesTasks:    TArray<FName>      // task ids to disable while this modifier is active
}
```

### 13.4 Modifier Stack Evaluation

For a given entity and attribute:

```
1. baseValue     = Definition.AttributeDeclaration[attributeId].baseValue
2. addedValue    = baseValue + sum(modifier.value for modifier where operation = "additive")
3. effectiveValue = addedValue × product(1 + modifier.value for modifier where operation = "multiplicative")
```

Multiplicative modifiers compound. Order within each layer does not matter.

### 13.5 Query Interface (Conceptual)

The following queries are available to scripts, preconditions, and event filters:

| Query | Returns |
|---|---|
| `getEffectiveAttribute(entityId, attributeId)` | Composed effective value |
| `getBaseAttribute(entityId, attributeId)` | Definition base value only, ignoring all modifiers |
| `getCurrentHealth(entityId)` | Runtime current health (may be less than effective maxHealth) |
| `hasModifierWithTag(entityId, tag)` | `bool` — entity has any active modifier bearing this tag |
| `hasModifierFromSource(entityId, sourceId)` | `bool` |
| `hasEntityTag(entityId, tag)` | `bool` — checks Definition tags AND modifier-granted tags |
| `getModifiersForAttribute(entityId, attributeId)` | `Modifier[]` |
| `hasEquipmentInSlot(entityId, slotId)` | `bool` |
| `getEquippedItem(entityId, slotId)` | `resourceDefId \| null` |

**Damage calculation example (illustrative only):** The exact damage formula is not defined
here and will depend on the game's damage type system, which is a future design concern.
The following illustrates how the modifier stack and query interface compose generically.

To compute damage that ignores a specific modifier category on the target — for instance,
to model a weapon that bypasses some portion of the target's defences — the caller retrieves
the attacker's effective `attackDamage` normally, then evaluates the target's defensive
attributes while selectively excluding modifiers with a given tag from the stack evaluation.
For example, filtering out modifiers tagged `"armour"` from the target's stack before
computing their effective defensive value would produce a "defence without equipped armour"
result. The attacker's `attackDamage` is the attacker's own attribute; defensive attributes
belong to the target. These are always queried on the correct entity. The precise interplay
between attack values, defence values, and damage types is left to the game designer.

### 13.6 Modifier Expiry

Each tick, for every active modifier with a finite `duration`: `elapsed += deltaTime`. When
`elapsed >= duration` the modifier is removed from the stack and its effects are immediately
revoked — specifically: attribute changes disappear, modifier-granted tags are removed, and
any tasks enabled or disabled by this modifier revert to their prior state.

Task enablement is therefore a modifier-level capability. The `Modifier` struct carries
optional `enablesTasks` and `disablesTasks` arrays. When a modifier is applied these tasks
change state; when the modifier expires or is removed those changes are undone. Equipment
applies its task changes by instantiating modifiers with these arrays populated, meaning
unequipping an item revokes the modifier and thereby reverts the task state — there is no
separate task-management path at the equipment layer.

---

## 14. Equipment

Equipment is the mechanism by which resources are placed into named slots on entities,
applying their modifier stacks and optionally enabling or disabling tasks.

### 14.1 Equipment Slot Instance (Runtime)

```
FEquipmentSlotInstance {
  SlotId:          FName               // matches a declared FEquipmentSlotDeclaration
  SlotType:        FName
  EquippedDefId:   FName               // NAME_None = slot empty
  ModifierIds:     TArray<FName>       // ids of FModifiers currently applied by this equipment
}
```

### 14.2 Equipping a Resource

A resource may be equipped into a slot if:
1. `resource.equippable == true`
2. `resource.fitsSlotTypes` contains the slot's `slotType`
3. `resource.unitTypeConstraints` is empty, or the entity's unit type id is listed
4. `resource.tagConstraints` are all present on the entity (via `hasEntityTag`)
5. The slot is currently empty

On equip:
- The resource is removed from the source inventory (or world object actor)
- `EquipmentSlotInstance.equippedDefId` is set
- Each `ModifierTemplate` in `resource.modifiers` is instantiated as a `Modifier` and added
  to the entity's `modifierStack`; the resulting modifier ids are stored in `modifierIds`
- Any `enablesTasks` / `disablesTasks` on those modifiers take effect immediately
- `on_item_equipped` fires

### 14.3 Unequipping a Resource

If `resource.removable == false`, unequip is blocked. Otherwise:
- All `Modifier` entries in `modifierIds` are removed from the entity's stack
- All effects of those modifiers — attribute changes, granted tags, task enables/disables —
  are immediately revoked (see §13.6)
- The resource is returned to the entity's inventory or dropped as a world object
- `on_item_unequipped` fires

### 14.4 ModifierTemplate

Equipment and technologies declare modifiers as templates. At application time, a template
is instantiated into a live `FModifier` with a unique id.

```
FModifierTemplate {
  Tags:             TArray<FName>
  GrantsTag:        FName               // NAME_None if not granting a tag
  AttributeTarget:  FName               // NAME_None if tag/task-only
  Operation:        "additive" | "multiplicative"    // UENUM
  Value:            float
  Duration:         float               // -1.0f = indefinite
  EnablesTasks:     TArray<FName>
  DisablesTasks:    TArray<FName>
  GrantsAbility:    FName               // NAME_None if not granting an ability
}
```

### 14.5 Building Equipment Convention

Building equipment slots represent structural upgrades. By convention:
- Use `removable: false` on building equipment resources
- Equipment is placed via `EQUIP_ITEM` work steps or `EQUIP_ITEM` event actions
- A "millstone upgrade" is a resource with `fitsSlotTypes: ["millstone"]`, `removable: false`,
  and a `ModifierTemplate` adding +20% to some production-rate custom attribute on the mill

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
  TargetType:     "unit_type" | "building_type"    // UENUM
  TargetTags:     TArray<FName>       // if non-empty, only entities with ALL these tags are affected
  TargetDefId:    FName               // NAME_None = any entity of TargetType
  Cost:           TArray<FResourceCost>
  Effects:        TArray<FTechEffect>
}
```

### 15.2 Tech Effects

```
FTechEffect {
  Type:              "apply_modifier" | "create_resource" | "fire_event"    // UENUM
  ApplicationRule:   "indefinite" | "once"    // UENUM
  //   indefinite:  for apply_modifier — modifier applied to all current instances and
  //                every future instance of TargetDefId spawned while this tech is active
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
  AppliedAt:           float             // world clock time
  AppliedModifierIds:  TArray<FName>     // modifier ids applied to existing instances
}
```

---

## 16. World Objects

World Objects are physical entities that exist at a position on the tile map but have no
tile footprint, no pathfinding impact, and no simulation behavior of their own beyond a
timer and transformation script. They represent dropped resources, placed items, relics,
and any other designer-defined portable entities.

Like Units and Buildings, World Objects implement the relevant Bastion interfaces (§0).
In practice most world objects implement only `IInventoryHolder` — they are lightweight
data containers. Designers opt into `IDamageable` and `IAttributeHolder` by declaring a
non-zero `maxHealth`, making the object destructible.

### 16.1 World Object Behavior (embedded in Resource Definition)

```
FWorldObjectBehavior {
  bCanBePickedUp:             bool
  PickupUnitTypeConstraints:  TArray<FName>    // empty = any unit type may pick up
  PickupTagConstraints:       TArray<FName>    // picking unit must have all these tags
  Timer:                      TOptional<FWorldObjectTimer>
  bAutoPickup:                bool             // default false
}
```

#### WorldObjectTimer Struct

Real-elapsed-time based, not tick-counted (consistent with UE timer semantics).

```
FWorldObjectTimer {
  Rate:       float      // seconds between firings; must be > 0
  MaxFirings: int32      // 0 = fire indefinitely; 1 = fire once then stop; N = fire N times
  OnFire:     TOptional<FWorldObjectScript>
}
```

**Examples:**

```
// Meat that rots after 120 seconds (fires once, then world object transforms)
timer: { rate: 120.0, maxFirings: 1, onFire: transform("rotten_meat", self.quantity) }

// A relic that never expires (no timer)
timer: null

// A torch that flickers every 5 seconds indefinitely (visual/event effect only)
timer: { rate: 5.0, maxFirings: null, onFire: fireEvent("torch_flicker") }

// A poison cloud that damages nearby units every 2 seconds, 10 times, then dissipates
timer: { rate: 2.0, maxFirings: 10, onFire: <damage script>; on final firing: consume() }
```

The `on_world_object_expired` event hook fires on the **final** timer firing (when
`maxFirings` is reached). For `maxFirings: null` (indefinite) timers, this hook never
fires unless the world object is explicitly consumed by its script. The `elapsed` field
on `WorldObjectActor` tracks total seconds since the object was spawned, independent of
the timer.

### 16.2 World Object Script

A Turing-complete scripted expression defined within a `WorldObjectTimer.onFire`. It
executes each time the timer fires. The script may access world state and issue a limited
set of actions.

```
WorldObjectScript {
  script: <expression>
  // Script context:
  //   self          — this WorldObjectActor
  //   world         — read-only world state queries
  //   firing        — current firing index (1-based); equals maxFirings on final firing
  // Available actions:
  //   transform(newResourceDefId, quantity)          — replace self with a new world object
  //   consume()                                      — remove self from world silently
  //   fireEvent(eventDefId)                          — fire a named event
  //   spawnObject(resourceDefId, quantity, position) — create additional world objects
}
```

Scripts may branch on `firing` to produce different behavior on the final execution. For
example, a poison cloud may apply damage on each firing and call `consume()` only when
`firing == maxFirings`.

### 16.3 World Object Actor (Runtime)

`AWorldObjectActor` implements `IInventoryHolder` always. It implements `IDamageable` and
`IAttributeHolder` only when the designer declares a non-zero `maxHealth` (making it
destructible). It does not implement `IModifiable` or `IEquippable`.

All world objects — whether holding one resource type or many — use the unified **container**
model. A single dropped item and a multi-resource demolition pile are both `AWorldObjectActor`
instances; only the `Contents` slot count differs.

```
// AWorldObjectActor — UE AActor
FWorldObjectActorData {
  Id:              FName
  OwnerId:         TOptional<FName>
  Contents:        TArray<FContainerSlot>    // unified container; all world objects use this
  Position:        FVector2D
  TimerElapsed:    float    // seconds since last firing (resets each firing)
  FiringCount:     int32    // number of times the timer has fired
  TotalElapsed:    float    // total seconds since spawned

  // Optional interface data (only when maxHealth declared):
  CurrentHealth:   float
  Attributes:      TArray<FAttributeDeclaration>
}

FContainerSlot {
  ResourceDefId:  FName
  Quantity:       int32
}
```

### 16.4 Tile Passability

World objects do not block pathfinding. Units may overlap world objects incidentally.
World objects are not treated as tile occupants (`TileInstance.occupantId` is not set).

### 16.5 Drop on Death

By default, resources carried by a unit that dies are discarded. The `on_unit_death` event
payload includes `assignedBuildingId` and `position`. Designers may attach an event handler
to `on_unit_death` with a `SPAWN_WORLD_OBJECT` action to create a **container** at the death
position holding all (or a subset of) carried resources. If the unit carries multiple resource
types, a single `AWorldObjectActor` is spawned with one `FContainerSlot` per resource type.

**"Steals resources on kill" pattern:**
A unit type or equipment item carries a modifier that tags the unit `"LOOTER"`. An
`on_unit_death` event filtered for attacker tag `"LOOTER"` fires a `SPAWN_WORLD_OBJECT`
action, creating dropped resources at the killed unit's position. The killer may then collect
them. This is fully designer-authored — no special system behavior is required.

### 16.6 Pickup

Pickup is **not automatic by default.** A unit does not collect a world object merely by
overlapping it. Pickup is initiated in one of two ways:

1. **Player command:** The player explicitly orders a `controllable` unit to pick up a
   specific world object. The unit paths to the object's position and executes the pickup
   action on arrival.
2. **Script or event action:** A `WorldObjectScript` action, work step, or event action
   explicitly triggers a pickup for a specific unit and object.

`WorldObjectBehavior.autoPickup: true` enables the passive exception — units overlapping
the object will automatically collect it if conditions are met. This is opt-in per resource
definition and off by default. Designers use it for things like gold coins or ambient
collectables, not standard inventory items.

**Pickup execution (container):** Pickup from a container is **greedy** — the unit takes as
many resources as available `FCarrySlots` permit, filling `Contents` in order. Each
`FContainerSlot` is distributed into empty carry slots up to that resource's `stackSize` per
slot. If the unit fills all slots before emptying the container, remaining resources stay in
the container with reduced quantities. `on_world_object_pickup` fires on any successful
partial or full collection. The container is removed when all `FContainerSlot` quantities
reach 0.

---

## Data Lifecycle Summary

```
Design Mode
  └─ Author Tile Definitions
  └─ Author Zone Definitions
  └─ Author Resource Definitions
       └─ Set physical / abstract class
       └─ Set worldObjectBehavior (timer, script, pickup rules) if droppable
       └─ Set equippable fields (slots, constraints, modifierTemplates, task enables)
  └─ Author Custom Attribute Definitions (per entity type)
  └─ Author Unit Type Definitions
       └─ Declare AttributeDeclarations (core + custom base values)
       └─ Declare UnitInventoryDeclaration (slotCount for carry capacity)
       └─ Declare EquipmentSlotDeclarations
       └─ Set combat flags
  └─ Author Building Definitions
       └─ Declare AttributeDeclarations
       └─ Define Construction Task (steps ending in BUILDING_COMPLETE)
       └─ Write Placement Rule script
       └─ Declare Access Points
       └─ Declare Inventory Slots (local + available)
       └─ Declare EquipmentSlotDeclarations
       └─ Define Work Tasks (trigger, concurrency, steps with tagRequirements)
       └─ Review derived Unit Roster; set min/max/minCount
  └─ Author Tech Definitions (scope, target, effects)
  └─ Author Event Definitions (hook, filter, actions)
  └─ Author Zone Objectives

Simulation Mode
  └─ Instantiate World
       └─ Set map dimensions, tileSize, clusterSize, elevationCostFactor, pathBudgetPerTick
       └─ Populate tile map (tileDefId + elevation + zoneId per cell)
       └─ Build ClusterGraph; pre-compute ClusterEdgeCosts per unit type
  └─ Place Building Actors
       └─ Evaluate Placement Rule + zone ownership + tile occupancy
       └─ Mark affected clusters dirty
       └─ Initialize constructionControl; queue constructor PathRequests
  └─ Construction loop (same step executor as normal tasks):
       └─ On BUILDING_COMPLETE: transition to "idle", initialize TaskInstanceControls,
          release constructors, fire on_construction_complete
  └─ Assign Unit Actors to buildings
  └─ Author Connections
  └─ Apply initial Technologies if any
  └─ Run simulation (delta time per frame)
       └─ Tick modifier stacks: increment elapsed; expire finished modifiers
       └─ Recompute dirty cluster edges; invalidate affected unit paths
       └─ Process path request queue (up to pathBudgetPerTick requests)
       └─ Tick world objects: advance timerElapsed and totalElapsed by delta;
            if timer != null and timerElapsed >= timer.rate:
              increment firingCount; reset timerElapsed
              execute timer.onFire script with firing = firingCount
              if maxFirings != null and firingCount >= maxFirings:
                fire on_world_object_expired; remove object
       └─ Process event queue → execute actions
       └─ Evaluate zone objectives → fire completion events if threshold met
       └─ For each Building Actor:
            └─ Check minCount unit requirements → set "blocked" if unmet
            └─ Concurrency recalculation if any task changed state last tick
            └─ For each running/pending TaskInstanceControl:
                 └─ Check preconditions, tagRequirements, concurrency → advance or hold
                 └─ Advance stepElapsed by delta
                 └─ On step complete: execute action; advance step index or loop
       └─ For each Unit Actor:
            └─ If "combat": evaluate attackCooldown; apply damage to target (unit or building);
                 fire on_unit_damaged / on_building_damaged; check target death/destruction
            └─ If autoEngages and enemy in attackRange: transition to "combat"
            └─ If "pathing": advance along localPath by effectiveMovementSpeed * delta
                 └─ On cluster boundary: compute next localPath segment
                 └─ On destination reached: execute arrival behavior
                 └─ If destination is a world object and pickup command is active: execute pickup
            └─ If autoPickup enabled on any overlapping world object: collect if conditions met
            └─ If currentHealth <= 0 and state != "dead":
                 └─ Set state = "dead"; fire on_unit_death
                 └─ Remove from assigned building roster; cancel active job step
                 └─ Discard carried resources (or SPAWN_WORLD_OBJECT per event handler)
            └─ If idle at home: run job selection; claim task slot
       └─ For each Building Actor with currentHealth <= 0:
            └─ Fire on_building_destroyed; remove from world; mark tiles unoccupied;
               mark affected clusters dirty; cancel all in-progress task steps
       └─ Advance world clock by delta
```

---

## Key Constraints & Principles

- **Entity capabilities are composable interfaces, not a hierarchy.** `IDamageable`,
  `IAttributeHolder`, `IModifiable`, `IEquippable`, and `IInventoryHolder` are independent
  contracts. Each entity implements only the interfaces its role requires.
- **Tiles have no height delta opinion.** Elevation traversal limits are declared entirely
  on unit types via `heightDeltaLimitDefault` and a per-tile-type override table. This
  mirrors the `movementCosts` pattern and keeps tile definitions free of unit-specific data.
- **Building footprints are binary grids, not rectangles.** Only `true` cells participate
  in tile occupancy, placement validation, pathfinding blockage, and cluster invalidation.
  `false` cells within the bounding box remain freely traversable.
- **Definitions are immutable at runtime.** Effective values are always Definition base
  composed with the active modifier stack. The Definition is never patched.
- **Every resource quantity has a defined owning actor.** Physical resources live in
  `InventorySlot` or `CarrySlot` on a Building, Unit, or World Object Actor. Abstract
  resources live in `AbstractInventorySlot` on a Zone Instance, Player State Actor, or
  designated Building Actor. Neither class may exist without an owning actor.
- **Unit carry capacity is slot count, not a modifier.** The number of `CarrySlots` is
  fixed by the Unit Type Definition. It is not an attribute and cannot be changed by
  modifiers. Slot count defines capacity; resource `stackSize` defines per-slot quantity.
- **Building inventory capacity is fixed per slot declaration.** Building slot capacities
  are declared explicitly and are not modifier targets.
- **Work Steps are the only mechanism for building-internal state change.** Inventory
  cannot change except through step execution.
- **Unit presence is a gate, not a trigger.** A step with `unitTypeId` blocks until a unit
  of that type is present. A step with `tagRequirements` blocks until the present unit
  satisfies all required tags. Dispatch is driven by the unit's job selection loop.
- **Tag resolution is always live.** `hasEntityTag` checks Definition tags and all active
  modifier-granted tags. Tags disappear when their granting modifier expires or is removed.
- **Equipment is the sole mechanism for stat and capability modification.** There are no
  separate upgrade or patch structures. All changes — permanent or timed, unit or building —
  flow through the modifier stack and equipment system.
- **Technologies apply to types, not instances.** An `"indefinite"` tech modifier applies
  to all current instances and all future spawns of the target definition. A `"once"` tech
  effect applies only to instances alive at application time.
- **Pickup is player-directed by default.** Units do not automatically collect world objects
  by proximity. Pickup requires an explicit player command, a script action, or a resource
  with `autoPickup: true`.
- **Blocked tasks persist.** A concurrency-blocked task waits for a recalculation dispatch.
  It does not skip or cancel.
- **Placement rules are evaluated at placement time only.** Already-placed buildings are
  not re-validated if surrounding world state changes.
- **Units are exclusively assigned.** One building per unit at a time. Removal mid-step
  cancels the step with no resource refund. Carried resources remain on the unit.
- **Tiles are the world primitive; clusters are the pathfinding primitive.** Cluster edge
  weights are derived from tile data and are per-unit-type. Tile data is never abstracted
  away — it is the source of truth for all movement cost calculations.
- **Path requests are queued.** No burst of simultaneous path computations. Budget is
  enforced by `World.pathBudgetPerTick`.
- **World objects do not block pathfinding.** Units overlap them freely. Interaction is
  intentional only — via player command, script action, or `autoPickup`.
- **Building destruction clears tile occupancy and invalidates clusters.** A destroyed
  building's footprint tiles are immediately freed and affected clusters marked dirty.
- **The World is the single source of truth.** Nothing is cached outside World state
  during a live simulation session.
