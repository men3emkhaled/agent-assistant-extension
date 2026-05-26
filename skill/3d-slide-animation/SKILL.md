---
name: 3d-slide-animation
description: Expert in building high-fidelity 3D slide transitions, immersive carousels, and scroll-driven presentations using Three.js, React Three Fiber, GLSL shaders, GSAP, and gesture controllers.
risk: unknown
source: local-dev-skills
date_added: 2026-05-26
category: frontend
---

# 3D Slide Animation

Expert in building high-fidelity 3D slide transitions, immersive carousels, and scroll-driven presentations using Three.js, React Three Fiber, GLSL shaders, GSAP, and gesture controllers.

**Role**: 3D Motion & Slide Architect

You create stunning 3D page flips, liquid distortion sliders, and spatial scroll presentation decks. You balance premium aesthetics with mobile touch performance, ensuring interactive elements react naturally to drag gestures and scroll events.

### Expertise
- Three.js / React Three Fiber / Drei
- GLSL Transition Shaders (Vertex & Fragment)
- GSAP / ScrollTrigger / react-spring
- `@use-gesture/react` for drag/swipe interactions
- WebGL texture blending & post-processing
- 3D slide state synchronization
- Render loop & draw call optimization

---

## Capabilities
- 3D Liquid/Distortion Slider implementation
- Touch-gesture-driven 3D carousels (drag, swipe, velocity-based inertia)
- Scroll-based spatial slide decks (camera path flythroughs)
- Custom WebGL transitions (RGB Shift, Page Curl, Zoom Blurring)
- UI/HTML text overlays synced to WebGL canvas state
- High-performance mobile rendering (DPR limits, asset preloading)

---

## Implementation Patterns

### 1. WebGL Custom Shader Transitions (Liquid/Distortion Slider)
Use custom shaders to transition between textures (slides) with a distortion map.

```glsl
// Fragment Shader for Liquid Transition
uniform sampler2D uTexture1;
uniform sampler2D uTexture2;
uniform sampler2D uDisp; // Distortion map
uniform float uProgress;
uniform float uIntensity;
varying vec2 vUv;

void main() {
  vec4 disp = texture2D(uDisp, vUv);
  
  // Distort UVs based on distortion map and transition progress
  vec2 distortedUv1 = vec2(vUv.x + uProgress * (disp.r * uIntensity), vUv.y);
  vec2 distortedUv2 = vec2(vUv.x - (1.0 - uProgress) * (disp.r * uIntensity), vUv.y);
  
  vec4 tex1 = texture2D(uTexture1, distortedUv1);
  vec4 tex2 = texture2D(uTexture2, distortedUv2);
  
  // Blend between the two distorted textures
  gl_FragColor = mix(tex1, tex2, uProgress);
}
```

```jsx
// React Component using custom ShaderMaterial
import { useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';

export function SlideMaterial({ texture1, texture2, dispTexture, progress }) {
  const ref = useRef();
  
  const [tex1, tex2, disp] = useLoader(THREE.TextureLoader, [
    texture1,
    texture2,
    dispTexture
  ]);

  useFrame(() => {
    if (ref.current) {
      ref.current.uProgress = progress;
    }
  });

  return (
    <shaderMaterial
      ref={ref}
      uniforms={{
        uTexture1: { value: tex1 },
        uTexture2: { value: tex2 },
        uDisp: { value: disp },
        uProgress: { value: 0 },
        uIntensity: { value: 0.2 }
      }}
      vertexShader={`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `}
      fragmentShader={/* Fragment Shader above */}
    />
  );
}
```

### 2. Touch & Swipe Gestures with Inertia
Integrate `@use-gesture/react` and `react-spring` to rotate or slide meshes smoothly with momentum.

```jsx
import { useDrag } from '@use-gesture/react';
import { useSpring, a } from '@react-spring/three';
import { Canvas } from '@react-three/fiber';

function CarouselDeck({ slidesCount }) {
  const [{ rotationY }, api] = useSpring(() => ({ rotationY: 0 }));

  const bind = useDrag(({ movement: [x], velocity: [vx], down, cancel }) => {
    const swipeThreshold = 50;
    const step = (Math.PI * 2) / slidesCount;
    
    if (!down) {
      // Calculate target rotation based on swipe velocity and direction
      const direction = x < 0 ? 1 : -1;
      const velocityModifier = Math.max(1, Math.round(vx * 2));
      const targetRotation = Math.round(rotationY.get() / step + direction * velocityModifier) * step;
      
      api.start({ rotationY: targetRotation, config: { tension: 200, friction: 25 } });
    } else {
      // Drag in progress
      api.start({ rotationY: x * 0.005, immediate: true });
    }
  });

  return (
    <a.mesh {...bind()} rotation-y={rotationY}>
      {/* Slides arranged in a circle */}
    </a.mesh>
  );
}
```

### 3. Scroll-Driven 3D Presentation Deck
Combine GSAP ScrollTrigger and Three.js camera movement.

```javascript
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Animate camera position and slide visibility along a path
function initScrollAnimation(camera, slides) {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '.scroll-container',
      start: 'top top',
      end: '+=400%',
      scrub: true,
      pin: true,
    }
  });

  // Slide 1 -> 2
  tl.to(camera.position, { x: 0, y: -5, z: 10, duration: 1 })
    .to(slides[0].rotation, { y: Math.PI / 2, duration: 0.8 }, 0)
    .to(slides[1].position, { y: 0, opacity: 1, duration: 0.8 }, 0.2);

  // Slide 2 -> 3
  tl.to(camera.position, { x: 5, y: -5, z: 5, duration: 1 })
    .to(slides[1].rotation, { x: -Math.PI / 2, duration: 0.8 }, 1)
    .to(slides[2].position, { x: 0, opacity: 1, duration: 0.8 }, 1.2);
}
```

### 4. Synced UI / HTML Text Overlays
To overlay crisp text and details (like page numbers or slide copy) over WebGL objects without sacrificing resolution or accessibility, use Drei's `<Html>` utility or synchronize overlay state in standard React.

```jsx
import { useState } from 'react';
import { Canvas } from '@react-three/fiber';

export function SliderPage() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="relative w-screen h-screen">
      {/* 3D Scene */}
      <Canvas>
        <SliderScene activeIndex={activeIndex} onChangeIndex={setActiveIndex} />
      </Canvas>

      {/* HTML Overlay - UI layer */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-12">
        <h1 className="text-white text-6xl font-bold font-sans pointer-events-auto">
          {SLIDE_DATA[activeIndex].title}
        </h1>
        <div className="flex gap-4 pointer-events-auto">
          <button onClick={() => setActiveIndex(prev => Math.max(0, prev - 1))}>PREV</button>
          <button onClick={() => setActiveIndex(prev => Math.min(SLIDE_DATA.length - 1, prev + 1))}>NEXT</button>
        </div>
      </div>
    </div>
  );
}
```

---

## 3D Performance Guidelines
- **Shader Compilation**: Pre-compile shader materials. Avoid creating new ShaderMaterial instances during transitions; instead, swap uniform values.
- **Texture Resolutions**: Limit texture files to 2048x2048px (or smaller on mobile). Convert textures to WebP format for fast loads.
- **DPR Scaling**: Limit DPR to 1 on mobile (`window.devicePixelRatio <= 1.5 ? 1 : 1.5`) to avoid rendering bottlenecks.
- **Disposal**: Dispose of old materials, geometries, and textures when slides are destroyed or changed to prevent memory leaks.

```javascript
// Clean up example
mesh.geometry.dispose();
if (Array.isArray(mesh.material)) {
  mesh.material.forEach(m => m.dispose());
} else {
  mesh.material.dispose();
}
```

---

## Validation Checks

### Missing Texture Preloader
**Severity**: HIGH
**Message**: Slides might flash black or white on load if textures aren't fully preloaded.
**Fix Action**: Wrap components loading textures inside `<Suspense fallback={<Loader />}>` and pre-load core textures.

### Shader Uniform Allocation inside useFrame
**Severity**: MEDIUM
**Message**: Re-allocating texture objects or uniforms in every frame causes massive garbage collection overhead.
**Fix Action**: Only update the value field of existing uniforms (e.g., `ref.current.uniforms.uProgress.value = progress;`), do not re-create the uniform object.

### OrbitControls Interfering with Drag Gestures
**Severity**: HIGH
**Message**: Drag or swipe gestures on slides will fight with OrbitControls camera movement.
**Fix Action**: Set `enabled={false}` on OrbitControls when a drag gesture is in progress or omit OrbitControls entirely.

### Unbounded DPR on High-DPI screens
**Severity**: MEDIUM
**Message**: Mobile devices with DPR > 2.5 (e.g. iPhones, high-end Androids) will lag significantly when rendering WebGL shader transitions.
**Fix Action**: Set `<Canvas dpr={[1, 1.5]}>` or `<Canvas dpr={Math.min(window.devicePixelRatio, 1.5)}>` to clamp the resolution scale.
