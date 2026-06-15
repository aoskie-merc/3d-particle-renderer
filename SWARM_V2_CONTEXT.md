# Swarm V2 — Handoff Context

> **Purpose of this file**: Onboard a new AI chat session (or human collaborator) to continue work on the `swarm-v2` branch with zero prior context. Read this fully before touching any code.

---

## Project

| Property | Value |
|---|---|
| **Local path** | `/Users/alexoskie/3d-particle-tool` |
| **Git branch** | `swarm-v2` |
| **Dev server** | `yarn dev` → `http://localhost:5173` |
| **Typecheck** | `npx tsc --noEmit` (no dedicated script in `package.json`; build script is `tsc -b && vite build`) |
| **Stack** | React 19 + Vite 8 + TypeScript 6 + React Three Fiber (`@react-three/fiber` v9, `@react-three/drei` v10) + Three.js v0.184 |

### Running it

```bash
cd /Users/alexoskie/3d-particle-tool
yarn dev
# → http://localhost:5173
```

The dev server serves `src/main.tsx` which now renders `AppV2` (the new system). The old `App.tsx` still exists but is no longer the entry point.

---

## What This Is

A **standalone 3D particle animation prototype** that visualises a sculptural figure (the Winged Victory of Samothrace) using a swarm of particles. Built in this isolated Vite app first; will eventually be embedded in the Mercury onboarding flow (`mercury-web` repo, separate codebase at `/Users/alexoskie/mercury-web`).

The animation is designed to play automatically on a page load / button click in Mercury. Users see particles emerge from nowhere, form geometric shapes, then gradually resolve into the figure of the statue — a reveal that implies the brand has "substance beneath the surface."

### STL Model

```
/Users/alexoskie/Dropbox/Career : Work/Mercury/Portfolio/3D Particlizer/Stl Sculptures/Winged Victory of Samothrace STL - Louvre Paris.stl
```

This file is **served at runtime as `/model.stl`** — it must be symlinked or copied into the `public/` folder of the Vite project for the fetch to work. The app fetches it via:

```ts
loadStaticModel("/model.stl")  // src/utils/meshIngest.ts
```

If `/model.stl` is missing from `public/`, the canvas will stay blank (no error thrown to the user). Always verify the symlink exists:

```bash
ls /Users/alexoskie/3d-particle-tool/public/model.stl
```

---

## The 6-Beat Animation

Each "beat" is a named phase of the animation. The user (or dev) can jump to any beat instantly via the left-panel stepper, or play the full sequence with the Play button. Beat numbers map to `TBeat = 1 | 2 | 3 | 4 | 5 | 6`.

### Beat 1 — Swirl (default 8 s)

**What the user sees**: Particles are dispersed in 3D space, performing an emergent murmuration — organic flocking motion with splitting/merging clusters and swirling vortices. No recognisable shape. Feels alive and atmospheric.

**Physics mode**: Pure boid simulation (`lerpWeight = 0`).

**Boid preset**: `SWIRL_BOID_PARAMS`
- `homeSpringFactor = 0` — no pull toward any home position; particles roam freely
- Gentle centripetal attractor at `(0, 0.3, 0)` — keeps the swarm in-frame without collapsing it
- `attractorFactor = 0.0008` — weak enough that murmuration dynamics dominate
- `splitIntensity = 0.3` — periodic split pulses create the signature "two flocks splitting apart and re-merging" look
- `swirlStrength = 0.003` (overridable via UI slider)

**Skin (SkinParticleSystem)**: Hidden (`skinOpacity = 0`). The figure is not visible yet.

---

### Beat 2 — Form (default 10 s)

**What the user sees**: Particles smoothly converge from their dispersed positions onto the surface of a **sphere** or **cube** (user-selectable). The shape emerges cleanly over a few seconds. No jitter, no fighting forces — just a deterministic, fluid collapse.

**Physics mode**: Pure lerp (`lerpWeight = 1`). Zero boid computation.

**Lerp parameters**:
- `lerpSpeed = 1.5` → exponential decay: `alpha = 1 - exp(-1.5 * dt)` per frame
- At 60 fps, particles are ~90% of the way to target after ~1.5 s
- Velocity is damped by `1 - lerpWeight * 0.55 = 0.45` each frame, suppressing any residual boid momentum

**Targets**: Each particle is assigned a point on the **Fibonacci sphere** (radius 0.8 world units) or a random point on the 6 faces of a **unit cube** (side 1.2 world units). Targets are computed once when geometry loads (and regenerated if particle count changes).

**Skin**: Still hidden.

---

### Beat 3 — Hint (default 8 s)

**What the user sees**: The geometric shape (sphere/cube) remains, but particles begin a very subtle drift. If you look carefully, the silhouette is slightly asymmetric — it's no longer a perfect sphere/cube. The figure is ghosting through.

**Physics mode**: Pure lerp (`lerpWeight = 1`), `lerpSpeed = 0.8` (slower than Beat 2 — the drift is unhurried).

**Targets**: A static blend per particle — `target = shape_target × 0.85 + home_position × 0.15`. This means each particle is assigned a point 85% of the way toward its Beat 2 shape position and 15% toward its model surface home. The shape is intact but the geometry is subtly pulled toward the figure underneath.

**Skin**: Still hidden.

---

### Beat 4 — Reveal (default 10 s)

**What the user sees**: Particles deterministically converge onto the model surface. The figure of the statue materialises. Simultaneously, the **proximity shader activates** on the skin particle layer — the dense static surface coating of the figure becomes visible only where the swarm is nearby. As the swarm arrives, the skin "lights up" beneath it.

**Physics mode**: Pure lerp (`lerpWeight = 1`), `lerpSpeed = 2.0` (fastest lerp — the reveal feels decisive).

**Targets**: Each particle's model surface home position (`homeX/homeY/homeZ`).

**Skin**:
- `skinOpacity = 0.3`
- `proximityMode = true`
- `proximityRadius = 0.5` world units
- As particles arrive at the surface, the centroid of the swarm tracks them; skin near the centroid becomes visible

---

### Beat 5 — Dance (default 12 s)

**What the user sees**: Particles are now on the figure's surface but stop lerping — the boid simulation takes over. The swarm performs a slow organic murmuration *around* the figure. Most particles stay close to the surface (weak home spring), but some occasionally drift away and orbit before returning. The skin proximity reveal is still active, so the figure pulses with life.

**Physics mode**: Pure boid simulation (`lerpWeight = 0`).

**Boid preset**: `DANCE_BOID_PARAMS`
- `homeSpringFactor = 0.0001` — very gentle pull back to model surface, keeps most particles near the figure without dominating
- `attractorFactor = 0.0003` — uses the default Lissajous orbit attractor (no override), so the swarm slowly sweeps across the figure
- `swirlStrength = 0.004` (overridable via UI)
- `splitIntensity = 0.25` — periodic splits keep the motion interesting

**Transition in**: When entering Beat 5 from Beat 4 (lerp → boid), `kickstartVelocities()` is called to give particles a small random velocity impulse, preventing the swarm from being frozen after the lerp damp.

**Skin**:
- `skinOpacity = 0.25`
- `proximityMode = true`

---

### Beat 6 — Approved (default 12 s)

**What the user sees**: Particles settle onto the model surface and stay there. Full skin becomes gently visible. The figure is "complete." Steady, calm.

**Physics mode**: Pure lerp (`lerpWeight = 1`), `lerpSpeed = 1.2`. Targets = model surface homes.

**Skin**:
- `skinOpacity = 0.3`
- `proximityMode = false` — full skin always visible, no proximity gating

**Note**: The name "Approved" comes from the Mercury onboarding use case — this beat plays when a user's application is approved.

---

## Architecture

### Overview

```
AppV2.tsx                    ← UI shell (beat stepper, scrubber, settings panel)
  └─ Canvas                  ← R3F Canvas (full-screen)
       └─ SceneV2.tsx        ← Orchestrates simulation + rendering
            ├─ ParticleSystemV2.tsx    ← InstancedMesh renderer
            └─ SkinParticleSystem.tsx  ← Static surface point cloud (existing)

src/sim/
  ├─ particleSimV2.ts        ← Core simulation logic (new)
  ├─ boids3d.ts              ← Existing 3D boid engine (unchanged, reused)
  ├─ boidParams.ts           ← Existing IBoidParams interface + BOID_DEFAULTS
  └─ boids2d.ts              ← Existing (unused by swarm-v2, ignore)
```

### The "No Force Conflicts" Principle

The root cause of jitter/ring/comet artifacts in the old system (`App.tsx`) was **multiple force systems active simultaneously**: `homeSpring` + `attractor` + `cohesion` + `separation` all running at once and fighting each other.

**The fix**: at any given moment, exactly **one** force system drives particle motion.

This is implemented via a single scalar `lerpWeight` (0–1) in `particleSimV2.ts`:

```typescript
// In stepParticlesV2():
if (lerpWeight < 0.99) {
  stepBoids(particles, boidParams, elapsed);  // boid forces run
}
if (lerpWeight > 0.01) {
  // frame-rate-independent exponential lerp
  const alpha = (1 - Math.exp(-lerpSpeed * dt)) * lerpWeight;
  for each particle:
    p.x += (p.targetX - p.x) * alpha;
    // also damp velocity: p.vx *= (1 - lerpWeight * 0.55)
}
```

**At `lerpWeight = 1`**: Boid step is completely skipped. Particles move purely by lerp. Velocity is damped toward zero each frame. Zero force conflicts.

**At `lerpWeight = 0`**: Lerp is completely skipped. Pure boid simulation runs. Home spring, attractor, cohesion, separation all work without interference.

**During a 500ms beat transition**: `lerpWeight` glides linearly between the outgoing and incoming beat's target weight. Both systems may partially run, but this is brief and intentional — the visual result is a smooth crossfade, not jitter.

### Beat Transitions

`SceneV2` maintains a `transitionRef` describing the current interpolation:

```typescript
interface ITransitionState {
  active: boolean;
  fromLerpWeight: number;
  toLerpWeight: number;
  startTime: number;   // set on first useFrame tick after beat change
  toBeat: TBeat;
}
```

When a beat changes (via `useEffect` on the `beat` prop):
1. Target positions are immediately set for all particles (`setTargetsForBeat`)
2. If transitioning from lerp → boid, `kickstartVelocities()` seeds non-zero velocities
3. `transitionRef.active = true`; `useFrame` advances `lerpWeightRef.current` over 500ms

### Particle Data Structure

`IParticleV2` extends `IBoidParticle` (from `boids3d.ts`) with three extra fields:

```typescript
interface IParticleV2 extends IBoidParticle {
  targetX: number;   // current lerp destination X
  targetY: number;   // current lerp destination Y
  targetZ: number;   // current lerp destination Z
}
```

`IBoidParticle` fields of note:
- `homeX/homeY/homeZ` — model surface position (set once when geometry loads, never changes)
- `x/y/z` — current world position (mutated every frame)
- `vx/vy/vz` — current velocity (mutated every frame)

The key distinction: `homeX/Y/Z` = where the particle "belongs" on the model (permanent). `targetX/Y/Z` = where the lerp is currently pulling it (changes per beat).

### Rendering Pattern

`SceneV2` uses **state-gated rendering** to prevent mounting Three.js objects before geometry loads:

```typescript
const [skinGeometry, setSkinGeometry] = useState<BufferGeometry | null>(null);
const [particleCount_ready, setParticleCountReady] = useState(0);
// These are set inside the async loadStaticModel().then() callback
// React re-renders when they become non-null/non-zero
```

`ParticleSystemV2` receives `particles: IParticleV2[]` — the **same array object** throughout the component's life. `SceneV2.useFrame` mutates particle positions in-place; `ParticleSystemV2.useFrame` reads from the same array and updates `instanceMatrix`. No prop changes, no re-renders, no allocation — just pointer sharing.

### Existing Code Reused (Unchanged)

| File | Role in swarm-v2 |
|---|---|
| `src/sim/boids3d.ts` | Full 3D boid engine with spatial hash grid, used as-is |
| `src/sim/boidParams.ts` | `IBoidParams` interface + `BOID_DEFAULTS`, imported by `particleSimV2.ts` |
| `src/components/SkinParticleSystem.tsx` | Dense static surface particle cloud with depth/normal/proximity shader |
| `src/utils/surfaceSampler.ts` | `sampleMeshSurface()` — mesh surface sampling (area-weighted or random) |
| `src/utils/meshIngest.ts` | `loadStaticModel("/model.stl")` — fetches + parses STL |
| `src/utils/geometryNormalize.ts` | `normalizeBoundingRadius()` — normalises STL to canonical 0.9 world-unit radius |

---

## New Files Created (swarm-v2)

| File | Description |
|---|---|
| `src/sim/particleSimV2.ts` | Core simulation: `IParticleV2`, boid presets, sphere/cube generators, `stepParticlesV2`, per-beat helpers |
| `src/components/ParticleSystemV2.tsx` | InstancedMesh renderer; reads mutated `IParticleV2[]` each frame via `useFrame` |
| `src/components/SceneV2.tsx` | Self-loading R3F scene; owns particle sim state; drives beat transitions; renders both particle systems |
| `src/AppV2.tsx` | Full UI: 6-beat stepper, timeline scrubber with play/pause, collapsible settings panel |
| `src/AppV2.module.css` | CSS Module styling; dark `#0a0a0f` background, amber `#c8a96e` accent, no inline styles |

## Modified Files

| File | Change |
|---|---|
| `src/main.tsx` | Entry point now renders `AppV2` instead of `App`; removed Mercury-specific CSS imports |

## Unchanged / Not Touched

`App.tsx`, `Scene.tsx`, `ParticleSystem.tsx`, and all other existing files are **untouched**. They still compile but are no longer the active entry point.

---

## Key Design Decisions

### 1. `lerpWeight` gates two mutually exclusive systems

Rather than blending forces, `lerpWeight` acts as a binary switch with a smooth transition window. The thresholds `< 0.99` and `> 0.01` mean in steady state (beats 1, 5 = pure boid; beats 2, 3, 4, 6 = pure lerp) only one code path executes per frame. No wasted computation; zero interference.

### 2. Exponential lerp for frame-rate independence

```ts
const alpha = 1 - Math.exp(-lerpSpeed * dt);
```

This is the correct frame-rate-independent formulation. At 60 fps (`dt ≈ 0.0167`): `lerpSpeed = 1.5` → `alpha ≈ 0.025`. At 30 fps (`dt ≈ 0.033`): same `alpha = 0.049`. The particle arrives at the target in the same wall-clock time regardless of frame rate. **Do not replace with `lerpSpeed * dt` directly** — that is frame-rate dependent and will cause slower/faster animations on different hardware.

### 3. Beat 3 target = static weighted blend

Beat 3 (Hint) targets are set **once** when entering the beat, not recalculated per frame:

```ts
p.targetX = shapeTargets[o] * 0.85 + p.homeX * 0.15;
```

This is intentional: the hint is a fixed destination, not a live interpolation between two force systems. The lerp simply moves the particle there slowly (`lerpSpeed = 0.8`). Clean, predictable, no artifacts.

### 4. `homeSpringFactor = 0` in Beat 1

In the boid engine (`boids3d.ts`), `homeSpringFactor > 0.003` triggers "direct seek" mode (overrides all other forces — sets velocity directly toward home). `homeSpringFactor ∈ (0, 0.003]` applies a gentle spring. `homeSpringFactor = 0` disables home spring entirely.

Beat 1 uses `homeSpringFactor = 0` so particles are **completely free** to murmur — no gravitational pull back to the model surface. The only positional constraint is the weak attractor at `(0, 0.3, 0)`.

### 5. `kickstartVelocities` on lerp → boid transitions

During lerp beats, velocity is damped by `(1 - lerpWeight * 0.55)` every frame. By the time Beat 4 ends, particle velocities are near zero. If Beat 5 starts without intervention, the boid sim would produce correct forces but particles wouldn't move (zero initial velocity means separation/cohesion produce near-zero deltas). `kickstartVelocities()` injects a small random velocity to break the deadlock.

### 6. Cube targets use random face sampling

Beat 2's cube targets are re-randomised each time the cube mode is selected or particle count changes. This means the "cube" shape looks slightly different each time. This is intentional — a perfectly uniform grid would look mechanical. The random-per-face sampling gives an organic feel while still clearly reading as a cube.

### 7. Proximity shader gating per beat

`SkinParticleSystem` has two relevant uniforms: `skinOpacity` (base opacity) and `proximityMode` (bool). The combination per beat:

| Beat | `skinOpacity` | `proximityMode` | Effect |
|---|---|---|---|
| 1, 2, 3 | 0 | — | Skin invisible |
| 4 | 0.3 | true | Skin visible only near swarm centroid |
| 5 | 0.25 | true | Same — swarm is dancing on surface |
| 6 (Approved) | 0.3 | false | Full skin always visible |

### 8. State-driven rendering in SceneV2

`particlesRef.current` is a ref (not state), so mutating it doesn't re-render. But we need React to mount `ParticleSystemV2` once particles are ready. Solution: `useState(0)` for `particleCount_ready` — this is set to the actual count inside the `loadStaticModel().then()` callback, triggering a re-render that mounts the mesh.

### 9. InstancedMesh capacity

`PARTICLE_CAPACITY_V2 = 20_000` (in `ParticleSystemV2.tsx`). The InstancedMesh is created once at this capacity; `mesh.count` is set to the actual particle count. Changing `particleCount` from Sparse (2,000) to Dense (15,000) does not recreate the mesh — it just changes how many instances are drawn.

The `PARTICLE_CAPACITY = 65_536` from `surfaceSampler.ts` is the cap on mesh surface sampling, not the swarm renderer cap.

---

## Current State

### What's Working ✓

- Full 6-beat animation system with clean transitions
- Beat stepper (click any beat to jump instantly)
- Play/pause with timeline scrubber
- Particle density presets (Sparse/Medium/Dense) with live rebuild
- Beat 2 shape toggle (sphere/cube) — live-reapplied if already on Beat 2/3
- Physics sliders: particle size, opacity, swirl strength
- Per-beat duration sliders (Beat 1–6 individually configurable)
- Proximity reveal on Beat 4/5, full skin on Beat 6
- STL model loading from `/model.stl` (public folder)
- TypeScript: zero errors (`npx tsc --noEmit` exits 0)
- Camera: `OrbitControls` (mouse drag to orbit, scroll to zoom, pan disabled)

### Known Gaps / Not Yet Tuned

- **Visual tuning**: The boid params in `SWIRL_BOID_PARAMS` and `DANCE_BOID_PARAMS` are reasonable starting points but likely need iteration. In particular:
  - Beat 1: the swirl may feel too tight or too loose depending on camera distance; `swirlStrength` and `attractorFactor` are the main knobs
  - Beat 5: `homeSpringFactor = 0.0001` may keep particles too close to the model (boring) or too far (unrecognisable); tune upward toward 0.0003 if too loose
- **Beat 3 hint amount**: currently 15% toward home. May want 20–25% for a more visible "ghost" effect. Change `0.15` / `0.85` constants in `setTargetsForBeat`
- **Skin particle count**: hardcoded to `Math.min(80_000, PARTICLE_CAPACITY)` = 65,536 for the skin layer. This is very high and may be slow on integrated GPUs. Consider reducing to 40,000 or making it a settings slider
- **Beat 6 (Approved) boid settle**: currently Beat 6 is pure lerp (particles locked to home positions). An improvement would be: after lerp completes, switch to a very gentle boid mode with strong `homeSpringFactor` so particles have micro-movement while staying on the surface. This "alive settled" look is better than perfectly frozen particles
- **No play-from-scrub continuity**: when user drags scrubber to mid-sequence, particles jump to wherever they are (for boid beats) or partially-lerped position (for lerp beats). This is acceptable for now but could be improved by resetting particle state based on beat
- **No STL upload UI**: the old `App.tsx` had file drag-drop support via `meshIngest.ts`. `AppV2` does not — it's hardcoded to `/model.stl`. Planned future work
- **No Mercury integration yet**: the animation needs to be triggered by a specific UI event in `mercury-web`. Integration approach TBD (likely an iframe, web component, or direct import)
- **Camera position**: the default camera (`[0, 0.5, 5]`) may need adjustment once real visual tuning is done — the statue's canonical radius is 0.9 world units, so `z=5` is ~5.5 radii away

---

## What To Work On Next

Ordered by priority:

### 1. Visual tuning (Beat 1 / Beat 5)

The boid parameters will need real iteration against the running dev server. Key levers:

| Beat | Param | File | What to try |
|---|---|---|---|
| 1 | `swirlStrength` | `particleSimV2.ts` → `SWIRL_BOID_PARAMS` | Increase to 0.005–0.008 for more dramatic vortex |
| 1 | `splitIntensity` | same | Decrease to 0.15 for smoother, increase to 0.5 for dramatic splits |
| 1 | `attractorFactor` | same | Increase if particles drift off-screen |
| 5 | `homeSpringFactor` | `DANCE_BOID_PARAMS` | Tune between 0.00005–0.0003 |
| 5 | `swirlStrength` | same | Governs how much particles orbit vs. stay in place |

The UI "Swirl strength" slider maps to `swirlStrength` for the current beat in `SceneV2`.

### 2. Beat 6 "alive settled" state

After lerp completes in Beat 6, add a secondary boid phase: the lerp weight transitions from 1 → 0 again over 2s with a `homeSpringFactor = 0.002` and `speedLimit = 0.003`. Particles then subtly flutter on the surface rather than freezing.

Implementation: add a `beat6Phase: 'lerp' | 'settle'` flag in `SceneV2`; transition to `settle` once particles are within 0.01 of their homes.

### 3. Camera choreography

The camera should move with the animation — tighter in Beat 1 (particles near camera feels immersive), pull back for Beat 2/3 (to see the whole geometric shape), push in for Beat 4 (intimate reveal). Use `useFrame` + a smooth `camera.position.lerp(target, 0.02)` driven by beat.

### 4. Background / atmosphere

The canvas background is flat `#0a0a0f`. Consider:
- Subtle depth fog (`<fog attach="fog" args={['#0a0a0f', 5, 20]} />`)
- Very faint ambient glow behind the figure in Beat 4+ (additive blended sprite)

### 5. STL upload fallback

Re-add the file drag-drop from the old `App.tsx` system. `ingestMeshFile()` in `meshIngest.ts` already handles STL/OBJ. Add a `<input type="file">` hidden button in the settings panel; when a file is loaded, call `ingestMeshFile`, pass the geometry to `SceneV2` as a prop override.

### 6. Mercury integration

When integrating into `mercury-web`:
- The animation likely triggers from a specific React event (e.g. form submit, approval callback)
- Options: (a) iframe pointing to `localhost:5173` in dev, or a deployed static build, (b) extract just the Three.js/R3F components into `mercury-web` as a component
- The `AnimPath` / trigger concept in the old `App.tsx` shows the hook point
- Consider extracting `SceneV2` + `AppV2` as a package or copying files into `mercury-web/src/components/ParticleAnimation/`

---

## Controls Reference

All controls live in the left panel of `AppV2`. Defaults are the initial values in `AppV2.tsx`.

### States Section

| Control | Type | Default | Effect |
|---|---|---|---|
| Beat buttons (1–✓) | Click | Beat 1 | Instantly jumps to that beat; stops playback |
| Timeline scrubber | Range 0–1 | 0 | Moves to any point in the sequence; stops playback |
| Play Full Sequence | Toggle | Paused | Animates normalizedTime from current → 1 at real-time speed |
| Beat marker bar | Visual only | — | Shows coloured segments proportional to beat durations; amber = active beat |

### Settings Section (collapsible)

| Control | Type | Default | Range | Effect |
|---|---|---|---|---|
| Beat 2 shape | Sphere / Cube | Sphere | — | Changes the geometric form target for Beat 2 and Beat 3. Live-updates if currently on Beat 2 or 3 |
| Particle density | Sparse / Medium / Dense | Medium | 2k / 6k / 15k | Rebuilds particle array + surface samples; triggers re-render |
| Particle size | Slider | 0.003 | 0.001–0.012 | Visual radius of each sphere instance (world units) |
| Opacity | Slider | 0.8 | 0.1–1.0 | Base opacity of swarm particles |
| Swirl strength | Slider | 0.003 | 0–0.012 | Overrides `swirlStrength` in boid params for the current beat |
| Beat durations (×6) | Slider each | See below | 2–30 s | Controls how long each beat plays during the sequence |

**Default beat durations**:
```
Beat 1: 8 s   Beat 2: 10 s   Beat 3: 8 s
Beat 4: 10 s  Beat 5: 12 s   Beat 6: 12 s
Total:  60 s
```

---

## Codebase Quick Reference

### Where things live

```
src/
├── sim/
│   ├── particleSimV2.ts    ← NEW: all new simulation logic
│   ├── boids3d.ts          ← existing boid engine (stepBoids, createBoidParticles, IBoidParticle)
│   ├── boidParams.ts       ← IBoidParams interface, BOID_DEFAULTS
│   └── boids2d.ts          ← (ignore, unused by swarm-v2)
│
├── components/
│   ├── ParticleSystemV2.tsx   ← NEW: InstancedMesh swarm renderer
│   ├── SceneV2.tsx            ← NEW: main R3F scene (simulation + render orchestration)
│   ├── SkinParticleSystem.tsx ← existing proximity-shader skin layer
│   ├── ParticleSystem.tsx     ← old swarm renderer (unused in swarm-v2)
│   ├── Scene.tsx              ← old scene (unused in swarm-v2)
│   └── ...                    ← other existing components (ignore)
│
├── utils/
│   ├── surfaceSampler.ts   ← sampleMeshSurface(), PARTICLE_CAPACITY = 65536
│   ├── meshIngest.ts       ← loadStaticModel("/model.stl"), ingestMeshFile()
│   └── geometryNormalize.ts← normalizeBoundingRadius() → canonical radius 0.9
│
├── AppV2.tsx               ← NEW: entry point UI
├── AppV2.module.css        ← NEW: UI styles
├── App.tsx                 ← old app (exists, not rendered)
├── main.tsx                ← MODIFIED: now renders AppV2
└── particleSettings.ts     ← old settings type (not used in swarm-v2)
```

### Critical constants

```typescript
// particleSimV2.ts
SWIRL_BOID_PARAMS      // Beat 1 boid preset
DANCE_BOID_PARAMS      // Beat 5 boid preset

// AppV2.tsx
DEFAULT_BEAT_DURATIONS // { 1: 8000, 2: 10000, 3: 8000, 4: 10000, 5: 12000, 6: 12000 }

// ParticleSystemV2.tsx
PARTICLE_CAPACITY_V2 = 20_000  // InstancedMesh max instances

// surfaceSampler.ts (existing)
PARTICLE_CAPACITY = 65_536     // max surface samples

// geometryNormalize.ts (existing)
CANONICAL_MESH_RADIUS = 0.9    // all loaded STLs are normalised to this bounding radius
```

---

## How to Start a New Chat

1. Open a new Cursor chat
2. Type: `@SWARM_V2_CONTEXT.md` (or drag the file in) to give the new session this context
3. Optionally also attach the files you're about to edit (e.g. `@src/sim/particleSimV2.ts`)
4. Say what you want to work on — the context here is sufficient to continue without re-reading all source files

If you want the new session to have full source context, also attach:
- `@src/sim/particleSimV2.ts` — the new simulation module
- `@src/components/SceneV2.tsx` — the new scene component
- `@src/components/ParticleSystemV2.tsx` — the renderer

---

*Last updated: swarm-v2 implementation session, June 2026.*
*All new files pass `npx tsc --noEmit` with zero errors.*
