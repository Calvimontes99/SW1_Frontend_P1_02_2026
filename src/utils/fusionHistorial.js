/**
 * Junta lo que ya se ve (mensajes, propuestas, cambios) con una respuesta del servidor que llega
 * TARDE: mientras se esperaba, pudieron llegar elementos nuevos en vivo, y reemplazar la lista
 * entera los hacía desaparecer.
 *
 * - Lo recibido en vivo mientras se esperaba gana (es más nuevo que la respuesta).
 * - Lo de la respuesta reemplaza la versión vieja de un mismo id (trae datos completados después,
 *   como el id de la propuesta de un mensaje de la IA) y agrega lo que faltaba.
 * - descartarPrevios: la respuesta reemplaza lo que había (se perdió la continuidad), salvo lo
 *   recibido en vivo.
 * @param {Set} vivos  ids recibidos en vivo desde que se pidió la respuesta
 */
export const fusionarPorId = (previos, respuesta, vivos = new Set(), { descartarPrevios = false } = {}) => {
  const porId = new Map();
  for (const x of previos || []) if (!descartarPrevios || vivos.has(x.id)) porId.set(x.id, x);
  for (const x of respuesta || []) if (!vivos.has(x.id) || !porId.has(x.id)) porId.set(x.id, x);
  return [...porId.values()].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
};

/**
 * Desde qué id pedir al reconectar: después del último mensaje, salvo que haya un mensaje de la
 * IA cuya propuesta todavía no tenía id (la IA lo completa enseguida): se pide desde antes de él
 * para recibir su versión completa aunque el servidor no informe cambios por marca de tiempo.
 */
export const cursorParaReanudar = (mensajes) => {
  if (!mensajes || !mensajes.length) return undefined;
  const incompleto = mensajes.find((m) => m.tipo === 'ia' && m.datos?.propuesta && !m.datos.propuesta.id);
  const ultimo = mensajes[mensajes.length - 1].id;
  return incompleto ? Math.min(ultimo, Number(incompleto.id) - 1) : ultimo;
};

export default fusionarPorId;
