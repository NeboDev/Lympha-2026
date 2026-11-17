/** Lo único que el servidor toma de un token de Firebase. */
export type IdentidadVerificada = {
  /** El `uid` de Firebase: es el id de la persona en todo Atl (miembros, autoría). */
  uid: string;
  correo: string;
  nombre: string | null;
};

export interface VerificadorToken {
  /** Lanza si el token es inválido, está vencido, no es del proyecto o el correo no está verificado. */
  verificar(token: string): Promise<IdentidadVerificada>;
}

export type Usuario = IdentidadVerificada & {
  /** `true` para el usuario de demostración fijo (plan B del evento). */
  demo: boolean;
};

export interface AlmacenUsuarios {
  /** Crea al usuario la primera vez que entra y actualiza su nombre y correo si cambiaron. */
  registrar(usuario: IdentidadVerificada, ahora: Date): Promise<void>;
}
