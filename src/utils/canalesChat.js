/**
 * Cada sala tiene dos chats: 'equipo' (entre personas) e 'ia' (lo que se le pide a la IA, lo que
 * responde, sus propuestas y los avisos). El servidor manda el canal de cada mensaje; para
 * mensajes viejos sin canal se deduce con la misma regla que usa el servidor.
 */
export const CANALES = ['equipo', 'ia'];

export const canalDe = (m) => m?.canal || (m?.tipo !== 'usuario' || m?.datos?.paraIA ? 'ia' : 'equipo');

/** ¿El texto le habla a la IA? (misma regla que el servidor: @IA en cualquier parte) */
export const mencionaALaIA = (texto) => /(^|\s)@ia\b/i.test(String(texto || ''));

/** Por canal: si quedan mensajes anteriores sin cargar (respuesta nueva o, si no la trae, por cantidad). */
export const anterioresPorCanal = (respuesta, porCanal = 80) => {
  if (respuesta?.hayAnteriores && typeof respuesta.hayAnteriores === 'object') {
    return { equipo: !!respuesta.hayAnteriores.equipo, ia: !!respuesta.hayAnteriores.ia };
  }
  const lista = respuesta?.mensajes || [];
  return Object.fromEntries(CANALES.map((c) => [c, lista.filter((m) => canalDe(m) === c).length >= porCanal]));
};

export default canalDe;
