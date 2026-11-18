'use client';

import { useEffect, useRef } from 'react';

/**
 * DESIGN-HOME-HERO-GLOBE-097: 홈 히어로 장식용 점 지구(표현 전용).
 * - 사실 정보는 담지 않는다. 경로선은 장식이며 실제 이동 경로가 아니다(히어로 본문 텍스트가 모든 정보를 전달).
 * - 보조기술에는 숨긴다(aria-hidden). 데이터·네트워크 요청 없음.
 * - prefers-reduced-motion이면 애니메이션 없이 정지 프레임 하나만 그린다. 설정이 바뀌면 즉시 따른다.
 * - 화면 밖이거나 탭이 숨겨지면 그리기를 멈춘다.
 */

type Vec3 = readonly [number, number, number];

const DOT_COUNT = 1200;
const TILT = 0.42;
const ROUTE_STEPS = 160;
const STATIC_ROTATION = 0.8;
const STATIC_MARKER_STEP = 40;

function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963; // 황금각
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return pts;
}

function routePoints(): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= ROUTE_STEPS; i++) {
    const a = (i / ROUTE_STEPS) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    const y = Math.sin(a) * 0.35;
    const n = Math.hypot(x, y, z) / 1.04; // 지구 표면보다 살짝 바깥
    pts.push([x / n, y / n, z / n]);
  }
  return pts;
}

export function HomeHeroGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dots = fibonacciSphere(DOT_COUNT);
    const route = routePoints();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let size = 0;
    let rotation = STATIC_ROTATION;
    let frame = 0;
    let raf = 0;
    let visible = true;

    const project = ([x, y, z]: Vec3): Vec3 => {
      const cr = Math.cos(rotation), sr = Math.sin(rotation);
      const X = x * cr + z * sr;
      const Z0 = -x * sr + z * cr;
      const ct = Math.cos(TILT), st = Math.sin(TILT);
      return [X, y * ct - Z0 * st, y * st + Z0 * ct];
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = canvas.clientWidth;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (markerStep: number) => {
      const R = size * 0.4;
      const c = size / 2;
      ctx.clearRect(0, 0, size, size);

      const halo = ctx.createRadialGradient(c, c, R * 0.9, c, c, R * 1.25);
      halo.addColorStop(0, 'rgba(58, 123, 213, 0.2)');
      halo.addColorStop(1, 'rgba(58, 123, 213, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.fillStyle = '#0b1d36';
      ctx.fill();

      for (const p of dots) {
        const [X, Y, Z] = project(p);
        if (Z < 0) continue;
        ctx.fillStyle = `rgba(150, 190, 255, ${0.15 + Z * 0.55})`;
        ctx.fillRect(c + X * R - 1, c - Y * R - 1, 2, 2);
      }

      const path = route.map(project);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      for (let i = 0; i < ROUTE_STEPS; i++) {
        const from = path[i];
        const to = path[i + 1];
        if (!from || !to) continue;
        const [x1, y1, z1] = from;
        const [x2, y2] = to;
        ctx.strokeStyle = z1 >= 0 ? '#ffcf5a' : 'rgba(255, 207, 90, 0.2)';
        ctx.beginPath();
        ctx.moveTo(c + x1 * R, c - y1 * R);
        ctx.lineTo(c + x2 * R, c - y2 * R);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const marker = path[markerStep % ROUTE_STEPS];
      if (marker && marker[2] >= 0) {
        const [bx, by] = marker;
        ctx.beginPath();
        ctx.arc(c + bx * R, c - by * R, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcf5a';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c + bx * R, c - by * R, 12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 207, 90, 0.4)';
        ctx.stroke();
      }
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const tick = () => {
      rotation += 0.0025;
      frame += 1;
      draw(Math.floor(frame / 4));
      raf = requestAnimationFrame(tick);
    };

    const sync = () => {
      stop();
      if (motion.matches) {
        rotation = STATIC_ROTATION;
        draw(STATIC_MARKER_STEP);
      } else if (visible && document.visibilityState === 'visible') {
        raf = requestAnimationFrame(tick);
      } else {
        draw(Math.floor(frame / 4));
      }
    };

    resize();
    sync();

    const ro = new ResizeObserver(() => {
      resize();
      draw(motion.matches ? STATIC_MARKER_STEP : Math.floor(frame / 4));
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    io.observe(canvas);

    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return <canvas ref={canvasRef} className="ds-hero-globe-canvas" aria-hidden="true" />;
}
