"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export function SignalWorld() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x17221d, 0.055);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.4, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);

    const world = new THREE.Group();
    world.rotation.set(-0.18, -0.32, 0.08);
    scene.add(world);

    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(2.1, 0.64, 240, 32, 2, 3),
      new THREE.MeshPhysicalMaterial({
        color: 0x748b68,
        roughness: 0.78,
        metalness: 0.05,
        clearcoat: 0.25,
        clearcoatRoughness: 0.75,
      }),
    );
    world.add(knot);

    const wire = new THREE.Mesh(
      new THREE.TorusKnotGeometry(2.18, 0.675, 180, 16, 2, 3),
      new THREE.MeshBasicMaterial({
        color: 0xb8ff65,
        transparent: true,
        opacity: 0.16,
        wireframe: true,
      }),
    );
    world.add(wire);

    const nodeGeometry = new THREE.IcosahedronGeometry(0.055, 1);
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xd8ff9a });
    const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, 150);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < 150; index += 1) {
      const angle = index * 0.47;
      const radius = 2.65 + Math.sin(index * 1.7) * 0.6;
      dummy.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle * 0.72) * 1.7,
        Math.sin(angle) * radius * 0.56,
      );
      dummy.scale.setScalar(0.45 + ((index * 13) % 11) / 12);
      dummy.updateMatrix();
      nodes.setMatrixAt(index, dummy.matrix);
    }
    world.add(nodes);

    const source = new THREE.Mesh(
      new THREE.SphereGeometry(0.43, 48, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0xf0f7e8,
        emissive: 0x9abe74,
        emissiveIntensity: 0.24,
        roughness: 0.22,
        transmission: 0.2,
      }),
    );
    source.position.set(-1.1, 0.3, 1.15);
    world.add(source);

    scene.add(new THREE.HemisphereLight(0xe8ffd8, 0x132019, 2.6));
    const keyLight = new THREE.DirectionalLight(0xf6ffda, 4.8);
    keyLight.position.set(-3, 4, 5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x9dff54, 18, 12);
    rimLight.position.set(3, -1, 3);
    scene.add(rimLight);

    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;
    const clock = new THREE.Clock();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };

    const render = () => {
      const elapsed = clock.getElapsedTime();
      const motion = reducedMotion.matches ? 0 : 1;
      world.rotation.y += (pointerX * 0.18 - world.rotation.y) * 0.025 * motion;
      world.rotation.x += (-0.18 + pointerY * 0.08 - world.rotation.x) * 0.025 * motion;
      knot.rotation.z = elapsed * 0.035 * motion;
      wire.rotation.z = -elapsed * 0.025 * motion;
      nodes.rotation.y = elapsed * 0.018 * motion;
      source.scale.setScalar(1 + Math.sin(elapsed * 2.4) * 0.045 * motion);
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };

    resize();
    mount.addEventListener("pointermove", onPointerMove);
    window.addEventListener("resize", resize);
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      mount.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", resize);
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      knot.geometry.dispose();
      (knot.material as THREE.Material).dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      source.geometry.dispose();
      (source.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="signal-world" aria-hidden="true" />;
}
