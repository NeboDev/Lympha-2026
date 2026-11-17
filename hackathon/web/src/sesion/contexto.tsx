import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Cliente } from "../api/cliente.ts";
import { crearCliente } from "../api/cliente.ts";
import { CONFIG } from "../config.ts";
import {
  type AccesoGoogle,
  crearAccesoGoogle,
  ErrorAcceso,
  type PersonaSesion,
} from "./firebase.ts";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "fuera" }
  | { tipo: "dentro"; persona: PersonaSesion; demo: boolean };

export type Sesion = {
  estado: Estado;
  /** Cliente de la API ya autenticado. */
  api: Cliente;
  puedeGoogle: boolean;
  /** Por qué se volvió a la pantalla de entrada tras haber iniciado sesión (el servidor rechazó la cuenta), o `null`. */
  motivo: string | null;
  puedeDemo: boolean;
  entrarConGoogle(): Promise<string | null>;
  entrarDemo(): void;
  salir(): Promise<void>;
};

const Contexto = createContext<Sesion | null>(null);

const CLAVE_DEMO = "atl.demo";

export const MOTIVO_RECHAZO =
  "Iniciaste sesión con Google, pero el servidor de Atl no aceptó tu cuenta. Quien administra Atl debe revisar que el servidor use el mismo FIREBASE_PROJECT_ID que esta web (el registro del servidor dice el motivo).";

/** `sessionStorage` puede fallar (modo privado, datos bloqueados): la web debe seguir funcionando sin él. */
const leerDemo = (): boolean => {
  try {
    return sessionStorage.getItem(CLAVE_DEMO) === "1";
  } catch {
    return false;
  }
};
const guardarDemo = (si: boolean) => {
  try {
    if (si) sessionStorage.setItem(CLAVE_DEMO, "1");
    else sessionStorage.removeItem(CLAVE_DEMO);
  } catch {
    // Sin almacenamiento, la sesión de demostración dura lo que dure la pestaña abierta.
  }
};

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const acceso = useMemo<AccesoGoogle | null>(
    () => (CONFIG.firebase ? crearAccesoGoogle(CONFIG.firebase) : null),
    [],
  );
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const demoRef = useRef(false);
  const [motivo, setMotivo] = useState<string | null>(null);

  useEffect(() => {
    if (CONFIG.demoToken && leerDemo()) {
      demoRef.current = true;
      setEstado({
        tipo: "dentro",
        demo: true,
        persona: { uid: "demo", nombre: "Usuario de demostración", correo: null },
      });
      return;
    }
    if (!acceso) {
      setEstado({ tipo: "fuera" });
      return;
    }
    return acceso.alCambiar((persona) => {
      if (demoRef.current) return;
      setEstado(persona ? { tipo: "dentro", persona, demo: false } : { tipo: "fuera" });
    });
  }, [acceso]);

  const salir = useCallback(async () => {
    guardarDemo(false);
    demoRef.current = false;
    if (acceso) await acceso.salir().catch(() => undefined);
    setEstado({ tipo: "fuera" });
  }, [acceso]);

  const api = useMemo(
    () =>
      crearCliente({
        baseUrl: CONFIG.apiUrl,
        obtenerToken: async () =>
          demoRef.current ? CONFIG.demoToken : ((await acceso?.obtenerToken()) ?? null),
        // La API dice que la sesión ya no vale: se vuelve a la pantalla de entrada.
        alNoAutenticado: () => {
          if (!demoRef.current) setMotivo(MOTIVO_RECHAZO);
          void salir();
        },
      }),
    [acceso, salir],
  );

  const sesion = useMemo<Sesion>(
    () => ({
      estado,
      api,
      puedeGoogle: acceso !== null,
      motivo,
      puedeDemo: CONFIG.demoToken !== null,
      async entrarConGoogle() {
        if (!acceso) return "Falta configurar Firebase.";
        setMotivo(null);
        try {
          await acceso.entrar();
          return null;
        } catch (e) {
          return e instanceof ErrorAcceso
            ? e.message
            : "No pudimos iniciar sesión. Inténtalo de nuevo.";
        }
      },
      entrarDemo() {
        if (!CONFIG.demoToken) return;
        guardarDemo(true);
        demoRef.current = true;
        setMotivo(null);
        setEstado({
          tipo: "dentro",
          demo: true,
          persona: { uid: "demo", nombre: "Usuario de demostración", correo: null },
        });
      },
      salir,
    }),
    [estado, api, acceso, salir, motivo],
  );

  return <Contexto.Provider value={sesion}>{children}</Contexto.Provider>;
}

export function useSesion(): Sesion {
  const s = useContext(Contexto);
  if (!s) throw new Error("useSesion debe usarse dentro de <ProveedorSesion>");
  return s;
}
