"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BrandMark } from "@/components/BrandMark";

const GLOBE_LABELS = [
  ["Research", "globe-research"],
  ["Create", "globe-create"],
  ["Publish", "globe-publish"],
  ["Learn", "globe-learn"],
] as const;

export function ReturnGlobe() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 9.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);

    const system = new THREE.Group();
    system.rotation.set(-0.18, -0.28, 0.03);
    scene.add(system);

    const globeGeometry = new THREE.SphereGeometry(2.12, 30, 22);
    const globe = new THREE.Mesh(
      globeGeometry,
      new THREE.MeshPhysicalMaterial({
        color: 0x304b37,
        roughness: 0.62,
        metalness: 0.05,
        transparent: true,
        opacity: 0.48,
        transmission: 0.12,
      }),
    );
    system.add(globe);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(2.18, 24, 16)),
      new THREE.LineBasicMaterial({ color: 0xb9ff66, transparent: true, opacity: 0.18 }),
    );
    system.add(wire);

    const points: number[] = [];
    const pointCount = 360;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let index = 0; index < pointCount; index += 1) {
      const y = 1 - (index / (pointCount - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = goldenAngle * index;
      points.push(Math.cos(theta) * radius * 2.22, y * 2.22, Math.sin(theta) * radius * 2.22);
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const pointCloud = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({ color: 0xd8ff9b, size: 0.035, transparent: true, opacity: 0.72 }),
    );
    system.add(pointCloud);

    const rings = [
      { radius: 2.85, tilt: [1.18, 0.1, 0.24] },
      { radius: 3.28, tilt: [0.46, 0.72, -0.18] },
      { radius: 3.7, tilt: [1.45, -0.28, 0.52] },
    ].map(({ radius, tilt }, index) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.009 + index * 0.003, 8, 180),
        new THREE.MeshBasicMaterial({
          color: index === 1 ? 0xb9ff66 : 0xe6f1df,
          transparent: true,
          opacity: index === 1 ? 0.34 : 0.16,
        }),
      );
      ring.rotation.set(tilt[0], tilt[1], tilt[2]);
      system.add(ring);
      return ring;
    });

    const signalMaterial = new THREE.MeshBasicMaterial({ color: 0xb9ff66 });
    const signals = rings.map((ring, index) => {
      const signal = new THREE.Mesh(new THREE.SphereGeometry(0.065 + index * 0.012, 14, 14), signalMaterial);
      ring.add(signal);
      return signal;
    });

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 36, 36),
      new THREE.MeshPhysicalMaterial({
        color: 0xb9ff66,
        emissive: 0x6db52d,
        emissiveIntensity: 1.4,
        roughness: 0.24,
      }),
    );
    system.add(core);

    scene.add(new THREE.HemisphereLight(0xe9ffda, 0x0c1510, 2.4));
    const rim = new THREE.PointLight(0xb9ff66, 28, 14);
    rim.position.set(3.5, 2, 4);
    scene.add(rim);

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
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
      system.rotation.y += (-0.28 + pointerX * 0.12 - system.rotation.y) * 0.025 * motion;
      system.rotation.x += (-0.18 + pointerY * 0.08 - system.rotation.x) * 0.025 * motion;
      globe.rotation.y = elapsed * 0.045 * motion;
      wire.rotation.y = -elapsed * 0.055 * motion;
      pointCloud.rotation.y = elapsed * 0.035 * motion;
      rings.forEach((ring, index) => {
        ring.rotation.z += (0.0008 + index * 0.00035) * motion;
        const angle = elapsed * (0.38 + index * 0.08) + index * 2.1;
        signals[index].position.set(Math.cos(angle) * (2.85 + index * 0.43), Math.sin(angle) * (2.85 + index * 0.43), 0);
      });
      core.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.06 * motion);
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
      globeGeometry.dispose();
      (globe.material as THREE.Material).dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      pointGeometry.dispose();
      (pointCloud.material as THREE.Material).dispose();
      rings.forEach((ring) => {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
      });
      signals.forEach((signal) => signal.geometry.dispose());
      signalMaterial.dispose();
      core.geometry.dispose();
      (core.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="return-globe" aria-label="Interactive signal globe">
      <div ref={mountRef} className="return-globe-canvas" aria-hidden="true" />
      <span className="return-globe-core" aria-hidden="true"><BrandMark className="h-12 w-12 object-contain" decorative /></span>
      {GLOBE_LABELS.map(([label, className]) => (
        <span key={label} className={`return-globe-label ${className}`}>{label}</span>
      ))}
      <span className="globe-caption">MEMORY ORBIT / LIVE FEEDBACK</span>
    </div>
  );
}
