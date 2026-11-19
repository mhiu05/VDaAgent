import { useEffect, useRef } from "react";
import { usePreferences } from "../providers/PreferencesProvider";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  depth: number;
};

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { reducedMotion, preferences } = usePreferences();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || navigator.userAgent.includes("jsdom")) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let particles: Particle[] = [];

    const createParticles = () => {
      const count = Math.min(
        72,
        Math.max(28, Math.round((width * height) / 26000)),
      );
      particles = Array.from({ length: count }, () => {
        const depth = 0.35 + Math.random() * 0.65;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.075 * depth,
          vy: (Math.random() - 0.5) * 0.055 * depth,
          radius: 0.8 + depth * 1.65,
          depth,
        };
      });
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const dark = document.documentElement.dataset.theme === "dark";
      const dot = dark ? "110, 231, 183" : "15, 107, 88";
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        context.beginPath();
        context.fillStyle = `rgba(${dot}, ${0.28 + particle.depth * 0.32})`;
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();

        for (
          let otherIndex = index + 1;
          otherIndex < particles.length;
          otherIndex += 1
        ) {
          const other = particles[otherIndex];
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 128) continue;
          context.beginPath();
          context.strokeStyle = `rgba(${dot}, ${(1 - distance / 128) * 0.12})`;
          context.lineWidth = 0.65;
          context.moveTo(particle.x, particle.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      createParticles();
      draw();
    };

    const animate = () => {
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < -8) particle.x = width + 8;
        if (particle.x > width + 8) particle.x = -8;
        if (particle.y < -8) particle.y = height + 8;
        if (particle.y > height + 8) particle.y = -8;
      }
      draw();
      frame = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    if (!reducedMotion) frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion, preferences.theme]);

  return (
    <canvas
      ref={canvasRef}
      className="particle-background"
      aria-hidden="true"
    />
  );
}
