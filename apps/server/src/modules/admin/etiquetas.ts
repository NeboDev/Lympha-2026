import type { EtiquetaEntregadaApi } from "@lympha/contracts";
import { etiquetaSvg, type NodoFabricado, nombreAp } from "../fabrica/index.ts";

/**
 * Lo que se entrega UNA vez al crear un lote o regenerar una etiqueta. Aquí viajan el código de reclamo, la clave
 * del AP y la contraseña MQTT en claro: este objeto va solo en la respuesta HTTP (con `cache-control: no-store`),
 * nunca a la base, a la auditoría ni a los logs.
 */
export function entregarEtiqueta(
  nodo: NodoFabricado,
  loteId: string,
  versionHw: string,
): EtiquetaEntregadaApi {
  return {
    device_id: nodo.deviceId,
    lote_id: loteId,
    codigo_reclamo: nodo.codigoReclamo,
    ap_key: nodo.apKey,
    red_ap: nombreAp(nodo.deviceId),
    mqtt_password: nodo.mqttPassword,
    svg: etiquetaSvg({
      deviceId: nodo.deviceId,
      codigoReclamo: nodo.codigoReclamo,
      loteId,
      versionHw,
      apKey: nodo.apKey,
    }),
  };
}
