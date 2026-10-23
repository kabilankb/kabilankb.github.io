# kabilankb.github.io

Personal portfolio of Kabilan KB: robot learning from simulation to the edge.

Static site, no build step. `index.html` plus images and videos in `media/`.

The hero backdrop is a three.js point field (`hero3d.js`, three.js loaded from jsDelivr): a lidar-style terrain that drifts toward the viewer while a scan ring sweeps across it, all computed in a vertex shader. If WebGL is unavailable it shows `media/hero-poster.webp` instead.
