# Bastion — Entities / Workers

> Part of the [Bastion RTS Engine Data Structures](README.md) reference.
> Related domains: [Tile/World](TILE_WORLD.md) · [Resources](RESOURCES.md) · [Buildings/Jobs](BUILDINGS_JOBS.md)

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
- **World Objects** — `contents: ContainerSlot[]` multi-resource container (see [Resources §16.3](RESOURCES.md))

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
| `id` | `FName` | Unique identifier |
| `name` | `FString` | Display name |
| `icon` | `TSoftObjectPtr<UTexture2D>` | Visual representation |
| `tags` | `FGameplayTagContainer` | Classification labels (e.g. `Unit.Role.Military`, `Unit.Role.Civilian`, `Unit.Movement.Mounted`) |
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
custom attributes. See §13.1 below for the full core attribute set.

```
FAttributeDeclaration {
  AttributeId:  FName
  BaseValue:    float
}
```

At minimum every Unit Type Definition declares: `maxHealth`, `armour`, `movementSpeed`,
`attackDamage`, `attackRange`, `attackSpeed`.

### 6.3 Skills

A unit type declares which skills it can develop via veterancy. See §21 for the full Skill
System specification.

```
FUnitTypeSkillDeclaration {
  SkillId:      FName    // references a FSkillDefinition
  InitialLevel: int32    // level at spawn; default 0
}
```

`Skills: TArray<FUnitTypeSkillDeclaration>` on the unit type definition. At spawn, the
unit's custom attribute set is initialized with `XPAttributeId: 0.0` and
`LevelAttributeId: InitialLevel` for each declared skill.

### 6.4 Construction

| Field | Type | Description |
|---|---|---|
| `canConstruct` | `bool` | Whether this unit type may execute Construction Tasks |

### 6.5 Combat Flags & Target Selection

Combat behavior is declared as boolean flags. Numeric combat values are handled through
the attribute system (§13).

| Field | Type | Description |
|---|---|---|
| `controllable` | `bool` | Player may issue direct move/attack commands |
| `fightsBack` | `bool` | Retaliates when attacked. Unit auto-casts its default attack ability on its attacker when struck, if not already in combat. |
| `autoEngages` | `bool` | Automatically attacks nearby enemies without a command. "Nearby" is defined as within the unit's effective `attackRange`. "Enemy" is any unit or building whose `ownerId` belongs to a faction with a hostile relationship to this unit's faction (see §6.10). |
| `targetSelectionPolicy` | `TargetSelectionPolicy` | Controls which enemy the unit selects when `autoEngages` or `fightsBack` is active. See below. |

#### TargetSelectionPolicy

```
TargetSelectionPolicy =
    "nearest"    // select the valid target closest to this unit's current position
  | "weakest"    // select the valid target with the lowest effective currentHealth
  | "strongest"  // select the valid target with the highest effective maxHealth
  | "first"      // select the first valid target in world iteration order (deterministic
                 // but arbitrary — useful for reproducibility in tests)
```

`targetSelectionPolicy` may be modified via the modifier stack (see §13) to allow techs or
equipment to change a unit's targeting behaviour at runtime. Modifiers targeting this field
replace the policy rather than stacking — the most recently applied modifier wins.

Default: `"nearest"` if not specified on the Unit Type Definition.

### 6.6 Inventory Slots

A unit's carry capacity is defined by the **number of inventory slots** declared on its
Unit Type Definition. Each slot is generic — it holds any one resource type up to that
resource's `stackSize`. The slot count is the capacity; a farmer with 5 slots can carry
5 distinct resource stacks simultaneously, a knight with 2 slots can carry 2.

```
FUnitInventoryDeclaration {
  SlotCount:  int32    // number of generic carry slots this unit type has
}
```

Slots are not pre-bound to a resource type in the definition. At runtime each occupied slot
holds `{ resourceDefId, quantity }`. A slot is empty until a resource is placed into it.

If a carried resource has `exclusiveCarry: true`, it must occupy all slots on the unit —
no other resource may be carried simultaneously while it is held.

Carry capacity is not an attribute modifier target. Adding inventory slots via a modifier is
not supported; slot count is fixed by the unit type definition. Designers who need variable
carry capacity should design separate unit types.

### 6.7 Equipment Slot Declarations

Units declare named equipment slots that equippable resources may be placed into.

```
FEquipmentSlotDeclaration {
  SlotId:    FName          // unique within this unit type e.g. "head", "body", "neck", "weapon"
  SlotType:  FGameplayTag   // matched against resource fitsSlotTypes
  Label:     FString
}
```

### 6.8 Behavioral Notes

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

### 6.9 Predefined Abilities

A unit type declares zero or more ability references in its definition. These are the
abilities the unit has when spawned, before any equipment or tech grants are applied.

```
FUnitTypeAbilityRef {
  AbilityDefId:  FName
}
```

Abilities are a first-class definition type. See §18 for the full `AbilityDefinition` spec.

### 6.10 Faction / Ownership Model

Every unit and building actor has an `ownerId` that references a `PlayerDefinition`.
Every player belongs to exactly one faction. Faction membership determines the "enemy"
relationship for combat purposes.

```
FPlayerDefinition {
  Id:        FName
  Name:      FString
  FactionId: FName    // reference to a FactionDefinition
}

FFactionDefinition {
  Id:            FName
  Name:          FString
  Relationships: TArray<FFactionRelationship>
}

FFactionRelationship {
  TargetFactionId: FName
  Stance:          "friendly" | "neutral" | "hostile"    // UENUM
}
```

**Enemy determination:** A unit treats any actor whose owner belongs to a faction with
`stance: "hostile"` toward the unit's own faction as an enemy. Neutral actors are ignored
by `autoEngages` and `fightsBack`. Friendly actors are never targeted.

**Game mode examples:**
- *Team vs Team* — two faction groups, each faction's relationships pre-set to hostile
  toward the opposing group.
- *Free-for-all* — each player is its own faction; all inter-faction relationships set to
  hostile.
- *Diplomacy* — faction relationships may be changed at runtime via event actions
  (e.g. `SET_FACTION_STANCE`), enabling alliances, betrayals, and ceasefires.

Faction relationships are the sole arbiter of the "is enemy" test. There is no separate
"ally" or "team" field — all of that is expressed through `FactionRelationship.stance`.

---

## 9. Unit Actors

`UnitActor` implements: `IDamageable`, `IAttributeHolder`, `IModifiable`, `IEquippable`,
`IInventoryHolder` (see §0). Fields from these interfaces are not repeated inline below.

```
// FUnitState — entry in AUnitManagerActor's FFastArraySerializer TArray
// (implements IDamageable, IAttributeHolder, IModifiable, IEquippable, IInventoryHolder)

FUnitState {
  // IDamageable:
  CurrentHealth:       float

  // IAttributeHolder:
  Attributes:          TArray<FAttributeDeclaration>

  // IModifiable:
  ModifierStack:       TArray<FModifier>

  // IEquippable:
  EquipmentSlots:      TArray<FEquipmentSlotInstance>

  // IInventoryHolder:
  Inventory:           TArray<FCarrySlot>

  Id:                  FName
  UnitTypeDefId:       FName
  OwnerId:             FName
  AssignedBuildingId:  TOptional<FName>
  Position:            FVector2D             // world-unit X/Y
  State:               "idle" | "pathing" | "working" | "waiting" | "returning" |
                       "constructing" | "combat" | "dead"    // UENUM
  ClusterPath:         TArray<FIntPoint>     // high-level cluster route
  LocalPath:           TArray<FIntPoint>     // tile-level path within current cluster
  CurrentJob:          TOptional<FJobAssignment>

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

### 9.0 Unit State Transitions

State transitions are outcome-driven. The state reflects the unit's current activity and
changes when a discrete outcome occurs, not on a fixed schedule.

| Transition | Condition |
|---|---|
| any → `dead` | `currentHealth` reaches 0. Fires `on_unit_death`. Unit is removed from world. |
| `idle` → `pathing` | Unit is assigned a destination (building access point or direct command). |
| `pathing` → `idle` | Unit reaches destination with no pending task. |
| `pathing` → `working` | Unit reaches building access point and claims a task step. |
| `pathing` → `constructing` | Unit with `canConstruct: true` reaches a building in `"constructing"` state. |
| `pathing` → `combat` | Unit with `autoEngages: true` detects an enemy within `attackRange` while pathing. Unit halts and engages. |
| `working` → `waiting` | The unit is present at the building but no eligible task step is available (all steps blocked by preconditions, concurrency, or unit type mismatch). Unit stays assigned and waits for a step to become available. |
| `working` → `returning` | Unit completes a `DELIVER_RESOURCE` or `COLLECT_RESOURCE` step that requires the unit to move away from its assigned building. The unit paths back to the building on completion. |
| `returning` → `working` | Unit re-arrives at the assigned building's access point. |
| `working` → `idle` | Unit's assigned building is demolished or unit is explicitly unassigned. |
| `combat` → `idle` | Combat target is destroyed or moves out of `attackRange` and no other valid target is in range. |
| `combat` → `pathing` | Player issues a move or assign command to the unit (`controllable: true` only). |
| `idle` → `combat` | Unit with `autoEngages: true` detects a hostile actor within `attackRange`. |
| `constructing` → `idle` | `BUILDING_COMPLETE` step fires; unit is released. |

The `waiting` state means the unit is present at its building but blocked on step
availability. `idle` means the unit has no assigned building and no pending action.

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

| Attribute | Applies to | Description | Floor |
|---|---|---|---|
| `maxHealth` | All entities | Maximum health points | 1 (cannot be reduced below 1 by modifiers) |
| `armour` | All entities | Damage reduction factor (0.0 = none; implementation-defined formula) | 0.0 |
| `movementSpeed` | Units | World units per second | 0.0 (unit stops moving if reduced to 0) |
| `attackDamage` | Units | Damage per attack | 0.0 |
| `attackRange` | Units | Attack range in tiles | 0.0 |
| `attackSpeed` | Units | Attacks per second (governs default attack ability cooldown — see §18) | 0.0 |

**Floor enforcement:** After composing base value + modifier stack, if the result is below
the attribute's floor, the effective value is clamped to the floor. The floor applies to the
composed effective value only — individual modifier values may be any float. `currentHealth`
is additionally clamped to `[0, effectiveMaxHealth]` whenever `maxHealth` changes.

**Custom attribute floors:** Defined via `CustomAttributeDefinition.minValue` / `maxValue`
(see §13.2). Custom attributes have no hardcoded floor unless the designer specifies one.

### 13.2 Custom Attributes

Designers may declare additional attributes on any Definition. Custom attributes follow
the same modifier system as core attributes.

```
FCustomAttributeDefinition {
  AttributeId:   FName      // e.g. "piety", "energy", "morale"
  DisplayName:   FString
  BaseValue:     float
  MinValue:      float      // used when bHasMinValue = true
  MaxValue:      float      // used when bHasMaxValue = true
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
  Tags:             FGameplayTagContainer  // queryable labels e.g. Modifier.Cursed, Modifier.Armour
  GrantsTag:        FGameplayTag          // empty tag if not granting a tag;
                                          // e.g. MEDAL resource grants Unit.Status.Royalty
  AttributeTarget:  FName              // NAME_None if tag/task-only
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

---

## 18. Abilities

Abilities are player-invoked, auto-triggered, or always-on effects that units and buildings
can have. They are the mechanism for all direct combat interactions, targeted support actions,
player-facing micro-management, and passive always-on effects. Abilities are distinct from
work tasks — they are not part of the macro economy system and do not interact with inventory
steps.

**Reference model:** BFME (Battle for Middle Earth) abilities — player selects a unit or
building, clicks an ability button, selects a target (unit, building, tile, or area), and
the effect fires. Abilities range from direct damage to buffs to AoE effects. Passive
abilities (auras, always-on self-buffs) extend this model.

**Attribute referencing:** Abilities do not require unit attributes. Effect fields like
`damageScalesWith` and `healScalesWith` are optional — an ability may use a flat value, scale
from an attribute, or combine both. When an attribute is referenced, the ability reads
`getEffectiveAttribute(casterId, attributeId)` at the moment of firing. This means modifier
stack changes (from equipment, techs, or events) automatically affect the ability's power
without any additional wiring. An ability that has no attribute dependencies is equally valid
— it simply uses its declared flat values. This is analogous to UE GAS attribute accessors:
the system provides the lookup; nothing forces abilities to use it.

### 18.1 AbilityDefinition

```
FAbilityDefinition {
  Id:                FName
  Name:              FString
  Icon:              TSoftObjectPtr<UTexture2D>
  Description:       FString

  activationType:    "active" | "passive"
  // "active"  — player-triggered or autocast; uses targetType, cooldown, effects below
  // "passive" — always-on; activates when granted, deactivates when revoked;
  //             uses passiveEffect below; targetType, cooldown, autocast are ignored

  // ── Active ability fields (used when activationType = "active") ────────────

  // Targeting
  TargetType:        EAbilityTargetType    // UENUM; see below
  TargetRadius:      float                 // used for tile_position and all_in_radius types
  TargetConstraint:  FAbilityTargetConstraint

  // Activation
  Cooldown:                 float                              // seconds between uses; 0 = no cooldown
  ResourceCosts:            TArray<FAbilityCost>
  bAutocast:                bool
  AutocastConditionClass:   TSubclassOf<UAbilityAutocastCondition>
                            // Optional (null = autocast whenever TargetConstraint is satisfied
                            // and cooldown has elapsed). Assign a Blueprint subclass of
                            // UAbilityAutocastCondition for conditional logic (e.g. "only when
                            // caster health < 50%"). See UAbilityAutocastCondition below.

  // Effect
  Effects:                  TArray<FAbilityEffect>
}
```

#### AbilityTargetType (UENUM)

```
EAbilityTargetType:
  SingleEntity    // player selects one entity (unit or building)
  TilePosition    // player selects a tile; effect applies to all valid targets within TargetRadius
  Self            // ability targets the caster; no player selection required
  AllInRadius     // fires on all valid targets within TargetRadius of caster; no player selection
```

#### AbilityTargetConstraint

```
FAbilityTargetConstraint {
  FactionStance:   "enemy" | "friendly" | "neutral" | "any"    // UENUM
  EntityTypes:     TArray<FName>    // "unit", "building", "world_object"; empty = any
  RequiredTags:    FGameplayTagContainer  // target must have ALL these tags
}
```

#### AbilityCost

```
FAbilityCost {
  AttributeId:  FName    // attribute to decrement on activation
  Amount:       float
}
```

If the caster does not have sufficient attribute value, the ability cannot be activated.

#### UAbilityAutocastCondition

```
// UCLASS(Abstract, Blueprintable) — UObject subclass.
// Create a Blueprint subclass in the Content Browser; assign the class reference to
// AbilityDefinition.AutocastConditionClass.
//
// UFUNCTION(BlueprintNativeEvent)
// bool ShouldAutocast(FName CasterUnitId, FName AbilityDefId) const;
//
// Called each tick when bAutocast = true. Return true to permit autocast firing
// (subject to cooldown and ResourceCosts). The TargetConstraint check runs first;
// ShouldAutocast is only called if a valid target already exists.
```

#### AbilityEffect

```
FAbilityEffect {
  Type: "deal_damage"
      | "apply_modifier"
      | "spawn_world_object"
      | "fire_event"
      | "heal"
      | "teleport_to_tile"    // UENUM

  // for deal_damage (see §20 for formula and damage type details):
  DamageAmount:        float        // base damage before defences; 0.0f = use scale only
  DamageScalesWith:    FName        // attribute id on caster to scale damage; NAME_None = flat only
  ScaleFactor:         float        // multiplier on DamageScalesWith value; default 1.0
  DamageType:          FName        // designer-defined type tag (e.g. "slash", "magic");
                                    // NAME_None = skip type-resistance lookup
  DamageFormulaId:     FName        // references a UDamageCalculation Blueprint asset (§20.3);
                                    // NAME_None = use base formula
  SkillGrants:         TArray<FAbilitySkillGrant>  // combat veterancy XP; see §21

  // for apply_modifier:
  ModifierTemplate:    TOptional<FModifierTemplate>

  // for spawn_world_object:
  SpawnResourceDefId:  FName
  SpawnQuantity:       int32
  SpawnAt:             FName        // "target" or "caster"; NAME_None = use SpawnTileCoord
  SpawnTileCoord:      TOptional<FIntPoint>

  // for fire_event:
  EventDefId:          FName        // NAME_None if unused

  // for heal:
  HealAmount:          float
  HealScalesWith:      FName        // NAME_None = flat heal only

  // for teleport_to_tile:
  Destination:         TOptional<FIntPoint>
}
```

#### FAbilitySkillGrant

Awarded to the **caster** when the `deal_damage` effect fires. Supports combat veterancy
patterns (soldiers levelling up from fighting).

```
FAbilitySkillGrant {
  SkillId:   FName
  XPAmount:  float
  Trigger:   EAbilitySkillGrantTrigger    // UENUM
}

// UENUM(BlueprintType)
EAbilitySkillGrantTrigger:
  OnHit    // XP granted on any successful damage application (including overkill)
  OnKill   // XP granted only when this effect reduces the target's health to 0
```

Multiple `FAbilitySkillGrant` entries may be declared on a single effect and are each
applied independently. XP is awarded before the level-up check fires (see §21.3), so a
single kill can trigger a level-up in the same tick.

### 18.2 Auto-Attack as an Ability

There is no separate generic attack mechanism. All attacks — including basic auto-attacks —
are abilities. Each unit type that can fight declares an **auto-attack ability**:

```
// Example auto-attack ability (illustrative)
AbilityDefinition {
  id:           "knight_basic_attack"
  targetType:   { type: "single_entity", constraints: { factionStance: "enemy",
                  entityTypes: ["unit", "building"], requiredTags: [] } }
  cooldown:     1.0 / effectiveAttackSpeed    // derived from "attackSpeed" attribute
  autocast:     true
  autocondition: <target is within attackRange and faction is hostile>
  effects: [
    { type: "deal_damage", damageAmount: null, damageScalesWith: "attackDamage" }
  ]
}
```

The `attackSpeed` attribute governs the cooldown of the unit's auto-attack ability.
`attackDamage` scales damage. Both are normal modifier targets. A unit with `autoEngages: true`
auto-casts its default attack ability on the selected target (using `targetSelectionPolicy`).
A unit with `fightsBack: true` auto-casts it specifically on its attacker.

### 18.3 Ability Grants

Units may gain additional abilities beyond their type definition through:
- **Equipment:** A resource's `ModifierTemplate` may reference an ability id to grant.
  A new field `grantsAbility: string | null` on `ModifierTemplate` records this.
- **Technology:** A `TechEffect` with `type: "grant_ability"` adds an ability to all
  current and future instances of a target definition.
- **Event actions:** `GRANT_ABILITY` event action adds an ability to a specific unit actor
  at runtime.

Granted abilities are tracked on `UnitActor.grantedAbilities: string[]` (ability def ids).
The unit's full ability set is `UnitTypeDefinition.abilities ∪ grantedAbilities`.

### 18.4 Building Abilities

Buildings may also declare abilities in their `BuildingDefinition`. Building abilities
follow the same `AbilityDefinition` structure. A tower that fires a special player-triggered
shot, or a shrine that casts a zone-wide buff, are both building abilities. Building abilities
are activated by player command (or autocast if configured). Buildings may also have passive
abilities (e.g. an aura building that continuously buffs nearby allies).

### 17.5 Passive Abilities

A passive ability has `activationType: "passive"`. It activates automatically when granted
to a unit or building (either at spawn via the unit type definition, or at runtime via
equipment/tech/event grant) and deactivates when revoked. It has no cooldown, no player
targeting, and no cost — it is always on for as long as it is held.

`PassiveEffect` defines what the passive does:

```
PassiveEffect =
    { type: "self_modifier"
      modifierTemplate: ModifierTemplate
      // Instantiates modifierTemplate on the bearer when the passive activates.
      // The modifier's duration is overridden to "indefinite" — the ability lifecycle
      // controls the modifier lifetime, not the timer. When the passive is revoked
      // (ability removed), the modifier is immediately removed from the stack.
      // Use this for always-on self-buffs: a knight ability that permanently adds
      // +10 armour while held, removed if the ability is revoked by an event.
    }

  | { type: "aura"
      radius:           float                   // tile radius around the bearer
      constraints:      AbilityTargetConstraint // which entities the aura affects
      modifierTemplate: ModifierTemplate
      updateInterval:   float                   // seconds between aura re-evaluations
                                                // (0.5 is a typical default; 0 = every tick)
      // On each update:
      //   1. Find all entities within radius satisfying constraints.
      //   2. Apply modifierTemplate (sourceId = this ability's id) to newly in-range entities.
      //   3. Remove the modifier (by sourceId) from newly out-of-range entities.
      // The modifier duration on the template is ignored — the aura manages lifetime directly.
      // Use this for proximity buffs/debuffs: a banner unit that grants +15% attackDamage
      // to all friendly units within 5 tiles.
    }

  | { type: "script"
      script:           PassiveScript
      updateInterval:   float    // seconds between evaluations; 0 = every tick
      // Executes script on each interval. The script has access to:
      //   self  — the bearer unit or building actor
      //   world — read-only world state queries (same query set as other scripted contexts)
      // Available actions within the script:
      //   applyModifier(entityId, modifierTemplate)
      //   removeModifier(entityId, sourceId)
      //   fireEvent(eventDefId)
      //   spawnObject(resourceDefId, quantity, position)
      // Use this for passives with conditional or stateful logic that cannot be expressed
      // as a flat aura: a passive that applies a different modifier depending on the
      // bearer's current health percentage, or one that only auras allies that have a
      // specific tag.
    }
```

**Passive ability lifecycle:**

| Event | What happens |
|---|---|
| Passive granted (spawn / equipment / tech / `GRANT_ABILITY`) | `PassiveEffect` activates immediately |
| Bearer moves (aura) | Aura re-evaluated on next `updateInterval` tick |
| Passive revoked (`REVOKE_ABILITY` / equipment unequipped / modifier expired) | All effects applied by this passive are immediately removed (modifiers removed by sourceId = ability id) |
| Bearer dies | All passive effects deactivate with the unit; no cleanup needed |

**`REVOKE_ABILITY` event action:** Removes a granted ability from a specific entity, triggering
passive deactivation. Added to the event action table alongside `GRANT_ABILITY`.

**Example — Banner Carrier aura:**
```
AbilityDefinition {
  id:             "banner_carrier_aura"
  activationType: "passive"
  passiveEffect: {
    type:             "aura"
    radius:           5.0
    constraints:      { factionStance: "friendly", entityTypes: ["unit"], requiredTags: [] }
    modifierTemplate: { attributeTarget: "attackDamage", operation: "multiplicative",
                        value: 0.15, duration: "indefinite", tags: ["banner_aura"] }
    updateInterval:   0.5
  }
}
```

**Example — Veteran passive (self-modifier):**
```
AbilityDefinition {
  id:             "veteran_toughness"
  activationType: "passive"
  passiveEffect: {
    type:             "self_modifier"
    modifierTemplate: { attributeTarget: "armour", operation: "additive",
                        value: 5.0, duration: "indefinite", tags: ["veteran"] }
  }
}
```

---

## 20. Combat & Damage Types

### 20.1 Damage Types

Damage types are designer-defined `FName` identifiers (e.g. `"slash"`, `"pierce"`,
`"blunt"`, `"fire"`, `"magic"`, `"siege"`). They are not an enum — designers declare
whatever types their game requires. Each `AbilityEffect` of type `"deal_damage"` declares
a `DamageType` (§18.1).

A target entity's resistance to a damage type is a **custom attribute** (§13.2) following
the naming convention `"resist_<damageType>"`. Examples:

| Attribute | Effect |
|---|---|
| `resist_slash: 0.25` | 25% damage reduction from slashing attacks |
| `resist_magic: 0.5` | 50% reduction from magical damage |
| `resist_siege: -0.5` | 50% increased vulnerability to siege damage |

Resistances are declared on unit type definitions and are normal modifier targets —
equipment, techs, and applied ability effects can alter them at runtime.

If no `resist_<damageType>` attribute exists on a target, resistance defaults to `0.0`
(no effect). This means newly added damage types are automatically neutral against units
that haven't declared resistance, requiring no changes to existing unit definitions.

### 20.2 Base Damage Formula

Applied when `AbilityEffect.DamageFormulaId` is `NAME_None`:

```
// 1. Raw damage (before defences)
rawDamage = effect.DamageAmount
          + getEffectiveAttribute(attacker, effect.DamageScalesWith) * effect.ScaleFactor

// 2. Flat soak (armour)
armourSoak   = max(0, getEffectiveAttribute(target, "armour"))
soakedDamage = max(0, rawDamage - armourSoak)

// 3. Type resistance (proportional; clamp prevents >100% or >200% damage)
resistance  = getEffectiveAttribute(target, "resist_" + effect.DamageType, default=0.0)
finalDamage = soakedDamage * (1.0 - clamp(resistance, -1.0, 1.0))

target.currentHealth -= max(0, finalDamage)
```

`armour` provides flat absorption applied first. Type resistance then applies proportionally
to the remainder. Negative resistance (vulnerability) amplifies damage up to 2× at `−1.0`.

### 20.3 Custom Damage Formulas

Abilities that need different calculation logic set `DamageFormulaId` to the `Id` of a
`UDamageCalculation` Blueprint asset. The engine instantiates the class and calls
`Calculate` in place of the base formula.

```
// UCLASS(Abstract, Blueprintable) — UObject subclass.
// Create a Blueprint subclass in the Content Browser; give it an Id; reference that Id
// in AbilityEffect.DamageFormulaId.
//
// UFUNCTION(BlueprintNativeEvent)
// float Calculate(FDamageCalculationContext Context) const;

FDamageCalculationContext {
  AttackerId:    FName
  TargetId:      FName
  AbilityDefId:  FName
  DamageType:    FName
  RawDamage:     float    // pre-computed from DamageAmount + scale; convenience value
  // UBastionQueryLibrary::GetEffectiveAttribute is available inside Blueprint
}
```

`Calculate` returns the final damage applied directly — **no armour or resistance is
applied automatically** when a custom formula is active. The Blueprint override is
responsible for all defensive calculations it wants to include.

**Common override patterns:**

| Pattern | Description |
|---|---|
| Siege weapon | Bypasses armour against buildings; applies armour normally against units |
| Magic bypass | Skips `armour`; applies only `resist_magic` |
| % health damage | `return target.currentHealth * 0.25` — ignores all flat defences |
| Armour-piercing | Subtracts only a fraction of full armour: `soaked = rawDamage - (armour * 0.5)` |

### 20.4 Armour Convention

`armour` is a core attribute (§13.1), floor `0.0`. Suggested baseline values:

| Tier | Example units | `armour` range |
|---|---|---|
| Unarmoured | Farmers, monks, peasants | 0 |
| Light | Archers, militia | 5–15 |
| Medium | Men-at-arms, sergeants | 20–40 |
| Heavy | Knights, halberdiers | 50–80 |
| Fortified | Siege engines, towers | 100–300 |

These are authoring guidelines, not enforced ranges. A heavily armoured unit that fully
absorbs a weak weapon's damage is working as intended — designers tune `attackDamage` and
`armour` values together to achieve the desired matchup results.

---

## 21. Skill System (Veterancy)

Units improve at specific jobs by performing them. Each **skill** tracks experience points
(XP) and a level derived from XP thresholds. Skill levels influence task step output and
unlock ability preconditions — they are designer-referenced, not hardcoded effects.

### 21.1 Skill Definition

```
FSkillDefinition {
  Id:               FName            // e.g. "fletching", "swordplay", "farming"
  DisplayName:      FString
  XPAttributeId:    FName            // convention: Id + "XP" → "fletchingXP"
  LevelAttributeId: FName            // convention: Id + "Level" → "fletchingLevel"
  LevelThresholds:  TArray<float>    // XP required to reach each successive level;
                                     // index 0 → level 1, index 1 → level 2, ...
  MaxLevel:         int32
  LevelTags:        TArray<FSkillLevelTag>
}

FSkillLevelTag {
  Level: int32    // level at which this tag is granted (retained at all higher levels)
  Tag:   FName
}
```

`SkillDefinition` assets are authored globally alongside `TileDefinition` and
`ResourceDefinition`. Skill XP and Level are represented as custom attributes on the unit
(§13.2) and participate in the full modifier stack — equipment and techs may grant bonus
levels or XP multipliers via standard `FModifier` entries.

### 21.2 Unit Type Skill Declarations

See §6.3. At spawn, the unit's attribute set is initialized with `XPAttributeId: 0.0` and
`LevelAttributeId: InitialLevel` for each declared skill.

### 21.3 XP Grants on Step Completion

`FWorkStepDefinition` carries `SkillGrants` (see [Buildings/Jobs §5.3](BUILDINGS_JOBS.md)).
XP is added to the executing unit's `XPAttributeId` when the step **completes**. Cancelled
or interrupted steps grant no XP.

**Level-up processing (same tick as XP grant):**

1. If new XP total ≥ `LevelThresholds[currentLevel]`: increment `LevelAttributeId`, subtract
   the threshold (leaving excess XP carried forward), repeat for the next threshold.
2. Apply any `LevelTags` for levels reached by instantiating a permanent `FModifier`
   (`duration: -1.0`, `grantsTag: tag`, `sourceId: "<skillId>_level<N>"`).
3. Fire `on_skill_level_up` event hook.

### 21.4 Skill-Scaled Step Output

`GENERATE_RESOURCE` and `TRANSFORM_RESOURCE` step vars support an optional `OutputScaling`
field (see [Buildings/Jobs §5.5](BUILDINGS_JOBS.md)):

```
FSkillScaling {
  SkillId:        FName
  BaseMultiplier: float    // multiplier at level 0 (e.g. 1.0)
  PerLevelBonus:  float    // additive bonus per level (e.g. 0.1 = +10% per level)
}
// effectiveMultiplier = BaseMultiplier + (currentLevel × PerLevelBonus)
// output quantity      = floor(declaredQuantity × effectiveMultiplier)
```

### 21.5 Skill Preconditions

`FStepPrecondition` type `"skill_min_level"` (see [Buildings/Jobs §5.4](BUILDINGS_JOBS.md))
enables steps that require a minimum skill level to execute — "master-tier recipe" patterns.

### 21.6 Tag Integration

`LevelTags` integrate fully with the existing tag system. Tags granted by skill level appear
in `hasEntityTag` queries and are usable everywhere tags are consumed:

- `WorkerRequirement.TagRequirements` — "this step requires a MASTER_FLETCHER"
- `AbilityTargetConstraint.RequiredTags` — "this ability only targets VETERAN units"
- `EventFilter` — "fire this event only when a MASTER unit dies"

Tags granted by skill are permanent for the session and append-only — levels and XP only
increase. There is no level-loss mechanic.

### 21.7 Example — Fletcher Veterancy

```
// Skill Definition
FSkillDefinition {
  id:               "fletching"
  xpAttributeId:    "fletchingXP"
  levelAttributeId: "fletchingLevel"
  levelThresholds:  [100.0, 300.0, 700.0, 1500.0]    // 4 levels
  maxLevel:         4
  levelTags: [
    { level: 2, tag: "JOURNEYMAN_FLETCHER" },
    { level: 4, tag: "MASTER_FLETCHER"     }
  ]
}

// Unit Type Definition (excerpt)
UnitTypeDefinition {
  id:     "fletcher"
  skills: [ { skillId: "fletching", initialLevel: 0 } ]
}

// Work Step — Fletch Arrows (in Fletcher Workshop building)
FWorkStepDefinition {
  id:           "fletch_arrows"
  type:         TRANSFORM_RESOURCE
  skillGrants:  [ { skillId: "fletching", xpAmount: 10.0 } ]
  vars: {
    inputs:        [ { resourceDefId: "feathers", quantity: 3 },
                     { resourceDefId: "wood",     quantity: 1 } ],
    outputs:       [ { resourceDefId: "arrow",    quantity: 5 } ],
    outputScaling: { skillId: "fletching", baseMultiplier: 1.0, perLevelBonus: 0.2 }
  }
}
// Level 0: 5 arrows. Level 2: floor(5 × 1.4) = 7. Level 4: floor(5 × 1.8) = 9.
// A "royal longbow" step may additionally gate on tagRequirements: ["MASTER_FLETCHER"].
```

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
- **Units never block tiles.** `TileInstance.occupantId` is only set by buildings. Units
  overlap tiles and each other freely.
- **Unit presence is a gate, not a trigger.** A step with `workerRequirements` blocks until
  all required workers are present. Dispatch is driven by the unit's job selection loop.
- **Tag resolution is always live.** `hasEntityTag` checks Definition tags and all active
  modifier-granted tags. Tags disappear when their granting modifier expires or is removed.
- **Units are exclusively assigned.** One building per unit at a time. Removal mid-step
  cancels the step with no resource refund. Carried resources remain on the unit.
- **All attacks are abilities.** There is no separate generic attack path. Auto-attack,
  retaliation, and special abilities all flow through the `AbilityDefinition` system.
- **Abilities do not require attributes.** Attribute references in effects are optional.
  When present, they read `getEffectiveAttribute` at fire time — modifier stack changes
  automatically propagate. Flat-value-only abilities are equally valid.
- **Passive abilities are always-on and lifecycle-managed.** They activate on grant and
  deactivate on revoke. Self-modifier, aura, and script variants are provided. The passive
  manages modifier lifetimes directly — no duration timer is needed.
- **Enemy determination is faction-based.** `ownerId` → `factionId` → `FactionRelationship.stance`.
  "Enemy" means `stance: "hostile"`. All relationship configuration is in `FactionDefinition`.
- **Core attribute floors are hardcoded.** `maxHealth ≥ 1`, `armour ≥ 0`,
  `movementSpeed ≥ 0`, etc. Custom attributes clamp to designer-specified `minValue`/`maxValue`.
- **Equipment is the sole mechanism for stat and capability modification.** There are no
  separate upgrade or patch structures. All changes — permanent or timed, unit or building —
  flow through the modifier stack and equipment system.
- **Damage types are designer-defined FNames.** There is no hardcoded damage type enum.
  Resistances are custom attributes following the `"resist_<type>"` naming convention.
  The base formula handles armour soak then type resistance; per-ability formula overrides
  replace the base formula entirely.
- **Skill levels and XP are custom attributes.** They participate in the full modifier
  stack — equipment and techs can grant bonus levels. Tags granted by skill level are
  permanent and append-only. Skill XP grants happen on step completion only.
- **Building upgrades are demolish-and-replace.** There is no in-place building tier
  upgrade. Buildings improve within their type via equipment (removable: false) and
  adjacency bonuses (§23). A tier change requires demolition and placement of a new
  building definition.
