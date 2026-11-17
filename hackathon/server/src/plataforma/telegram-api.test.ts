import { describe, expect, it } from "vitest";
import { crearClienteTelegram, ErrorTelegram } from "./telegram-api.ts";

const TOKEN = "123456789:AAH-token_secreto_de_prueba_0123456789abc";

function falso(respuestas: (Response | Error)[]) {
  const llamadas: { url: string; cuerpo: Record<string, unknown> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body ?? "{}")) });
    const r = respuestas.shift();
    if (r instanceof Error) throw r;
    return r ?? new Response(JSON.stringify({ ok: true, result: true }));
  }) as typeof fetch;
  return { llamadas, cliente: crearClienteTelegram(TOKEN, f) };
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

describe("enviarMensaje", () => {
  it("llama a sendMessage con el chat y el texto, sin vista previa de enlaces", async () => {
    const { cliente, llamadas } = falso([json({ ok: true, result: { message_id: 1 } })]);
    await cliente.enviarMensaje(-900, "hola «mundo» 🔶");
    expect(llamadas[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(llamadas[0]?.cuerpo).toMatchObject({
      chat_id: -900,
      text: "hola «mundo» 🔶",
      link_preview_options: { is_disabled: true },
    });
  });

  it("un error de Telegram trae código y descripción, sin token ni URL", async () => {
    const { cliente } = falso([
      json(
        { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
        403,
      ),
    ]);
    const e = await cliente.enviarMensaje(1, "x").catch((x) => x);
    expect(e).toBeInstanceOf(ErrorTelegram);
    expect(e.codigo).toBe(403);
    expect(e.descripcion).toBe("Forbidden: bot was blocked by the user");
    expect(String(e.message)).not.toContain(TOKEN);
  });

  it("el 429 trae cuánto esperar", async () => {
    const { cliente } = falso([
      json(
        {
          ok: false,
          error_code: 429,
          description: "Too Many Requests",
          parameters: { retry_after: 12 },
        },
        429,
      ),
    ]);
    const e = await cliente.enviarMensaje(1, "x").catch((x) => x);
    expect(e.codigo).toBe(429);
    expect(e.reintentarEnS).toBe(12);
  });

  it("si la red falla, el error es genérico y no filtra el token", async () => {
    const { cliente } = falso([
      new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`),
    ]);
    const e = await cliente.enviarMensaje(1, "x").catch((x) => x);
    expect(e).toBeInstanceOf(ErrorTelegram);
    expect(e.codigo).toBeUndefined();
    expect(String(e.message)).not.toContain(TOKEN);
    expect(JSON.stringify(e)).not.toContain(TOKEN);
  });

  it("una respuesta que no es JSON se trata como error con el código HTTP", async () => {
    const { cliente } = falso([new Response("<html>502</html>", { status: 502 })]);
    const e = await cliente.enviarMensaje(1, "x").catch((x) => x);
    expect(e.codigo).toBe(502);
  });
});

describe("obtenerActualizaciones", () => {
  it("pide getUpdates con offset y espera, y omite las actualizaciones malformadas", async () => {
    const { cliente, llamadas } = falso([
      json({
        ok: true,
        result: [
          { update_id: 10, message: { text: "/estado", chat: { id: 5, type: "private" } } },
          { sin: "update_id" },
          { update_id: 11 },
          { update_id: 12, message: { text: "x", chat: { id: "no-numero" } } },
        ],
      }),
    ]);
    const lote = await cliente.obtenerActualizaciones(10, 30);
    expect(llamadas[0]?.url).toContain("/getUpdates");
    expect(llamadas[0]?.cuerpo).toMatchObject({
      offset: 10,
      timeout: 30,
      allowed_updates: ["message"],
    });
    expect(lote.map((u) => u.update_id)).toEqual([10, 11]);
  });

  it("propaga el aborto sin convertirlo en un error de Telegram", async () => {
    const control = new AbortController();
    const f = (async (_u: string, init?: RequestInit) =>
      new Promise((_r, rechazar) => {
        init?.signal?.addEventListener("abort", () =>
          rechazar(new DOMException("abortado", "AbortError")),
        );
      })) as typeof fetch;
    const cliente = crearClienteTelegram(TOKEN, f);
    const p = cliente.obtenerActualizaciones(0, 30, control.signal).catch((e) => e);
    control.abort();
    const e = await p;
    expect(e).not.toBeInstanceOf(ErrorTelegram);
    expect(e.name).toBe("AbortError");
  });
});

describe("enviarDocumento", () => {
  function conFormulario(respuesta: Response | Error) {
    const llamadas: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      llamadas.push({ url: String(url), init });
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    }) as typeof fetch;
    return { llamadas, cliente: crearClienteTelegram(TOKEN, f) };
  }

  it("sube el archivo con sendDocument como multipart, con chat y leyenda", async () => {
    const { cliente, llamadas } = conFormulario(json({ ok: true, result: { message_id: 2 } }));
    const pdf = new TextEncoder().encode("%PDF-1.3 prueba");
    await cliente.enviarDocumento(-900, { nombre: "reporte-tinaco.pdf", contenido: pdf }, "Hola");

    expect(llamadas[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendDocument`);
    const cuerpo = llamadas[0]?.init?.body;
    expect(cuerpo).toBeInstanceOf(FormData);
    const f = cuerpo as FormData;
    expect(f.get("chat_id")).toBe("-900");
    expect(f.get("caption")).toBe("Hola");
    const archivo = f.get("document") as File;
    expect(archivo.name).toBe("reporte-tinaco.pdf");
    expect(archivo.type).toBe("application/pdf");
    expect(await archivo.text()).toBe("%PDF-1.3 prueba");
    // El content-type lo pone fetch con la frontera del multipart: no se fija a mano.
    expect(llamadas[0]?.init?.headers).toBeUndefined();
  });

  it("sin leyenda no manda el campo", async () => {
    const { cliente, llamadas } = conFormulario(json({ ok: true, result: true }));
    await cliente.enviarDocumento(1, { nombre: "a.pdf", contenido: new Uint8Array([1]) });
    const cuerpo = llamadas[0]?.init?.body;
    expect(cuerpo).toBeInstanceOf(FormData);
    expect((cuerpo as FormData).has("caption")).toBe(false);
  });

  it("los errores no filtran el token", async () => {
    const caida = conFormulario(new Error(`fallo en https://api.telegram.org/bot${TOKEN}/x`));
    const e1 = await caida.cliente
      .enviarDocumento(1, { nombre: "a.pdf", contenido: new Uint8Array([1]) })
      .catch((x) => x);
    expect(e1).toBeInstanceOf(ErrorTelegram);
    expect(e1.message).not.toContain(TOKEN);

    const rechazo = conFormulario(
      json({ ok: false, error_code: 403, description: "Forbidden: bot was kicked" }, 403),
    );
    const e2 = await rechazo.cliente
      .enviarDocumento(1, { nombre: "a.pdf", contenido: new Uint8Array([1]) })
      .catch((x) => x);
    expect(e2).toMatchObject({ codigo: 403, descripcion: "Forbidden: bot was kicked" });
  });
});

describe("otros métodos", () => {
  it("obtenerNombreBot devuelve el usuario sin @", async () => {
    const { cliente } = falso([json({ ok: true, result: { username: "lympha26_bot" } })]);
    expect(await cliente.obtenerNombreBot()).toBe("lympha26_bot");
  });

  it("obtenerNombreBot falla si el bot no tiene usuario", async () => {
    const { cliente } = falso([json({ ok: true, result: {} })]);
    await expect(cliente.obtenerNombreBot()).rejects.toThrow(/nombre de usuario/);
  });

  it("borrarWebhook llama a deleteWebhook conservando lo pendiente", async () => {
    const { cliente, llamadas } = falso([json({ ok: true, result: true })]);
    await cliente.borrarWebhook();
    expect(llamadas[0]?.url).toContain("/deleteWebhook");
    expect(llamadas[0]?.cuerpo).toEqual({ drop_pending_updates: false });
  });
});
