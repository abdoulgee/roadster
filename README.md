# Drive Roadster

An endless highway stunt runner in the browser: dodge traffic, jump, hover, flip and boost,
chain tricks into streaks, grab power-ups and beat your best. Built with Three.js,
TypeScript and Vite. Every model, texture and sound is generated in code.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane / barrel roll in the air | ← → (A D) | Push the JUMP stick left / right (also while flying) · or swipe left / right anywhere |
| Jump · flip | ↑ / Space (W); press again in the air to flip | Touch the JUMP stick (or tap / swipe up anywhere); one flip happens on its own in the air, touch again for more |
| Fly | Hold ↑ / Space | Keep holding the JUMP stick |
| Slam down | ↓ (S) | Flick the JUMP stick down · or swipe down anywhere |
| Boost | Shift | Press and hold anywhere on the screen; slide while holding to change lane |
| Use item | Z (E) | ITEM, bottom left (shows the held item) |
| Pause · sound | P / Esc · M | Buttons |

Phones and tablets get the touch controls automatically (coarse pointer or no hover): ITEM on the
left, the JUMP analog stick on the right, and gestures anywhere else on the screen. Every finger is
tracked on its own, so the stick, gestures and ITEM all work together. A short guide shows the
controls at the start of each run. Tuning lives in `systems/input.ts` (`SWIPE_PX`, `HOLD_MS`,
`STILL_PX`), `ui/hud.ts` (`FLICK_PX`, `KNOB_TRAVEL` for the stick) and `style.css` (`--stick`,
`--tc-lift`). In dev, add `?touch` to the URL to force touch controls on a desktop. Portrait
screens use a higher, wider camera so the neighbouring lanes stay in view.

## Pilot name and online scores (optional)

On the first visit the menu asks for a pilot name (the pencil on the pilot card changes it).
There is no ranking screen, and the game-over panel doesn't show where a run places; runs are
still saved (on this device, or online once configured). To save scores online:

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql` and run it.
3. Copy `.env.example` to `.env.local` and fill in the project URL and anon key from
   **Project Settings → API**.
4. Restart `npm run dev` (or rebuild).

The tables have row-level security with no policies, so the browser can't read or write
them directly. All access goes through `SECURITY DEFINER` functions, which check each
player's secret and reject impossible runs. A run must be opened on the server, can't last
longer than the real time since it started, and its distance and score must be achievable
for that time. `supabase/test.sql` exercises all of this against a scratch database.

## How the code is organized

```
index.html            page shell: canvas, HUD, menus and the pilot-name dialog
src/
  main.ts             entry point: builds the Game, warms it up behind the loading screen, starts the loop
  game.ts             the conductor: game states, the per-frame loop, scoring, events, camera
  config.ts           ALL gameplay numbers (speeds, physics, air, points, traffic, items, powers)
  style.css           all HUD and menu styling
  entities/
    carModel.ts       the car-body engine: lofted bodies, glass, lights, wheels, thruster smoke
    cars/             one design per playable car (Roadster, Roadster Prototype, Model S/3/X/Y, Cybertruck) and the garage list
    player.ts         player physics and animation: lanes, jump, fly, flips, rolls, slam, crash
    traffic.ts        bot cars: spawning, movement, collisions, smashing, level of detail
    vehicleModels.ts  bot car 3D models (saloon, hatchback, taxi, SUV, bus, semi), procedurally lofted
    pickups.ts        air orbs ("coins"), item capsules, the golden star: spawning and animation
    pickupModels.ts   their 3D models: spinning air coins, faceted star, glass item capsules
  systems/
    input.ts          keyboard and touch → actions (left, jump, boost, item…)
    combo.ts          streak multiplier
    powers.ts         Starman / Rocket / Ludicrous timers, shield, rocket meter, item slot
  world/
    environment.ts    sky shader (clouds, stars, meteors), sun and lights, fog, sky reflections, zone ground, mountains, skyline
    road.ts           wet-capable asphalt, kerbs, studs, verges, guard rails, lamps, sign gantry, roadside props and landmarks
    props.ts          landmark props: billboards, windmills, water towers, cabins, neon blade signs (and their animation)
    scatter.ts        GPU-instanced ground cover per zone (cacti, shrubs, grass, flowers, salt crystals, tumbleweeds…)
    structures.ts     set pieces: Pine Ridge tunnel, desert overpass with traffic, city rail bridge with a train
    backdrop.ts       far landmarks and sky life: mesas, wind farm, searchlights, bird flocks, airliner
    bend.ts           the world bend (curves and hills ahead), patched into every material's vertex shader
    zoneField.ts      texture of zone weights along the road, so shaders cross-fade zones where the palette does
    glsl.ts           shared noise functions for the world shaders
    zones.ts          zone list (Sunset Highway → Salt Flats → Pine Ridge → Neon City) with palettes and props
  fx/
    post.ts           render pipeline: MSAA HDR, bloom, sun shafts, heat haze, aberration, grade, zone sweep
    weather.ts        rain in the city, dust and pollen motes elsewhere
    particles.ts      the particle engine (pooled glowing/smoky sprites)
    effects.ts        what particles to emit and when: dust, jet smoke, embers, sparks, rings
  audio/sfx.ts        every sound effect, synthesized with Web Audio (no audio files)
  audio/music.ts      the soundtrack: a synthwave loop sequenced live (pad, bass, drums, arpeggio)
  ui/
    hud.ts            score, air bar, combo meter, popups, item slot, power banner, game-over panel
    onlinePanels.ts   pilot-name dialog (first-visit welcome prompt and edit)
  online/             leaderboard backends (device-only / Supabase), callsigns, share links
  util/               math helpers and the seeded random generator
supabase/             database schema and tests for the online leaderboard
```

### What happens every frame

`Game.update()` in `src/game.ts` runs once per frame:

1. **Input**: read key presses and touches (`systems/input.ts`) and send them to the player:
   `steer()`, `pressJump()`, `slam()`, `useItem()`.
2. **Simulate** (`simulate()`):
   - Work out the speed from the distance (`SPEED_CURVE`) and any boost or power mode.
   - Move traffic (`traffic.update`) and pickups (`pickups.update`), and run the car's physics
     (`player.update`).
   - Scroll the road and scenery (`road.update`, `scatter.update`, `structures.update`).
   - Check collisions (`traffic.hit`), pickups (`pickups.collect`) and passes
     (`traffic.scorePasses`).
   - Turn the results into **events**, then points, popups, sounds and particles
     (`onPlayerEvent`, `onTrafficEvent`, `onPickup`, `onPowerEvent`).
3. **Present**: move the camera (`updateCamera`), update the sky and lighting for the current
   zone (`applyZone`), bend the road ahead and update the zone field, backdrop, weather and post
   grade (`updateWorld`), emit particles (`effects.update`) and set the engine sound (`sfx.update`).
4. **Render**: `renderFrame()` runs the post pipeline (`fx/post.ts`), not `renderer.render`.

Entities never award points or play sounds themselves. They report what happened (for example
`{ type: 'land', impact }` or `{ type: 'near', vehicle }`), and `game.ts` decides how to react.
So scoring, sounds and effects can be changed in one place.

### World conventions

| Thing | Convention |
| --- | --- |
| Units | 1 unit = 1 metre; time in seconds; speeds in m/s |
| Axes | **x** = left/right across lanes, **y** = up, **−z** = ahead of the car |
| Player | always at **z = 0**. The world (road, traffic, pickups, particles) moves toward **+z** |
| Lanes | 4 lanes, `LANE_WIDTH` 3.6 m; `laneX(i)` gives a lane's x (lanes 0–3, left to right) |
| Spawning | things appear around z = −300 (in the fog) and are removed once behind the camera (z > ~12–30) |
| Colors | hex numbers like `0xff3fa8` |

## Where to change things

**Start with `src/config.ts`.** Most gameplay changes are a number there: speeds, jump height,
air costs, points, traffic density, item frequency, power durations. Save the file and the dev
server reloads instantly.

### The player's cars (garage)

Seven cars, picked on the menu with the ◀ ▶ arrows either side of the orbiting car (or ← →); the choice is saved and the Roadster
(the 2026 reveal design, in Ano White with the rear wing) is the default. The red 2017 car is kept as the Roadster Prototype.
Each car is a design file in `src/entities/cars/`, turned into a 3D model by the body engine in
`src/entities/carModel.ts`.

| I want to… | Go to |
| --- | --- |
| Change a car's paint | `entities/cars/<car>.ts` → `paint` (colour, metalness, roughness, clear coat; `anisotropy` gives the Cybertruck its brushed steel) |
| Reshape a body | `cars/<car>.ts` → `P`: one curve per section control point along the car (z, metres, nose at -z): `width`, `sill`, `s1y`–`s3y` (sides), `by` (belt / fender line), `t1y`/`t2y`/`cy` (roof edge to centreline). `faceted: true` gives flat panels and hard creases; `crease` (an angle) gives straight panels with hard creases around the section but smooth curves along the car |
| Move windows, lights, trim | `cars/<car>.ts` → `greenhouse`, `windows` and `decals`: polygons in the body's (z, v) surface coordinates, where v runs from the sill (1.0) over the belt (1.68) to the roof centre (2.56) |
| Add one-off parts (spoiler, light bars, flares) | `cars/<car>.ts` → `extras()` |
| Wheels, rims, mirrors | `cars/<car>.ts` → `wheels` (radius, track, width, rim `style`: split, turbine, aero, cyber, blade) and `mirrors`; `glassTint` for coloured glass |
| Add a car | write a design in `cars/`, add its id to `CarId` in `carModel.ts` and to `CARS` in `cars/index.ts` |
| Change thruster smoke | `carModel.ts`: `plumeMaterial()` / `plumeGeometry()`; nozzle positions come from `thrustersFor()` |
| Change hitbox size | `entities/player.ts` → `setCar()` (from each car's real size, trimmed for long ones) |
| Change how it moves | `config.ts` → `PHYS` (gravity, jump height, max fly height, lane-change time, flip and roll time, slam speed) and `AIR` (costs and rewards) |
| Change animations (lean in turns, nose pitch, flip/roll spin) | `player.ts` → `updatePose()` |
| Change the crash tumble | `player.ts` → `crash()` (spin speeds) and `updateCrash()` (bounce) |
| Change the shield bubble | `player.ts`: `SHIELD_FRAGMENT` (hex cells, rim, energy pulses), `updateShield()` (pop-up and burst), `SHIELD_DEPLOY` / `SHIELD_BURST` |

**Using your own 3D model (.glb).** Load it inside `buildRoadster()` with Three.js's
`GLTFLoader` (`three/examples/jsm/loaders/GLTFLoader.js`) and add it to `root`. The model should
face **−z**, sit with its wheels at **y = 0**, and be about 4.4 m long. Put its wheel meshes in
the `wheels` array so they keep spinning. Put model files in `public/models/` and load them
from `/models/car.glb`.

### Bot cars (traffic)

Behaviour is in `src/entities/traffic.ts`; the 3D models are in `src/entities/vehicleModels.ts`:

| I want to… | Go to |
| --- | --- |
| Change car colors | `traffic.ts` → `CAR_COLORS`, `BUS_COLORS`, `CAB_COLORS`; trailer colours are `TRAILER_COLORS` in `vehicleModels.ts` |
| Change how a car looks | `vehicleModels.ts`: `passengerCar()` (saloon, hatchback, taxi), `suv()`, `bus()`, `semi()`. Bodies are lofted with `Builder.loft()` (side/top profiles + a `finish()` that picks paint, glass or trim per triangle); details are `Builder.box()` and `Builder.wheel()` |
| Change the level-of-detail swap distance | `traffic.ts` → `LOD_DISTANCE` |
| Change a vehicle's size or hitbox | `SPECS`: `len`, `w`, `h` (height also decides whether you can jump over or land on it) |
| Change how often each type appears | `spawnVehicle()`: the `weighted(...)` table (buses and semis get more common with distance) |
| Change traffic speed or density | `config.ts` → `TRAFFIC` (`speedRatio`, `rowTimeEasy`/`rowTimeHard`, `emptyRowEasy`/`emptyRowHard`, `difficultyDistance`) |
| Change spawn patterns | `spawnRow()`. Each row always keeps one lane open, next to the last open lane, so there is always a path |
| Change what happens when a car is smashed | `smash()` (launch speed and spin) and `updateSmashed()` (flight and bounce) |
| Change near-miss / clear rules | `scorePasses()`, plus `POINTS.nearMissClearance` in config |

**Adding a new vehicle type**, e.g. a pickup truck:

1. Add `'pickup'` to `VehicleKind`.
2. Add a `pickup:` entry to `SPECS` with its size and a `build` function.
3. Add a weight for it in `spawnVehicle()`.

### Air orbs ("coins"), items and the star

| I want to… | Go to |
| --- | --- |
| Change how the air coins look (size, metal, emblem, glow) | `entities/pickupModels.ts` → `drawCoinFace()`, `coinGeometry`, `coinMaterial`, `coinGlowMaterial` |
| Change orb patterns (line length, arcs, height) | `pickups.ts` → `spawnOrbLine()` |
| Change how often orbs, items or the star appear | `config.ts` → `PICKUPS` (`orbLineGap`, `itemGap`, `itemWeights`, `starFirst`, `starGap`) |
| Change what an orb or item gives you | `config.ts` → `PICKUPS`, `ROCKET_FILL`; the effects are applied in `game.ts` → `onPickup()` |
| Change item names, colors or icons | `pickups.ts` → `ITEM_STYLE` and `drawItemIcon()` |
| Change the floating item capsules or star | `pickupModels.ts` → `buildItemCapsule()` (glass bubble shader, ring, halo), one model function per item (`airCanModel()`, `heatShieldModel()`, …), `buildStar()` |
| Change bob and spin animation | `pickups.ts` → `animate()` |
| Change what Shockwave or Ludicrous do when used | `game.ts` → `useItem()`, `config.ts` → `SHOCKWAVE` |

**Adding a new item:** add it to `ItemKind` and `PICKUPS.itemWeights` (config), `ITEM_STYLE`
and `drawItemIcon()` (pickups.ts), then handle it in `game.ts` → `onPickup()` (instant effect)
or `useItem()` (stored, used with Z).

### Effects, smoke and particles

| I want to… | Go to |
| --- | --- |
| Change smoke/dust/spark colors | `fx/effects.ts`: `DUST`, `JET_SMOKE`, `JET_GLOW`, `EMBER`, `SPARK`, `WRECK_SMOKE` |
| Change continuous effects (tyre dust, hover-jet smoke, boost embers, wreck smoke, power trails) | `effects.ts` → `update()`. Each block has an emission rate (`dt * 70` = 70 per second) and an `emit({...})` call |
| Change one-off bursts | `effects.ts`: `landing()`, `nearMiss()`, `pickup()`, `smash()`, `shockwave()`, `crash()` |
| Change power-mode sparkle colors | `effects.ts` → `POWER_TRAIL` |
| Change speed lines | `effects.ts` → `SpeedLines` (count, length, spread) and the `intensity` line in `update()` |
| Change the particle engine (soft round sprites, max particle counts, fading near the camera) | `fx/particles.ts`. Counts are set where `Effects` creates `smoke` and `glow` |
| Change screen shake, the boost red edge or the crash black-and-white | shake: `this.shake` in `game.ts`; red edge: `#hud.boosting::after` in `style.css`; black-and-white: `#game.crashed` in `style.css` |

`emit({...})` options (from `fx/particles.ts`):

| Option | Meaning |
| --- | --- |
| `x, y, z` | where it spawns |
| `vx, vy, vz` | starting velocity (m/s); `spread` adds random ± velocity |
| `posJitter` | random ± offset of the spawn position |
| `size` → `sizeEnd` | size in metres at birth → at death |
| `life` | seconds it lives (±25% random) |
| `color`, `alpha` | color and starting opacity (fades out over its life) |
| `drag`, `gravity` | slow down over time; fall (positive gravity) |
| `count` | how many to emit at once |

Use the `smoke` system for soft clouds (normal blending) and `glow` for sparks and light
(additive blending: colors add up and glow).

### Power modes (Starman, Rocket, Ludicrous)

| I want to… | Go to |
| --- | --- |
| Duration, speed, score multiplier | `config.ts` → `POWERS`; protection after it ends: `POWER_GRACE` |
| Rocket meter charge rates | `config.ts` → `ROCKET_FILL` |
| Car glow during a power | `game.ts` → `POWER_GLOW` and `updatePowerGlow()` |
| Banner text and color | `ui/hud.ts` → `POWER_STYLE` |
| Rules (invincibility, rocket auto-launch, item slot) | `systems/powers.ts` |

### Scenery, zones, sky and lighting

| I want to… | Go to |
| --- | --- |
| Change a zone's colors, fog, sun, ground or length | `world/zones.ts` → `ZONES` (also cloud cover, stars, snow on the peaks, skyline, lamp glow and ambient light) |
| Add a new zone | add an entry to `ZONES` with a `props` kind, then build that prop in `road.ts` |
| Change palms, rocks, pines or skyscrapers | `world/road.ts`: `palmGeometry()`, `rockGeometry()`, `pineGeometry()`, `towerGeometry()`, `facadeMaterial()`, `buildProps()`; placement in `placeProp()` |
| Change road surface, markings, verges | `road.ts`: `roadTextures()` (colour + roughness), `vergeTexture()` |
| Change lamps, guard rails, sign gantries | `road.ts`: the `Road` constructor, `buildGantry()`; sign text is `SIGNS` |
| Change sky, clouds, stars, mountains, skyline | `world/environment.ts`: `SKY_FRAGMENT`, `ridgeGeometry()`, `ridgeMaterial()`, `buildSkyline()` |
| Change each zone's ground (sand ripples, salt crust, meadow, city paving) | `environment.ts` → `groundMaterial()` |
| Change ground cover (what grows where, how much, wind sway) | `world/scatter.ts` → the `kinds` list in the `Scatter` constructor (`count`, `near`/`far` from the road, `sway`) |
| Change landmarks (billboards, windmills, cabins, neon signs) or how often they appear | `world/props.ts` (models, ad text in `BOARDS`, sign words in `SIGN_WORDS`); odds per zone: `LANDMARKS` in `road.ts` |
| Change tunnels and bridges | `world/structures.ts`: `ZONE_KIND` (which zone gets which), `SPACING`, `TUNNEL_LEN` |
| Change mesas, wind farm, searchlights, birds, the airliner | `world/backdrop.ts` |
| Change rain or floating dust | `fx/weather.ts`; how much per zone: `rain` and `motes` in `ZONES` |

### Graphics: post effects, bend and wet roads

| I want to… | Go to |
| --- | --- |
| Bloom, sun shafts, heat haze, saturation per zone | `ZONES` palette: `bloom`, `rays`, `heat`, `saturation` |
| Change the post effects themselves (shafts, aberration, vignette, grain, zone sweep) | `fx/post.ts` → `GRADE_FRAGMENT`; bloom radius/threshold in the `Post` constructor; firefly cap `FIREFLY_CAP` |
| How much the road curves and climbs | `ZONES` palette: `curve`, `hills`; the wave shapes are in `game.ts` → `updateWorld()` |
| Wet roads, puddles and rain ripples | `ZONES` palette: `wet`; the shader is `roadMaterial()` in `road.ts` |
| Write a custom shader that bends with the world | include `<common>`, add `bendUniforms()` and apply `worldBend(mvPosition.z)` (see `backdrop.ts` searchlights) |

### Sound, camera, HUD and scoring

| I want to… | Go to |
| --- | --- |
| Change or add sounds | `audio/sfx.ts`: one method per sound (`jump()`, `crash()`, `orb()`…), built from `tone()` (oscillator sweep) and `burst()` (filtered noise). Engine and wind loops are in `update()` |
| Change the music (tempo, chords, parts, volume) | `audio/music.ts`: `BPM`, `CHORDS`, `playStep()` (which part plays on which sixteenth), `VOLUME`. Levels: 0 menu, 1 driving, 2 streak ×3+ or a power mode (set in `game.ts`) |
| Change the stunt sounds | `audio/sfx.ts` → `trick()`, `clear()`, `stunt()` |
| Change the camera (distance, height, field of view, banking) | `game.ts` → `updateCamera()`: a high chase view (`camPos` / `camLook`); `portrait` blends in the phone framing |
| Change the loading screen or warm-up | `index.html` (`#loading`), `main.ts`, `game.ts` → `prepare()` |
| Change HUD layout or menus | `index.html` (structure), `style.css` (look), `ui/hud.ts` (what updates) |
| Change points or the streak window | `config.ts` → `POINTS`, `COMBO`; scoring logic in `game.ts` → `addSkill()` |
| Change controls | `systems/input.ts`: `KEYMAP` (keys), `attachTouch()` (swipe thresholds), `touch()` (on-screen buttons); button layout in `index.html` (`.touch-controls`) and `style.css` |

## Debugging tips

While `npm run dev` is running, the game is available in the browser console as `__game`:

```js
__game.info()                  // speed, distance, air, power, zone…
__game.onPickup('star')        // instant Starman (also 'shockwave', 'ludicrous', 'shield', 'airCan')
__game.powers.start('rocket')  // force a power mode
__game.distance = 7600         // jump ahead to Neon City (Pine Ridge starts at 5000)
__game.player.air = 600        // refill air
```

(These are only for development; `__game` doesn't exist in the production build.)
