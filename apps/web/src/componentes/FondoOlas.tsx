import { useEffect, useRef, useState } from "react";
import { avanzar, dibujar, elegirModo, type ModoFondo, posicionesDeReposo } from "./olas.ts";

/** Instante fijo del modo estático: una forma agradable y siempre la misma. */
const T_ESTATICO = 3;
const DPR_MAX = 1.5;

/**
 * Fondo del acceso: olas 2D orgánicas que siguen suavemente al cursor. En táctil o con «menos movimiento» se dibujan
 * una sola vez (sin `requestAnimationFrame` ni escucha del puntero); con puntero fino se animan, y se detienen con
 * la pestaña oculta. Decorativo: no recibe clics ni lo lee un lector de pantalla.
 */
export function FondoOlas() {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [modo, setModo] = useState<ModoFondo>("estatico");

  // el modo puede cambiar con el sistema (p. ej. activar «reducir movimiento»)
  useEffect(() => {
    const consulta = (media: string) => window.matchMedia(media);
    const evaluar = () => setModo(elegirModo(consulta));
    evaluar();
    const medias = ["(hover: none), (pointer: coarse)", "(prefers-reduced-motion: reduce)"].map(
      consulta,
    );
    for (const m of medias) m.addEventListener("change", evaluar);
    return () => {
      for (const m of medias) m.removeEventListener("change", evaluar);
    };
  }, []);

  useEffect(() => {
    const el = lienzo.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const oscuroMedia = window.matchMedia("(prefers-color-scheme: dark)");
    let ancho = 0;
    let alto = 0;
    let estado = posicionesDeReposo(1, 1);
    let cursor = { x: 0, y: 0 };
    let marco = 0;
    let anterior = 0;

    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
      ancho = window.innerWidth;
      alto = window.innerHeight;
      el.width = Math.round(ancho * dpr);
      el.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cursor = { x: ancho / 2, y: alto / 2 };
      estado = posicionesDeReposo(ancho, alto);
    };
    medir();

    if (modo === "estatico") {
      const pintar = () => dibujar(ctx, ancho, alto, estado, T_ESTATICO, oscuroMedia.matches);
      pintar();
      const alCambiarTamano = () => {
        medir();
        pintar();
      };
      window.addEventListener("resize", alCambiarTamano);
      oscuroMedia.addEventListener("change", pintar);
      return () => {
        window.removeEventListener("resize", alCambiarTamano);
        oscuroMedia.removeEventListener("change", pintar);
      };
    }

    const alMoverPuntero = (e: PointerEvent) => {
      cursor = { x: e.clientX, y: e.clientY };
    };
    const cuadro = (ahora: number) => {
      const dt = Math.min((ahora - anterior) / 1000, 0.05);
      anterior = ahora;
      avanzar(estado, ancho, alto, cursor, dt);
      dibujar(ctx, ancho, alto, estado, ahora / 1000, oscuroMedia.matches);
      marco = requestAnimationFrame(cuadro);
    };
    const arrancar = () => {
      cancelAnimationFrame(marco);
      anterior = performance.now();
      marco = requestAnimationFrame(cuadro);
    };
    const alCambiarVisibilidad = () => {
      if (document.hidden) cancelAnimationFrame(marco);
      else arrancar();
    };

    window.addEventListener("pointermove", alMoverPuntero, { passive: true });
    window.addEventListener("resize", medir);
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    arrancar();
    return () => {
      cancelAnimationFrame(marco);
      window.removeEventListener("pointermove", alMoverPuntero);
      window.removeEventListener("resize", medir);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [modo]);

  return (
    <canvas
      ref={lienzo}
      aria-hidden="true"
      data-modo={modo}
      className="pointer-events-none fixed inset-0 -z-10 size-full"
    />
  );
}
