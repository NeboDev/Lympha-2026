import { expect, test } from "@playwright/test";

/**
 * La PWA instalable, sobre el BUILD de producción (`vite preview`): manifiesto, iconos, service worker y uso sin red.
 * No hay inicio de sesión aquí: un build de producción ignora el emulador de Firebase a propósito.
 */
test.describe("PWA instalable", () => {
  test("el manifiesto cumple lo que pide el navegador para instalar", async ({ page, request }) => {
    await page.goto("/acceso");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();
    const respuesta = await request.get(new URL(href as string, page.url()).toString());
    expect(respuesta.ok()).toBe(true);
    const m = (await respuesta.json()) as {
      name: string;
      short_name: string;
      lang: string;
      start_url: string;
      display: string;
      theme_color: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect(m).toMatchObject({
      name: "Lympha",
      short_name: "Lympha",
      lang: "es-MX",
      start_url: "/",
      display: "standalone",
    });
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    const tamanos = m.icons.map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(tamanos).toEqual(
      expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]),
    );
    for (const icono of m.icons) {
      const r = await request.get(new URL(icono.src, page.url()).toString());
      expect(r.ok(), icono.src).toBe(true);
      expect(r.headers()["content-type"]).toContain("image/png");
    }
  });

  test("el service worker se registra y toma el control de la página", async ({ page }) => {
    await page.goto("/acceso");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 15_000,
      })
      .toBe(true);
  });

  test("sin internet la app abre desde el dispositivo y avisa que no hay conexión", async ({
    page,
    context,
  }) => {
    await page.goto("/acceso");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload(); // ya con el service worker al mando
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Lympha" })).toBeVisible();
    await expect(page.getByLabel("Correo")).toBeVisible();
    await expect(page.getByText("Sin conexión a internet")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Sin conexión a internet")).toHaveCount(0);
  });

  test("solo se guarda el cascarón de la app: nada de la API ni de las cuentas", async ({
    page,
  }) => {
    await page.goto("/acceso");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload(); // con el service worker al mando, para que vea las peticiones de la página
    // la página le pide algo a la API (el estado del servicio): si el service worker guardara respuestas de la API,
    // aparecería en las cachés; sin esta petición la prueba no podría fallar
    const estado = await page.evaluate(
      async () => (await fetch("http://127.0.0.1:3000/health")).status,
    );
    expect(estado).toBe(200);
    const urls = await page.evaluate(async () => {
      const salida: string[] = [];
      for (const nombre of await caches.keys()) {
        for (const peticion of await (await caches.open(nombre)).keys()) salida.push(peticion.url);
      }
      return salida;
    });
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).origin, url).toBe("http://127.0.0.1:4173");
      expect(url).not.toContain("/api/");
    }
  });
});
