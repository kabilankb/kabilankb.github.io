# kabilankb.github.io

Personal portfolio of Kabilan KB: robot learning from simulation to the edge.

Static site, no build step. `index.html` plus images and videos in `media/`.

The hero is a live three.js scene (`hero3d.js`, three.js loaded from jsDelivr): the SO-101 arm moves a gear between two shafts, with joint paths baked offline by inverse kinematics on the URDF. If WebGL is unavailable it shows `media/hero-poster.webp` instead.

`media/so101.glb` is the SO-101 (`so101_new_calib.urdf`) from [nimiCurtis/so101_ros2](https://github.com/nimiCurtis/so101_ros2) (MIT), based on TheRobotStudio's [SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100) (Apache-2.0), with meshes decimated and meshopt-compressed.
