// Minimal Three.js backdrop for the how-to-deploy page: one slowly rotating cube. Vanilla port of
// app-runner/status-app's Scene.js (no React/Next) — WebGLRenderer (transparent) + PerspectiveCamera
// + setAnimationLoop, mounted into #bg and resized with the window.
import * as THREE from "three"

const mount = document.getElementById("bg")
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 100)
camera.position.z = 4

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(mount.clientWidth, mount.clientHeight)
renderer.setClearColor(0x000000, 0)
mount.appendChild(renderer.domElement)

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 1.6, 1.6),
  new THREE.MeshStandardMaterial({ color: 0x6e8bff, roughness: 0.35, metalness: 0.1 }),
)
scene.add(cube)
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const light = new THREE.DirectionalLight(0xffffff, 2)
light.position.set(5, 5, 5)
scene.add(light)

renderer.setAnimationLoop(() => {
  cube.rotation.x += 0.006
  cube.rotation.y += 0.008
  renderer.render(scene, camera)
})

window.addEventListener("resize", () => {
  const { clientWidth: w, clientHeight: h } = mount
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
})
