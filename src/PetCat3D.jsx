import React, { useEffect, useRef } from 'react';
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh,
  SphereGeometry, ConeGeometry, CircleGeometry, TorusGeometry,
  MeshStandardMaterial, AmbientLight, DirectionalLight, Color, MathUtils,
} from 'three';

// 低多边形小猫：全部用基础几何体拼，不依赖外部模型，体积和首屏都可控。
export default function PetCat3D({ onPet, petSignal = 0 }) {
  const hostRef = useRef(null);
  const onPetRef = useRef(onPet);
  const signalRef = useRef(petSignal);

  useEffect(() => { onPetRef.current = onPet; }, [onPet]);
  useEffect(() => { signalRef.current = petSignal; }, [petSignal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let width = host.clientWidth || 132;
    let height = host.clientHeight || 152;

    const scene = new Scene();
    const camera = new PerspectiveCamera(34, width / height, 0.1, 100);
    camera.position.set(0, 1.25, 4.55);
    camera.lookAt(0, 0.92, 0);

    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    scene.add(new AmbientLight(0xffffff, 2.2));
    const key = new DirectionalLight(0xfff3e9, 2.3);
    key.position.set(2.4, 4.2, 3);
    scene.add(key);
    const rim = new DirectionalLight(0xd9e7f3, 1.1);
    rim.position.set(-3.2, 2.2, -2.6);
    scene.add(rim);

    const fur = new MeshStandardMaterial({ color: new Color('#f2e3d8'), roughness: 0.93, metalness: 0, flatShading: true });
    const furLight = new MeshStandardMaterial({ color: new Color('#fcf5ef'), roughness: 0.95, metalness: 0, flatShading: true });
    const ink = new MeshStandardMaterial({ color: new Color('#5b4a3e'), roughness: 0.5, metalness: 0 });
    const blush = new MeshStandardMaterial({ color: new Color('#f0c3cc'), roughness: 1, metalness: 0 });
    const pink = new MeshStandardMaterial({ color: new Color('#e6a6ac'), roughness: 0.92, metalness: 0 });

    const cat = new Group();
    cat.position.y = -0.15;
    scene.add(cat);

    const body = new Mesh(new SphereGeometry(0.78, 10, 8), fur);
    body.position.set(0, 0.62, 0);
    body.scale.set(1, 1.08, 0.92);
    cat.add(body);

    const chest = new Mesh(new SphereGeometry(0.5, 10, 8), furLight);
    chest.position.set(0, 0.5, 0.34);
    chest.scale.set(0.92, 0.95, 0.62);
    cat.add(chest);

    const head = new Group();
    head.position.set(0, 1.42, 0.06);
    cat.add(head);

    const skull = new Mesh(new SphereGeometry(0.62, 12, 10), fur);
    skull.scale.set(1, 0.94, 0.96);
    head.add(skull);

    const earGeo = new ConeGeometry(0.22, 0.42, 4);
    const earL = new Mesh(earGeo, fur);
    earL.position.set(-0.36, 0.5, 0.02);
    earL.rotation.set(0.12, 0.22, 0.3);
    head.add(earL);
    const earR = new Mesh(earGeo, fur);
    earR.position.set(0.36, 0.5, 0.02);
    earR.rotation.set(0.12, -0.22, -0.3);
    head.add(earR);

    const innerGeo = new ConeGeometry(0.12, 0.24, 4);
    const innerL = new Mesh(innerGeo, pink);
    innerL.position.set(-0.35, 0.48, 0.1);
    innerL.rotation.copy(earL.rotation);
    head.add(innerL);
    const innerR = new Mesh(innerGeo, pink);
    innerR.position.set(0.35, 0.48, 0.1);
    innerR.rotation.copy(earR.rotation);
    head.add(innerR);

    const eyeGeo = new SphereGeometry(0.075, 8, 8);
    const eyeL = new Mesh(eyeGeo, ink);
    eyeL.position.set(-0.23, 0.06, 0.55);
    eyeL.scale.set(1, 1.2, 0.6);
    head.add(eyeL);
    const eyeR = new Mesh(eyeGeo, ink);
    eyeR.position.set(0.23, 0.06, 0.55);
    eyeR.scale.set(1, 1.2, 0.6);
    head.add(eyeR);

    const nose = new Mesh(new ConeGeometry(0.055, 0.06, 4), pink);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.06, 0.6);
    head.add(nose);

    const mouthGeo = new SphereGeometry(0.022, 6, 6);
    const mouthL = new Mesh(mouthGeo, ink);
    mouthL.position.set(-0.05, -0.15, 0.585);
    head.add(mouthL);
    const mouthR = new Mesh(mouthGeo, ink);
    mouthR.position.set(0.05, -0.15, 0.585);
    head.add(mouthR);

    const cheekGeo = new CircleGeometry(0.1, 12);
    const cheekL = new Mesh(cheekGeo, blush);
    cheekL.position.set(-0.37, -0.06, 0.48);
    cheekL.rotation.y = -0.38;
    head.add(cheekL);
    const cheekR = new Mesh(cheekGeo, blush);
    cheekR.position.set(0.37, -0.06, 0.48);
    cheekR.rotation.y = 0.38;
    head.add(cheekR);

    const tail = new Mesh(new TorusGeometry(0.5, 0.09, 6, 14, Math.PI * 1.25), fur);
    tail.position.set(0.42, 0.5, -0.4);
    tail.rotation.set(0.4, 0.2, -0.9);
    cat.add(tail);

    const pawGeo = new SphereGeometry(0.16, 8, 6);
    const pawL = new Mesh(pawGeo, furLight);
    pawL.position.set(-0.28, 0.12, 0.54);
    pawL.scale.set(1, 0.72, 1.1);
    cat.add(pawL);
    const pawR = new Mesh(pawGeo, furLight);
    pawR.position.set(0.28, 0.12, 0.54);
    pawR.scale.set(1, 0.72, 1.1);
    cat.add(pawR);

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let targetRotY = 0;
    let targetRotX = 0;
    const pointer = { x: 0, y: 0 };
    let jump = 0;
    let seenSignal = signalRef.current;

    function onPointerDown(event) {
      dragging = true;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
    }
    function onPointerMove(event) {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      targetRotY += dx * 0.012;
      targetRotX = MathUtils.clamp(targetRotX + dy * 0.008, -0.45, 0.45);
      lastX = event.clientX;
      lastY = event.clientY;
    }
    function onPointerUp(event) {
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
      if (moved < 6) onPetRef.current?.();
    }
    function onWindowMove(event) {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    }
    function onKeyDown(event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPetRef.current?.(); }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointermove', onWindowMove, { passive: true });
    host.addEventListener('keydown', onKeyDown);

    const resizeObserver = new ResizeObserver(() => {
      width = host.clientWidth || width;
      height = host.clientHeight || height;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(host);

    let raf = 0;
    let running = true;
    const start = performance.now();

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const t = (now - start) / 1000;

      const breath = 1 + Math.sin(t * 1.6) * 0.018;
      body.scale.set(1, 1.08 * breath, 0.92);
      chest.scale.set(0.92, 0.95 * breath, 0.62);

      tail.rotation.z = -0.9 + Math.sin(t * 1.4) * 0.22;
      tail.rotation.x = 0.4 + Math.sin(t * 1.1) * 0.1;

      const followY = pointer.x * 0.2;
      const followX = pointer.y * 0.1;
      cat.rotation.y += ((dragging ? 0 : followY) + targetRotY - cat.rotation.y) * 0.08;
      head.rotation.x += ((dragging ? 0 : followX) + targetRotX * 0.4 - head.rotation.x) * 0.08;
      head.rotation.y += ((dragging ? 0 : followY * 0.45) - head.rotation.y) * 0.08;

      if (signalRef.current !== seenSignal) { seenSignal = signalRef.current; jump = 1; }
      if (jump > 0.01) {
        cat.position.y = -0.15 + Math.sin((1 - jump) * Math.PI) * 0.26;
        jump *= 0.92;
        if (jump < 0.01) { jump = 0; cat.position.y = -0.15; }
      }

      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('pointermove', onWindowMove);
      host.removeEventListener('keydown', onKeyDown);
      scene.traverse(object => {
        if (!object.isMesh) return;
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
        else object.material?.dispose?.();
      });
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return <div className="pet-3d" ref={hostRef} role="button" tabIndex={0}
    aria-label="摸摸这只立体小猫，可以拖动旋转" />;
}
