# GRB — animation & simulation playground

A lightweight canvas sandbox for procedural animation experiments. The initial sketch draws a flow-field particle animation that you can extend for future simulations.

## Getting started

This site is static and requires no build tooling.

1. Open `index.html` directly in your browser **or** serve the repo locally with a simple HTTP server:
   - Python: `python -m http.server 8000`
   - Node: `npx serve .`
2. Visit the served address (e.g., `http://localhost:8000`).

## How it works

- A canvas fills the panel and seeds several hundred particles.
- Each frame, a sine-based pseudo curl field updates particle direction; positions wrap around edges.
- Trails are drawn with low-opacity strokes, creating motion-blur style ribbons.

## Deploying to GitHub Pages

This repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that publishes the static site from the `main` branch to GitHub Pages. After pushing changes to `main` or running the workflow manually, Pages will serve the root directory.

## Next steps

- Adjust `scripts/main.js` settings (particle count, speed, trail) to experiment with different looks.
- Swap the pseudo curl field for Perlin/simplex noise or physics-based forces.
- Add UI controls to tweak parameters in real time.
