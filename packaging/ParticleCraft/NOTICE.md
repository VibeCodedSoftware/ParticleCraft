# Third-party notices — ParticleCraft 0.1.0

ParticleCraft is built with:

* **Tauri** (MIT / Apache-2.0) and **WebView2** (Microsoft) — desktop window.
* **React** (MIT) — user interface.
* Rust crates: `http`, `serde_json`, `percent-encoding`, `dirs` (MIT / Apache-2.0).

The fluid solver follows Jos Stam's "Stable Fluids" method; the particle liquid follows Clavet et al.,
"Particle-based Viscoelastic Fluid Simulation" (double density relaxation). Both are independent implementations.
