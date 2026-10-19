import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cursorParaReanudar, fusionarPorId } from '../utils/fusionHistorial.js';
import { anterioresPorCanal, canalDe } from '../utils/canalesChat.js';

/**
 * Chats de la sala (el del equipo y el de la IA compartida): mensajes de todos, propuestas de cambios de la IA,
 * estado de la IA ("atendiendo a…"), historial de quién hizo cada cambio y el resumen de lo
 * que pasó desde la última visita. Todo llega por el mismo socket del tablero.
 * Los mensajes de los dos chats van en una sola lista (cada uno con su `canal`); lo que se pagina
 * y lo que se cuenta como "sin leer" va por canal.
 */
export const useColaboracion = (socket, salaId) => {
  const [mensajes, setMensajes] = useState([]);
  const [propuestas, setPropuestas] = useState([]);
  const [estadoIA, setEstadoIA] = useState({ ocupada: false, atendiendoA: null, enCola: 0 });
  const [cambios, setCambios] = useState([]);
  const [bienvenida, setBienvenida] = useState(null);
  const [cargado, setCargado] = useState(false);
  const [sinLeer, setSinLeer] = useState({ equipo: 0, ia: 0 });
  const [hayAnteriores, setHayAnteriores] = useState({ equipo: false, ia: false });

  const ponerMensaje = useCallback((m) => {
    setMensajes((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i >= 0) { const copia = [...prev]; copia[i] = m; return copia; }
      return [...prev, m];
    });
  }, []);
  const ponerPropuesta = useCallback((p) => {
    setPropuestas((prev) => {
      const i = prev.findIndex((x) => x.id === p.id);
      if (i >= 0) { const copia = [...prev]; copia[i] = p; return copia; }
      return [...prev, p];
    });
  }, []);

  // Lo último que se tiene: al reconectar se pide solo lo posterior (sin dejar huecos)
  const mensajesRef = useRef(mensajes);
  mensajesRef.current = mensajes;
  const cambiosRef = useRef(cambios);
  cambiosRef.current = cambios;
  const salaCargadaRef = useRef(null);
  // Hora del servidor de la última respuesta: al reconectar se piden también los mensajes que
  // cambiaron desde entonces (no solo los nuevos)
  const marcaRef = useRef(null);

  useEffect(() => {
    if (!socket || !salaId) return undefined;
    // Otro tablero: se empieza de cero (lo anterior no se fusiona con lo de esta sala)
    if (salaCargadaRef.current !== salaId) {
      salaCargadaRef.current = salaId;
      mensajesRef.current = [];
      cambiosRef.current = [];
      marcaRef.current = null;
      setMensajes([]); setPropuestas([]); setCambios([]); setBienvenida(null);
      setHayAnteriores({ equipo: false, ia: false }); setSinLeer({ equipo: 0, ia: 0 });
    }
    // Respuestas de una conexión o sala anterior se ignoran
    let vigente = true;
    // Lo que llega en vivo mientras se esperan las respuestas no lo pisa una respuesta tardía
    const vivos = { mensajes: new Set(), propuestas: new Set(), cambios: new Set() };
    const alNuevo = (m) => {
      vivos.mensajes.add(m.id);
      ponerMensaje(m);
      const canal = canalDe(m);
      setSinLeer((n) => ({ ...n, [canal]: n[canal] + 1 }));
    };
    const alActualizado = (m) => { vivos.mensajes.add(m.id); ponerMensaje(m); };
    const alPropuesta = (p) => { vivos.propuestas.add(p.id); ponerPropuesta(p); };
    const alHistorial = (c) => {
      vivos.cambios.add(c.id);
      setCambios((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c].slice(-300)));
    };
    socket.on('chat:nuevo', alNuevo);
    socket.on('chat:actualizado', alActualizado);
    socket.on('propuesta:nueva', alPropuesta);
    socket.on('propuesta:actualizada', alPropuesta);
    socket.on('ia:estado', setEstadoIA);
    socket.on('historial:nuevo', alHistorial);
    socket.on('chat:bienvenida', setBienvenida);

    const pedirMensajes = (despuesDe) => {
      const actualizadosDesde = despuesDe !== undefined ? marcaRef.current : null;
      socket.emit('chat:historial', { salaId, despuesDe, actualizadosDesde }, (r) => {
        if (!vigente || !r?.ok) return;
        if (r.reanudacion && !r.completo) { pedirMensajes(undefined); return; } // faltan demasiados: desde los últimos
        if (r.marca) marcaRef.current = r.marca;
        setMensajes((prev) => fusionarPorId(prev, r.mensajes || [], vivos.mensajes, { descartarPrevios: !r.reanudacion }));
        if (!r.reanudacion) setHayAnteriores(anterioresPorCanal(r));
        setPropuestas((prev) => fusionarPorId(prev, r.propuestas || [], vivos.propuestas));
        if (r.ia) setEstadoIA(r.ia);
        setCargado(true);
      });
    };
    const pedirCambios = (despuesDe) => {
      socket.emit('historial:listar', { salaId, despuesDe }, (r) => {
        if (!vigente || !r?.ok) return;
        if (r.reanudacion && !r.completo) { pedirCambios(undefined); return; }
        setCambios((prev) => fusionarPorId(prev, r.cambios || [], vivos.cambios, { descartarPrevios: !r.reanudacion }).slice(-300));
      });
    };
    pedirMensajes(cursorParaReanudar(mensajesRef.current));
    pedirCambios(cambiosRef.current.length ? cambiosRef.current[cambiosRef.current.length - 1].id : undefined);

    return () => {
      vigente = false;
      socket.off('chat:nuevo', alNuevo);
      socket.off('chat:actualizado', alActualizado);
      socket.off('propuesta:nueva', alPropuesta);
      socket.off('propuesta:actualizada', alPropuesta);
      socket.off('ia:estado', setEstadoIA);
      socket.off('historial:nuevo', alHistorial);
      socket.off('chat:bienvenida', setBienvenida);
    };
  }, [socket, salaId, ponerMensaje, ponerPropuesta]);

  /** @param {{ajusta?: number}} extras  ajusta: id de la propuesta que se pide ajustar */
  const enviar = useCallback((texto, paraIA = false, extras = {}) => new Promise((resolve) => {
    if (!socket) { resolve({ ok: false, mensaje: 'Sin conexión con el servidor.' }); return; }
    socket.emit('chat:enviar', { salaId, texto, paraIA, ajusta: extras.ajusta || null }, (r) => resolve(r || { ok: false }));
  }), [socket, salaId]);

  /** Foto o audio para la IA: va por HTTP (el socket no está pensado para archivos grandes). */
  const enviarAdjunto = useCallback(async ({ texto = '', imagen = null, audio = null, paraIA = true }) => {
    const datos = new FormData();
    datos.append('texto', texto);
    datos.append('paraIA', String(paraIA));
    if (imagen) datos.append('imagen', imagen, imagen.name || 'imagen.jpg');
    if (audio) datos.append('audio', audio, audio.name || 'audio.webm');
    const base = import.meta.env.VITE_WS_URL || window.location.origin;
    const cabeceras = {};
    try { const token = localStorage.getItem('token'); if (token) cabeceras.Authorization = `Bearer ${token}`; } catch { /* noop */ }
    try {
      const res = await fetch(`${base}/apis/colaboracion/${salaId}/mensajes`, { method: 'POST', body: datos, credentials: 'include', headers: cabeceras });
      const cuerpo = await res.json().catch(() => null);
      return res.ok ? { ok: true, mensaje: cuerpo?.data } : { ok: false, mensaje: cuerpo?.message || 'No se pudo enviar el archivo.' };
    } catch {
      return { ok: false, mensaje: 'Sin conexión con el servidor.' };
    }
  }, [salaId]);

  /** Trae los mensajes de un chat ('equipo' | 'ia') anteriores al más viejo que se ve de ese chat. */
  const cargarAnteriores = useCallback((canal) => new Promise((resolve) => {
    const primero = mensajes.find((m) => canalDe(m) === canal);
    if (!socket || !primero) { resolve(false); return; }
    socket.emit('chat:anteriores', { salaId, canal, antesDe: primero.id }, (r) => {
      if (r?.ok) {
        // Se ordena por id: los anteriores de un chat pueden quedar entre mensajes del otro
        setMensajes((prev) => fusionarPorId(prev, (r.mensajes || []).filter((m) => !prev.some((x) => x.id === m.id))));
        setHayAnteriores((h) => ({ ...h, [canal]: !!r.hayMas }));
      }
      resolve(!!r?.ok);
    });
  }), [socket, salaId, mensajes]);

  const decidir = useCallback((propuestaId, decision) => new Promise((resolve) => {
    if (!socket) { resolve({ ok: false, mensaje: 'Sin conexión con el servidor.' }); return; }
    socket.emit('propuesta:decidir', { salaId, propuestaId, decision }, (r) => resolve(r || { ok: false }));
  }), [socket, salaId]);

  /** La propuesta pendiente más reciente: es la que se muestra en la pizarra. */
  const propuestaPendiente = useMemo(
    () => [...propuestas].reverse().find((p) => p.estado === 'pendiente') || null,
    [propuestas],
  );

  /** La última revisión de la IA con observaciones sobre clases (para marcarlas en la pizarra). */
  const ultimaRevision = useMemo(
    () => [...mensajes].reverse().find((m) => m.tipo === 'ia' && m.datos?.observaciones?.length) || null,
    [mensajes],
  );

  return {
    mensajes, propuestas, propuestaPendiente, ultimaRevision, estadoIA, cambios, bienvenida, cargado, sinLeer,
    hayAnteriores, enviar, enviarAdjunto, cargarAnteriores, decidir, cerrarBienvenida: () => setBienvenida(null),
    // Sin canal: los dos chats
    marcarLeidos: (canal) => setSinLeer((n) => (canal ? { ...n, [canal]: 0 } : { equipo: 0, ia: 0 })),
  };
};

export default useColaboracion;
