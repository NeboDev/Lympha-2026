import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  CONTRASENA,
  correoUnico,
  crearCuenta,
  fabricarNodo,
  iniciarSimulador,
  type NodoFabricado,
  type Simulador,
  vincularTelegramComoElBot,
} from "./ayudas.ts";

/**
 * El recorrido de una persona real contra el stack real, en orden (cada prueba parte de lo que dejó la anterior):
 * registro → espacio → reclamo de un nodo con su etiqueta → semáforo en vivo con el simulador → alerta → invitar a
 * otra persona → Telegram → preferencias. Y lo que NO debe poder: ver lo de otro.
 */
test.describe
  .serial("flujo completo", () => {
    const correoAna = correoUnico("ana");
    const NOMBRE_ESPACIO = "Casa E2E";
    const NOMBRE_NODO = "Cisterna E2E";
    let ana: Page;
    let nodo: NodoFabricado;
    let simulador: Simulador | undefined;
    let espacioUrl = "";
    let enlaceInvitacion = "";

    test.beforeAll(async ({ browser }: { browser: Browser }) => {
      ana = await (await browser.newContext()).newPage();
      nodo = fabricarNodo();
    });

    test.afterAll(async () => {
      simulador?.detener();
      await ana.context().close();
    });

    test("sin sesión se pide entrar y una contraseña errónea no revela si la cuenta existe", async () => {
      await ana.goto("/");
      await expect(ana).toHaveURL(/\/acceso/);
      await ana.getByLabel("Correo").fill(correoUnico("nadie"));
      await ana.getByLabel("Contraseña").fill("incorrecta-1");
      await ana.getByRole("button", { name: "Entrar" }).click();
      await expect(ana.getByRole("alert")).toHaveText("Correo o contraseña incorrectos.");
    });

    test("crear una cuenta lleva al inicio y la sesión sobrevive a recargar", async () => {
      await crearCuenta(ana, "Ana E2E", correoAna);
      await expect(ana.getByText("Aún no tienes espacios")).toBeVisible();
      await ana.reload();
      await expect(ana.getByRole("heading", { name: "Tus espacios" })).toBeVisible();
      await expect(ana.getByRole("banner")).toContainText("Ana E2E");
    });

    test("crear un espacio y reclamar un nodo con el enlace de su etiqueta", async () => {
      await ana.getByLabel("Nombre").fill(NOMBRE_ESPACIO);
      await ana.getByRole("button", { name: "Crear espacio" }).click();
      await ana.getByRole("link", { name: NOMBRE_ESPACIO }).click();
      espacioUrl = ana.url();
      await expect(ana.getByRole("heading", { name: NOMBRE_ESPACIO })).toBeVisible();

      await ana.getByRole("link", { name: "Reclamar un nodo" }).click();
      // el contenido del QR propuesto, pegado en el primer campo
      await ana
        .getByLabel("Identificador del nodo")
        .fill(`lympha://reclamar?n=${nodo.deviceId}&c=${nodo.codigo}`);
      await ana.getByLabel("Nombre del nodo").fill(NOMBRE_NODO);
      await ana.getByRole("button", { name: "Reclamar nodo" }).click();

      const tarjeta = ana.getByRole("article", { name: NOMBRE_NODO });
      await expect(tarjeta).toContainText("Esperando la primera lectura");
    });

    test("un código equivocado no reclama nada y el mensaje no dice qué falló", async ({
      browser,
    }) => {
      const otra = await (await browser.newContext()).newPage();
      try {
        await crearCuenta(otra, "Dani E2E", correoUnico("dani"));
        await otra.getByLabel("Nombre").fill("Casa de Dani");
        await otra.getByRole("button", { name: "Crear espacio" }).click();
        await otra.getByRole("link", { name: "Casa de Dani" }).click();
        await otra.getByRole("link", { name: "Reclamar un nodo" }).click();
        // el nodo ya es de Ana: reclamarlo con su código real tampoco funciona para otra persona
        await otra.getByLabel("Identificador del nodo").fill(`${nodo.deviceId} ${nodo.codigo}`);
        await otra.getByRole("button", { name: "Reclamar nodo" }).click();
        await expect(otra.getByRole("alert")).toContainText("No pudimos reclamar ese nodo");
        await expect(otra).toHaveURL(/\/reclamar$/);
      } finally {
        await otra.context().close();
      }
    });

    test("el semáforo cambia en vivo, sin recargar, cuando el agua empeora", async () => {
      simulador = iniciarSimulador(nodo, "ph_alcalino_salto");
      await ana.goto(espacioUrl);
      const tarjeta = ana.getByRole("article", { name: NOMBRE_NODO });
      await expect(tarjeta).toContainText("Buena", { timeout: 60_000 });
      // el pH salta de golpe: el nivel sube a crítica SIN recargar la página
      await expect(tarjeta).toContainText("Crítica", { timeout: 120_000 });
      await expect(tarjeta).toContainText(/pH|cal|alcalin/i);
      // y el texto nunca afirma que el agua sea potable ni segura (RNF-32)
      await expect(ana.locator("body")).not.toContainText(/potable|segura|seguro/i);
    });

    test("la alerta aparece, se marca como atendida y queda en el historial por nombre", async () => {
      await ana.getByRole("link", { name: "Alertas" }).click();
      const alerta = ana.locator(".alerta").first();
      await expect(alerta).toContainText("Calidad del agua");
      await expect(alerta).toContainText("Activa");
      await alerta.getByRole("button", { name: "Marcar como atendida" }).click();
      await expect(alerta).toContainText("Atendida por Ana E2E");
      await ana.getByRole("button", { name: "Historial" }).click();
      await expect(ana.locator(".alerta").first()).toContainText("Atendida por Ana E2E");
      await expect(ana.locator("body")).not.toContainText(correoAna);
    });

    test("el detalle del nodo muestra el historial de 7 y 30 días y el modo avanzado", async () => {
      await ana.getByRole("link", { name: "Inicio" }).click();
      await ana.getByRole("link", { name: NOMBRE_NODO }).click();
      await expect(ana.getByRole("heading", { name: NOMBRE_NODO, level: 1 })).toBeVisible();
      await expect(ana.locator(".tira .dia")).toHaveCount(7);
      await ana.getByRole("button", { name: "30 días" }).click();
      await expect(ana.locator(".tira .dia")).toHaveCount(30);
      // hoy tiene evaluaciones: el último día no es «Sin registro»
      await expect(ana.locator(".tira .dia").last()).not.toHaveAttribute(
        "aria-label",
        /Sin registro/,
      );
      await ana.getByLabel("Modo avanzado").check();
      await expect(ana.getByRole("img", { name: /últimas \d+ lecturas/ })).toBeVisible();
      await expect(ana.getByRole("img", { name: /promedio diario de 30 días/ })).toBeVisible();
    });

    test("invitar a otra persona: se une con el enlace y una tercera no ve el espacio", async ({
      browser,
    }) => {
      await ana.goto(espacioUrl);
      await ana.getByRole("button", { name: "Crear invitación" }).click();
      enlaceInvitacion = await ana.getByLabel("Enlace de invitación").inputValue();
      expect(enlaceInvitacion).toContain("/invitacion#");

      const beto = await (await browser.newContext()).newPage();
      try {
        await beto.goto(enlaceInvitacion);
        await expect(beto).toHaveURL(/\/acceso/); // sin sesión: primero entra, y el enlace se conserva
        await beto.getByRole("button", { name: "Crear una cuenta" }).click();
        await beto.getByLabel("Tu nombre").fill("Beto E2E");
        await beto.getByLabel("Correo").fill(correoUnico("beto"));
        await beto.getByLabel("Contraseña").fill(CONTRASENA);
        await beto.getByRole("button", { name: "Crear cuenta" }).click();
        await expect(beto.getByRole("heading", { name: "Unirte a un espacio" })).toBeVisible();
        await beto.getByRole("button", { name: "Unirme al espacio" }).click();
        await expect(beto.getByRole("heading", { name: NOMBRE_ESPACIO })).toBeVisible();
        await expect(beto.getByText("Ana E2E")).toBeVisible();
        // miembro, no propietario: sin controles de administración
        await expect(beto.getByRole("button", { name: "Crear invitación" })).toHaveCount(0);
        await expect(beto.getByRole("link", { name: "Reclamar un nodo" })).toHaveCount(0);
        await expect(beto.getByRole("article", { name: NOMBRE_NODO })).toBeVisible();
      } finally {
        await beto.context().close();
      }

      // una tercera persona, sin invitación, recibe lo mismo que si el espacio no existiera
      const carla = await (await browser.newContext()).newPage();
      try {
        await crearCuenta(carla, "Carla E2E", correoUnico("carla"));
        await carla.goto(espacioUrl);
        await expect(carla.getByRole("alert")).toHaveText("No encontramos lo que buscas.");
        await expect(carla.locator("body")).not.toContainText(NOMBRE_ESPACIO);
        // y el enlace de invitación ya usado por Beto no sirve
        await carla.goto(enlaceInvitacion);
        await carla.getByRole("button", { name: "Unirme al espacio" }).click();
        await expect(carla.getByRole("alert")).toContainText("no es válida o ya venció");
      } finally {
        await carla.context().close();
      }
    });

    test("Telegram: se genera el enlace, la PWA detecta el vínculo y se puede desvincular", async () => {
      await ana.getByRole("link", { name: "Ajustes" }).click();
      await ana.getByRole("button", { name: "Vincular Telegram" }).click();
      const enlace = ana.getByRole("link", { name: "Abrir Telegram" });
      await expect(enlace).toHaveAttribute("href", /^https:\/\/t\.me\//);
      await expect(enlace).toHaveAttribute("rel", /noopener/);
      await expect(ana.getByText("Esperando a que lo confirmes")).toBeVisible();

      vincularTelegramComoElBot(correoAna, 700_000_000 + Math.floor(Math.random() * 1_000_000));
      await expect(ana.getByText("Telegram está vinculado")).toBeVisible({ timeout: 15_000 });

      ana.once("dialog", (d) => void d.accept());
      await ana.getByRole("button", { name: "Desvincular Telegram" }).click();
      await expect(ana.getByRole("button", { name: "Vincular Telegram" })).toBeVisible();
    });

    test("las preferencias de aviso se guardan y persisten al recargar", async () => {
      const general = ana.locator("form.preferencia").first();
      await general.getByLabel("Regular").check();
      await general.getByLabel("No avisarme durante un horario").check();
      await general.getByLabel("Desde").fill("21:30");
      await general.getByLabel("Hasta").fill("06:45");
      await general.getByLabel("Recordarme cada").fill("12");
      await general.getByRole("button", { name: "Guardar ajustes generales" }).click();
      await expect(ana.getByText("Ajustes guardados.")).toBeVisible();

      await ana.reload();
      const trasRecargar = ana.locator("form.preferencia").first();
      await expect(trasRecargar.getByLabel("Regular")).toBeChecked();
      await expect(trasRecargar.getByLabel("Desde")).toHaveValue("21:30");
      await expect(trasRecargar.getByLabel("Recordarme cada")).toHaveValue("12");

      // validación: un horario con el mismo inicio y fin se rechaza con un mensaje claro
      await trasRecargar.getByLabel("Hasta").fill("21:30");
      await trasRecargar.getByRole("button", { name: "Guardar ajustes generales" }).click();
      await expect(trasRecargar.getByRole("alert")).toContainText("no pueden ser iguales");
    });

    test("salir cierra la sesión y las páginas protegidas piden entrar de nuevo", async () => {
      await ana.getByRole("button", { name: "Salir" }).click();
      await expect(ana).toHaveURL(/\/acceso/);
      await ana.goto(espacioUrl);
      await expect(ana).toHaveURL(/\/acceso/);
    });
  });
