# Bastion — Entities / Workers

> Part of the [Bastion RTS Engine Data Structures](README.md) reference.
> Related domains: [Tile/World](TILE_WORLD.md) · [Resources](RESOURCES.md) · [Buildings/Jobs](BUILDINGS_JOBS.md)

---

## 0. Entity Interfaces

Rather than a single monolithic base, Bastion defines a set of composable interfaces. Each
entity type implements only the interfaces relevant to its role. This avoids forcing
capabilities onto entities that don't need them — a dropped resource world object has no
need for equipment slots; a cosmetic building prop may not need a modifier stack.

The interfaces are structural contracts, not class hierarchies. In UE they are implemented
as pure virtual `UInterface` types. In the editor and Python demo they are duck-typed
struct conventions.

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
mutated. Modifier stack evaluation, expiry, and querying are defined in §13 below.

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
Equipment slots are declared in the entity's Definition (see [Buildings/Jobs §4.8](BUILDINGS_JOBS.md)
and §6.6 below). See [Resources §14](RESOURCES.md) for equipment mechanics.

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
- **Units** — `CarrySlot[]` (generic, count-bounded; see §6.5 and §9 below)
- **Buildings** — `InventorySlot[]` for local and available namespaces (see [Buildings/Jobs §4.6, §8](BUILDINGS_JOBS.md))
- **World Objects** — `{ resourceDefId, quantity }` single-resource container (see [Resources §16.3](RESOURCES.md))

---

### Interface Implementation Summary

| Entity | IDamageable | IAttributeHolder | IModifiable | IEquippable | IInventoryHolder |
|---|---|---|---|---|---|
| **Unit** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Building** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **World Object** | optional | optional | — | — | ✓ |

---

## 6. Unit Type Definitions

Workers and combat units are the same type. Role is expressed entirely through fields.

### 6.1 Identity & Movement

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier |
| `name` | `string` | Display name |
| `icon` | `asset ref` | Visual representation |
| `tags` | `string[]` | Classification labels (e.g. `"military"`, `"civilian"`, `"mounted"`) |
| `heightDeltaLimitDefault` | `float` | Max elevation change this unit type can traverse per tile edge when no per-tile-type override is defined |
| `heightDeltaLimits` | `HeightDeltaEntry[]` | Per-tile-type override table; mirrors the `movementCosts` pattern |

#### HeightDeltaEntry Struct

```
HeightDeltaEntry {
  tileDefId:  string    // reference to a Tile Definition
  limit:      float     // max elevation delta this unit type can traverse entering that tile type
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
custom attributes. See §13.1 below for the full core attribute set.

```
AttributeDeclaration {
  attributeId:  string
  baseValue:    float
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

### 6.5 Inventory Slots

A unit's carry capacity is defined by the **number of inventory slots** declared on its
Unit Type Definition. Each slot is generic — it holds any one resource type up to that
resource's `stackSize`. The slot count is the capacity; a farmer with 5 slots can carry
5 distinct resource stacks simultaneously, a knight with 2 slots can carry 2.

```
UnitInventoryDeclaration {
  slotCount:  int    // number of generic carry slots this unit type has
}
```

Slots are not pre-bound to a resource type in the definition. At runtime each occupied slot
holds `{ resourceDefId, quantity }`. A slot is empty until a resource is placed into it.

If a carried resource has `exclusiveCarry: true`, it must occupy all slots on the unit —
no other resource may be carried simultaneously while it is held.

Carry capacity is not an attribute modifier target. Adding inventory slots via a modifier is
not supported; slot count is fixed by the unit type definition. Designers who need variable
carry capacity should design separate unit types.

### 6.6 Equipment Slot Declarations

Units declare named equipment slots that equippable resources may be placed into.

```
EquipmentSlotDeclaration {
  slotId:    string    // unique within this unit type e.g. "head", "body", "neck", "weapon"
  slotType:  string    // type string matched against resource fitsSlotTypes
  label:     string
}
```

### 6.7 Behavioral Notes

The following are illustrative examples of how Unit Type Definition fields compose to
produce different unit roles. They are not authoritative archetypes — designers are free
to define unit types with any combination of values.

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

## 9. Unit Actors

`UnitActor` implements: `IDamageable`, `IAttributeHolder`, `IModifiable`, `IEquippable`,
`IInventoryHolder` (see §0). Fields from these interfaces are not repeated inline below.

```
UnitActor {
  // IDamageable:      currentHealth
  // IAttributeHolder: attributes
  // IModifiable:      modifierStack
  // IEquippable:      equipmentSlots
  // IInventoryHolder: inventory (CarrySlot[])

  id:                  string
  unitTypeDefId:       string
  ownerId:             string
  assignedBuildingId:  string | null
  position:            { x: float, y: float }
  state:               "idle" | "pathing" | "working" | "waiting" | "returning" |
                       "constructing" | "combat" | "dead"
  currentPath: {
    clusterPath:  ClusterCoord[]
    localPath:    TileCoord[]
  }
  currentJob:          JobAssignment | null
  inventory:           CarrySlot[]

  // Combat runtime state
  attackTargetId:      string | null
  attackCooldown:      float
}

CarrySlot {
  resourceDefId:  string | null   // null = empty slot
  quantity:       int
}

JobAssignment {
  taskDefId:           string
  stepDefId:           string
  targetBuildingId:    string | null
  targetAccessPointId: string | null
  stepProgress:        float
}
```

### 9.1 Assignment Rules

- One building per unit at a time.
- Assignment persists until demolished or player reassigns.
- Removal mid-step: step cancelled, no resource refund. Carried resources remain on the unit
  until deposited or the unit dies (see [Resources §16.5](RESOURCES.md)).
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

See [Tile/World §12](TILE_WORLD.md) for the full pathfinding architecture. The canonical
edge cost formula is:

```
edgeCost = resolvedMovementCost(unit.unitTypeDefId, destTile)
           + abs(destTile.elevation - srcTile.elevation) * world.elevationCostFactor
           + lateralBias(unit.id, destTileCoord)
```

`lateralBias` is a deterministic hash of `(unit.id, tileCoord)` scaled to a small float,
producing consistent route variation per unit without runtime randomness or reservation.

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
CustomAttributeDefinition {
  attributeId:   string    // e.g. "piety", "energy", "morale"
  displayName:   string
  baseValue:     float
  minValue:      float?    // optional clamp
  maxValue:      float?
}
```

Custom attributes are declared at the Definition level and may be targeted by modifiers
from any source (equipment, techs, events).

### 13.3 Modifier

```
Modifier {
  id:               string              // unique instance id
  sourceId:         string              // who applied this (tech id, resource def id, event id)
  tags:             string[]            // queryable labels on this modifier e.g. "cursed"
  grantsTag:        string | null       // if set, the entity bearing this modifier gains this tag
                                        // e.g. MEDAL resource grants "ROYALTY" tag
  attributeTarget:  string | null       // attribute id this modifier affects; null if tag/task-only
  operation:        "additive" | "multiplicative"
  value:            float               // additive: flat delta; multiplicative: factor (0.1 = +10%)
  duration:         float | "indefinite"  // seconds; "indefinite" = until explicitly removed
  elapsed:          float               // runtime: seconds this modifier has been active
  enablesTasks:     string[]            // task ids to enable on the entity while this modifier is active
  disablesTasks:    string[]            // task ids to disable on the entity while this modifier is active
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
result. The precise interplay between attack values, defence values, and damage types is
left to the game designer.

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

## Key Constraints (Entities/Workers Domain)

- **Entity capabilities are composable interfaces, not a hierarchy.** `IDamageable`,
  `IAttributeHolder`, `IModifiable`, `IEquippable`, and `IInventoryHolder` are independent
  contracts. Each entity implements only the interfaces its role requires.
- **Definitions are immutable at runtime.** Effective values are always Definition base
  composed with the active modifier stack. The Definition is never patched.
- **Unit carry capacity is slot count, not a modifier.** The number of `CarrySlots` is
  fixed by the Unit Type Definition. It is not an attribute and cannot be changed by
  modifiers. Slot count defines capacity; resource `stackSize` defines per-slot quantity.
- **Unit presence is a gate, not a trigger.** A step with `unitTypeId` blocks until a unit
  of that type is present. A step with `tagRequirements` blocks until the present unit
  satisfies all required tags. Dispatch is driven by the unit's job selection loop.
- **Tag resolution is always live.** `hasEntityTag` checks Definition tags and all active
  modifier-granted tags. Tags disappear when their granting modifier expires or is removed.
- **Units are exclusively assigned.** One building per unit at a time. Removal mid-step
  cancels the step with no resource refund. Carried resources remain on the unit.
- **Equipment is the sole mechanism for stat and capability modification.** There are no
  separate upgrade or patch structures. All changes — permanent or timed, unit or building —
  flow through the modifier stack and equipment system.
