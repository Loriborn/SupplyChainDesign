# Bastion — Resources

> Part of the [Bastion RTS Engine Data Structures](README.md) reference.
> Related domains: [Tile/World](TILE_WORLD.md) · [Entities/Workers](ENTITIES_WORKERS.md) · [Buildings/Jobs](BUILDINGS_JOBS.md)

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
| `tags` | `TArray<FName>` | Classification labels. Queryable in `EventFilter` and `StepPrecondition`. See §3.5. |
| `worldObjectBehavior` | `TOptional<FWorldObjectBehavior>` | Defines behavior when dropped as a world entity; unset = cannot be dropped. See §16 |
| `equippable` | `bool` | Whether this resource can be placed into an equipment slot |
| `fitsSlotTypes` | `TArray<FName>` | **Equippable only.** Slot type names this resource fits into |
| `unitTypeConstraints` | `TArray<FName>` | **Equippable only.** If non-empty, only unit types with a matching id may equip this resource |
| `tagConstraints` | `TArray<FName>` | **Equippable only.** The equipping entity must possess all listed tags |
| `removable` | `bool` | **Equippable only.** Default `true`. If `false`, once equipped cannot be removed. Used for building upgrades. |
| `modifiers` | `TArray<FModifierTemplate>` | **Equippable only.** Modifiers applied while this resource is equipped. See §13 in [Entities/Workers](ENTITIES_WORKERS.md) |
| `exclusiveCarry` | `bool` | If `true`, a unit carrying this resource cannot carry other resources simultaneously |

### 3.3 Abstract Storage

| `storageScope` | Storage location |
|---|---|
| `"player"` | Player State Actor ([Tile/World §7.2](TILE_WORLD.md)) — global to that player |
| `"zone"` | Zone Instance scoped inventory ([Tile/World §2.3](TILE_WORLD.md)) |
| `"building_tag"` | The owning player's Building Actor bearing `storageBuildingTag` |

**Silent discard:** If a step produces an abstract resource and no valid storage actor is
resolved (e.g. the designated building was demolished), the quantity is silently discarded.
No error is raised.

**Overflow when storage is full:** If the resolved storage actor exists but its
`AbstractInventorySlot.quantity` is already at `capacity`, any excess production is also
silently discarded. The slot is not allowed to exceed its declared capacity.

> **Designer guidance:** Abstract resources should target storage that is permanent for the
> session. `"player"` and `"zone"` scopes are always resolvable. A `"building_tag"` storage
> building should be treated as indestructible.

### 3.4 Resource Instances

A physical resource instance is `{ resourceDefId, quantity }` held in an `InventorySlot` on a
Building Actor, Unit Actor, or World Object Actor. Abstract resource instances are held in
`AbstractInventorySlot` on Zone Instances or Player State Actors. Every quantity has a
defined owning actor at all times. When a unit carrying resources dies, those resources are
discarded by default. See §16.5 for the drop-on-death extension.

### 3.5 Resource Tags in Filters and Preconditions

`Resource.tags` is consumed by two systems:

**Event filters:** `EventFilter` supports a `resourceTag` field. When set, the event only
fires if the resource involved in the triggering hook bears that tag. For example, a filter
with `resourceTag: "sacred"` on an `on_world_object_pickup` hook fires only when a sacred
resource is collected.

```
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

**Step preconditions:** `FStepPrecondition` supports a `"resource_has_tag"` type that tests
whether a resource in a specified slot bears a given tag.

```
FStepPrecondition {
  // existing types ...
  Type:          "resource_has_tag"    // UENUM value
  Namespace:     "local" | "available"
  ResourceSlot:  FName    // resourceDefId of the slot to inspect
  Tag:           FName    // the resource definition must have this tag
}
```

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
  are immediately revoked (see [Entities/Workers §13.6](ENTITIES_WORKERS.md))
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

## 16. World Objects

World Objects are physical entities that exist at a position on the tile map but have no
tile footprint, no pathfinding impact, and no simulation behavior of their own beyond a
timer and transformation script. They represent dropped resources, placed items, relics,
and any other designer-defined portable entities.

Like Units and Buildings, World Objects implement the relevant Bastion interfaces
(see [Entities/Workers §0](ENTITIES_WORKERS.md)). In practice most world objects implement
only `IInventoryHolder` — they are lightweight data containers. Designers opt into
`IDamageable` and `IAttributeHolder` by declaring a non-zero `maxHealth`, making the object
destructible.

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

`WorldObjectActor` implements `IInventoryHolder` always. It implements `IDamageable` and
`IAttributeHolder` only when the designer declares a non-zero `maxHealth` on the resource's
attribute set (making it destructible). It does not implement `IModifiable` or `IEquippable`.

All world objects — whether they hold one resource type or many — use the unified
**container** model. A single-resource dropped item and a multi-resource demolition pile
are both `WorldObjectActor` instances; the only difference is how many `ContainerSlot`
entries they have.

```
// AWorldObjectActor — UE AActor
// Implements IInventoryHolder always. Implements IDamageable and IAttributeHolder only
// when the resource definition declares a non-zero maxHealth.

FWorldObjectActorData {
  Id:              FName
  OwnerId:         TOptional<FName>
  Contents:        TArray<FContainerSlot>    // unified container; always used regardless of slot count
  Position:        FVector2D
  TimerElapsed:    float     // seconds since last firing (resets each firing)
  FiringCount:     int32     // number of times the timer has fired
  TotalElapsed:    float     // total seconds since spawned

  // Optional — only when designer declares non-zero maxHealth:
  CurrentHealth:   float
  Attributes:      TArray<FAttributeDeclaration>
}

FContainerSlot {
  ResourceDefId:  FName
  Quantity:       int32
}
```

**Spawning containers:** Designers may create world object containers via:
- `SPAWN_WORLD_OBJECT` event action (specify `contents[]` rather than a single resource)
- `on_unit_death` / `on_building_demolished` handlers that drop all carried/stored resources
- Map authoring (pre-placed containers at specific positions)

If a `SPAWN_WORLD_OBJECT` action specifies a single resource, the resulting `WorldObjectActor`
has `contents` with one `ContainerSlot`. The container model is always used regardless of
slot count.

**Inherited behavior:** Container world objects inherit `WorldObjectBehavior` from the
**primary** resource definition — the first slot's `resourceDefId`. For demolition and
unit-death containers (multi-resource), the engine uses a **generic container behavior**
defined at the world level with a decay timer so that dropped items do not persist
indefinitely by default. Designers may override this via the event handler that spawns the
container.

### 16.4 Tile Passability

World objects do not block pathfinding. Units may overlap world objects incidentally.
World objects are not treated as tile occupants (`TileInstance.occupantId` is not set).

### 16.5 Drop on Death

By default, resources carried by a unit that dies are discarded. The `on_unit_death` event
payload includes `assignedBuildingId` and `position`. Designers may attach an event handler
to `on_unit_death` with a `SPAWN_WORLD_OBJECT` action to create a **container** at the death
position holding all (or a subset of) carried resources. All carried resources that should
be dropped are merged into a single `WorldObjectActor` with one `ContainerSlot` per resource
type.

**Multi-resource drop:** If a unit carries three different resource types when it dies and
the designer's event handler drops all of them, a single container world object is spawned
with three `ContainerSlot` entries. Players targeting the container with a worker will pick
up all contents (greedy; see §16.6).

**"Steals resources on kill" pattern:**
A unit type or equipment item carries a modifier that tags the unit `"LOOTER"`. An
`on_unit_death` event filtered for attacker tag `"LOOTER"` fires a `SPAWN_WORLD_OBJECT`
action, creating a dropped resource container at the killed unit's position. The killer may
then collect it. This is fully designer-authored — no special system behavior is required.

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
definition and off by default.

**Pickup execution (container):** Pickup from a container is **greedy by default** — the
unit takes as many resources from the container as its available `CarrySlots` can hold,
filling slots in `contents` order. Each `ContainerSlot` is distributed into the unit's
empty slots up to that resource's `stackSize` per slot. If the unit fills all slots before
emptying the container, the remaining resources stay in the container with reduced quantities.
`on_world_object_pickup` fires on any successful partial or full collection. The container
world object is removed from the world when all `ContainerSlot` quantities reach 0.

> **Future UX consideration:** Selective pickup from a multi-resource container (choosing
> specific resource types) may be exposed via a context menu in a future UX pass. The default
> greedy behaviour is specified here; selective pickup is not yet defined.

---

## Key Constraints (Resources Domain)

- **Every resource quantity has a defined owning actor.** Physical resources live in
  `InventorySlot` or `CarrySlot` on a Building, Unit, or World Object Actor. Abstract
  resources live in `AbstractInventorySlot` on a Zone Instance, Player State Actor, or
  designated Building Actor. Neither class may exist without an owning actor.
- **All world objects use the unified container model.** `WorldObjectActor.contents` is
  always `ContainerSlot[]`. Single-resource and multi-resource dropped items are structurally
  identical — only the slot count differs.
- **Abstract resource overflow is a silent discard.** When the target storage actor's slot is
  at capacity, excess production is silently discarded. No error, no backpressure.
- **Pickup is greedy by default.** Units take as many resources as carry slots permit, filling
  in `contents` slot order. Leftovers remain in the container.
- **Pickup is player-directed by default.** Units do not automatically collect world objects
  by proximity. Pickup requires an explicit player command, a script action, or a resource
  with `autoPickup: true`.
- **Resource tags are consumed by event filters and preconditions.** They are not purely
  cosmetic; `EventFilter.resourceTag` and `StepPrecondition` type `"resource_has_tag"` query them.
- **World objects do not block pathfinding.** Units overlap them freely. Interaction is
  intentional only — via player command, script action, or `autoPickup`.
- **Equipment is the sole mechanism for stat and capability modification.** There are no
  separate upgrade or patch structures. All changes — permanent or timed, unit or building —
  flow through the modifier stack and equipment system.
