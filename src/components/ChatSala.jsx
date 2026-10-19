import { useEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import { canalDe, mencionaALaIA } from '../utils/canalesChat.js';

/**
 * Chats de la sala, en un mismo panel flotante: el del equipo (entre personas) y el de la IA
 * compartida, un integrante más. En el de la IA todos ven todo: lo que se le pide, lo que
 * responde y lo que propone. Los cambios de la IA llegan como propuesta, que
 * cualquiera acepta o rechaza. También muestra el historial de quién hizo cada cambio.
 */

const hora = (fecha) => new Date(fecha).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
const diaYHora = (fecha) => new Date(fecha).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Markdown mínimo y seguro (sin HTML): **negrita**, `código`, listas con "-" y saltos de línea. */
const Texto = ({ texto }) => {
  const enLinea = (linea, k) => linea.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((parte, i) => {
    if (/^\*\*[^*]+\*\*$/.test(parte)) return <strong key={`${k}-${i}`}>{parte.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(parte)) return <code key={`${k}-${i}`} className="px-1 rounded bg-black/5 text-[0.85em]">{parte.slice(1, -1)}</code>;
    return parte;
  });
  return (
    <div className="space-y-0.5 break-words">
      {String(texto || '').split('\n').map((linea, i) => {
        const item = linea.match(/^\s*[-*•]\s+(.*)/);
        if (item) return <div key={i} className="pl-3 relative"><span className="absolute left-0">•</span>{enLinea(item[1], i)}</div>;
        return <div key={i} className={linea.trim() ? '' : 'h-2'}>{enLinea(linea, i)}</div>;
      })}
    </div>
  );
};

const COLOR_GRAVEDAD = { error: 'text-red-700 bg-red-50 border-red-200', aviso: 'text-amber-800 bg-amber-50 border-amber-200', sugerencia: 'text-blue-800 bg-blue-50 border-blue-200' };
const ESTADO_PROPUESTA = {
  pendiente: ['Pendiente: decide el equipo', 'bg-amber-100 text-amber-900'],
  aceptada: ['Aceptada', 'bg-green-100 text-green-800'],
  rechazada: ['Rechazada', 'bg-gray-200 text-gray-700'],
  desactualizada: ['Desactualizada', 'bg-red-100 text-red-800'],
  reemplazada: ['Reemplazada por un ajuste', 'bg-gray-200 text-gray-700'],
  aplicando: ['Aplicando…', 'bg-blue-100 text-blue-800'],
};

const TarjetaPropuesta = ({ propuesta, onDecidir, onAjustar }) => {
  const [enviando, setEnviando] = useState(false);
  if (!propuesta) return null;
  const [etiqueta, color] = ESTADO_PROPUESTA[propuesta.estado] || ESTADO_PROPUESTA.pendiente;
  const decidir = async (decision) => {
    setEnviando(true);
    const r = await onDecidir(propuesta.id, decision);
    setEnviando(false);
    if (!r?.ok && r?.mensaje) Swal.fire({ icon: 'info', title: 'No se aplicó', text: r.mensaje });
  };
  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-white p-2 text-xs">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-semibold text-violet-800">Propuesta: {propuesta.resumen?.length || 0} cambio{propuesta.resumen?.length === 1 ? '' : 's'}</span>
        <span className={`px-1.5 py-0.5 rounded ${color}`}>{etiqueta}</span>
      </div>
      <ul className="space-y-0.5 text-gray-700">
        {(propuesta.resumen || []).map((r, i) => <li key={i}>• {r}</li>)}
      </ul>
      {propuesta.estado === 'pendiente' ? (
        <>
          <p className="mt-1 text-[11px] text-gray-500">Se ve en la pizarra con borde punteado. Cualquiera del equipo puede decidir.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button disabled={enviando} onClick={() => decidir('aceptar')} className="px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Aceptar</button>
            <button disabled={enviando} onClick={() => decidir('rechazar')} className="px-2 py-1 rounded bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-50">Rechazar</button>
            <button disabled={enviando} onClick={() => onAjustar(propuesta.id)} className="px-2 py-1 rounded border border-violet-300 text-violet-800 hover:bg-violet-50">Pedir ajuste</button>
          </div>
        </>
      ) : (
        propuesta.decididoPorNombre && (
          <p className="mt-1 text-[11px] text-gray-500">
            {etiqueta} por {propuesta.decididoPorNombre}{propuesta.motivo ? `: ${propuesta.motivo}` : ''}
          </p>
        )
      )}
    </div>
  );
};

const Mensaje = ({ m, propio, propuesta, onDecidir, onAjustar, onEnfocarClase, onQuitarMarcas, onAplicarIdea }) => {
  if (m.tipo === 'sistema') {
    return <div className="text-center text-[11px] text-gray-500 px-4 py-1"><Texto texto={m.texto} /></div>;
  }
  const esIA = m.tipo === 'ia';
  const d = m.datos || {};
  return (
    <div className={`flex ${propio ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-xl px-3 py-2 text-sm shadow-sm ${esIA ? 'bg-violet-50 border border-violet-200' : propio ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200'}`}>
        <div className={`flex items-center gap-2 text-[11px] mb-0.5 ${propio ? 'text-blue-100' : 'text-gray-500'}`}>
          <span className="font-semibold">{esIA ? '🤖 IA' : propio ? 'Tú' : m.autorNombre}</span>
          <span>{hora(m.creadoEn)}</span>
          {esIA && d.proveedor && <span className="px-1 rounded bg-violet-100 text-violet-700">{d.proveedor}</span>}
          {!esIA && d.paraIA && <span className={`px-1 rounded ${propio ? 'bg-blue-500' : 'bg-violet-100 text-violet-700'}`}>para la IA</span>}
          {!esIA && d.imagen && <span title={d.imagen.nombre}>📷</span>}
          {!esIA && d.deAudio && <span title="Transcrito de un audio">🎙️</span>}
          {!esIA && d.ajusta && <span className={propio ? 'text-blue-100' : 'text-violet-700'}>ajuste</span>}
        </div>
        <Texto texto={m.texto} />
        {esIA && d.observaciones?.length > 0 && (
          <ul className="mt-2 space-y-1">
            {d.observaciones.map((o, i) => (
              <li key={i}>
                <button
                  onClick={() => o.nodoId && onEnfocarClase(o.nodoId)}
                  className={`w-full text-left text-xs border rounded px-2 py-1 ${COLOR_GRAVEDAD[o.gravedad] || COLOR_GRAVEDAD.aviso} ${o.nodoId ? 'hover:brightness-95' : 'cursor-default'}`}
                  title={o.nodoId ? 'Ver la clase en la pizarra' : undefined}
                >
                  <strong>{o.clase || 'General'}</strong>: {o.texto}
                </button>
              </li>
            ))}
            <li><button onClick={onQuitarMarcas} className="text-[11px] text-gray-500 underline">Quitar las marcas de la pizarra</button></li>
          </ul>
        )}
        {esIA && d.ideas?.length > 0 && (
          <ul className="mt-2 space-y-1">
            {d.ideas.map((idea, i) => (
              <li key={i} className="text-xs bg-sky-50 border border-sky-200 rounded px-2 py-1">
                💡 <strong>{idea.titulo}</strong> {idea.texto}
                <button onClick={() => onAplicarIdea(idea)} className="ml-1 text-violet-700 underline" title="La IA arma una propuesta con esta idea">Aplicar idea</button>
              </li>
            ))}
            <li className="text-[11px] text-gray-500">Quedaron como notas celestes en la pizarra.</li>
          </ul>
        )}
        {esIA && d.propuesta && <TarjetaPropuesta propuesta={propuesta} onDecidir={onDecidir} onAjustar={onAjustar} />}
      </div>
    </div>
  );
};

const SUGERENCIAS = [
  ['Revisar el diagrama', 'Revisa el diagrama completo y dime qué corregir'],
  ['¿Qué hicieron?', '¿Qué hizo cada uno hoy en el diagrama?'],
  ['Ideas', 'Dame ideas para mejorar este diseño'],
];

const Historial = ({ cambios }) => {
  const [autor, setAutor] = useState('');
  const autores = useMemo(() => [...new Set(cambios.map((c) => (c.esIA ? 'IA' : c.autorNombre)).filter(Boolean))], [cambios]);
  const lista = [...cambios].reverse().filter((c) => !autor || (autor === 'IA' ? c.esIA : c.autorNombre === autor && !c.esIA));
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <select value={autor} onChange={(e) => setAutor(e.target.value)} className="w-full text-xs border rounded px-2 py-1 bg-white">
        <option value="">Todos los integrantes</option>
        {autores.map((a) => <option key={a} value={a}>{a === 'IA' ? '🤖 IA' : a}</option>)}
      </select>
      {!lista.length && <p className="text-xs text-gray-500 text-center mt-6">Todavía no hay cambios registrados.</p>}
      {lista.map((c) => (
        <div key={c.id} className="text-xs border-l-2 pl-2 py-0.5" style={{ borderColor: c.esIA ? '#8b5cf6' : '#3b82f6' }}>
          <div className="text-gray-500">{diaYHora(c.creadoEn)}</div>
          <div>
            <strong>{c.esIA ? '🤖 IA' : c.autorNombre}</strong>
            {c.esIA && <span className="text-gray-500"> (pedido por {c.pedidoPor}{c.aprobadoPor ? `, aprobado por ${c.aprobadoPor}` : ''})</span>}
            {' '}{c.resumen}
          </div>
        </div>
      ))}
    </div>
  );
};

/** Dictado con el reconocimiento de voz del navegador (Chrome/Edge). */
const useDictado = (alTexto) => {
  const [escuchando, setEscuchando] = useState(false);
  const reconocedorRef = useRef(null);
  const disponible = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const alternar = () => {
    if (!disponible) {
      Swal.fire({ icon: 'info', title: 'Dictado no disponible', text: 'Este navegador no permite dictar. Usa Chrome o Edge, o el botón de voz de la burbuja de IA.' });
      return;
    }
    if (escuchando) { reconocedorRef.current?.stop(); return; }
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new R();
    rec.lang = 'es-ES';
    rec.interimResults = false;
    rec.onresult = (e) => alTexto(Array.from(e.results).map((r) => r[0].transcript).join(' '));
    rec.onend = () => setEscuchando(false);
    rec.onerror = () => setEscuchando(false);
    reconocedorRef.current = rec;
    setEscuchando(true);
    rec.start();
  };
  return { escuchando, alternar };
};

/** Grabar audio con el micrófono (se transcribe en el servidor con la IA). */
const useGrabadora = (alTerminar) => {
  const [grabando, setGrabando] = useState(false);
  const grabadoraRef = useRef(null);
  const alternar = async () => {
    if (grabando) { grabadoraRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      Swal.fire({ icon: 'info', title: 'Grabación no disponible', text: 'Este navegador no permite grabar audio. Sube un archivo de audio o usa el dictado 🎤.' });
      return;
    }
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
      const grabadora = new MediaRecorder(flujo);
      const partes = [];
      grabadora.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
      grabadora.onstop = () => {
        flujo.getTracks().forEach((pista) => pista.stop());
        setGrabando(false);
        const tipo = grabadora.mimeType || 'audio/webm';
        alTerminar(new File(partes, `audio-${Date.now()}.webm`, { type: tipo }));
      };
      grabadoraRef.current = grabadora;
      grabadora.start();
      setGrabando(true);
    } catch {
      Swal.fire({ icon: 'error', title: 'Sin micrófono', text: 'No se pudo usar el micrófono. Revisa el permiso del navegador.' });
    }
  };
  return { grabando, alternar };
};

/** Pestañas del panel: los dos chats de la sala y el historial de cambios. */
const PESTANAS = [
  ['equipo', '👥 Equipo'],
  ['ia', '🤖 IA del equipo'],
  ['historial', '🕑 Quién hizo qué'],
];

export default function ChatSala({ colaboracion, currentUser, onEnfocarClase, onQuitarMarcas, abierto, setAbierto }) {
  const {
    mensajes, propuestas, estadoIA, cambios, bienvenida, sinLeer, hayAnteriores,
    enviar, enviarAdjunto, cargarAnteriores, decidir, cerrarBienvenida, marcarLeidos,
  } = colaboracion;
  const [pestana, setPestana] = useState('equipo');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Propuesta que se está ajustando y archivo adjunto (foto o audio) del próximo mensaje
  const [ajustando, setAjustando] = useState(null);
  const [adjunto, setAdjunto] = useState(null);
  const archivoRef = useRef(null);
  const grabadora = useGrabadora((archivo) => setAdjunto({ tipo: 'audio', archivo }));
  const finRef = useRef(null);
  const entradaRef = useRef(null);
  const dictado = useDictado((t) => setTexto((prev) => `${prev ? `${prev} ` : ''}${t}`));
  const propuestaPorId = useMemo(() => new Map(propuestas.map((p) => [p.id, p])), [propuestas]);
  const enChat = pestana === 'equipo' || pestana === 'ia';
  const deIA = pestana === 'ia';
  const visibles = useMemo(() => (enChat ? mensajes.filter((m) => canalDe(m) === pestana) : []), [mensajes, pestana, enChat]);
  const totalSinLeer = (sinLeer.equipo || 0) + (sinLeer.ia || 0);

  // Lo que se ve queda leído; lo del otro chat sigue contando en su pestaña
  useEffect(() => { if (abierto && enChat) marcarLeidos(pestana); }, [abierto, pestana, visibles.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (abierto && enChat) finRef.current?.scrollIntoView({ block: 'end' }); }, [abierto, pestana, visibles.length, estadoIA.ocupada]); // eslint-disable-line react-hooks/exhaustive-deps
  // Si alguien escribe o la IA responde mientras está cerrado, el contador avisa
  useEffect(() => { if (bienvenida) setAbierto(true); }, [bienvenida]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiarPestana = (p) => {
    setPestana(p);
    // Una foto o un ajuste son solo para la IA: no se arrastran al chat del equipo
    if (p !== 'ia') { setAjustando(null); if (adjunto?.tipo === 'imagen') setAdjunto(null); }
  };

  const mandar = async () => {
    const limpio = texto.trim();
    if ((!limpio && !adjunto) || enviando) return;
    // En el chat del equipo, mencionar a @IA también le pide algo (el mensaje va al chat de la IA)
    const paraIA = deIA || mencionaALaIA(limpio);
    setEnviando(true);
    const r = adjunto
      ? await enviarAdjunto({ texto: limpio, paraIA, [adjunto.tipo === 'imagen' ? 'imagen' : 'audio']: adjunto.archivo })
      : await enviar(limpio, paraIA || !!ajustando, { ajusta: ajustando });
    setEnviando(false);
    if (r?.ok) {
      setTexto('');
      setAdjunto(null);
      setAjustando(null);
      if (paraIA && !deIA) setPestana('ia');
    } else Swal.fire({ icon: 'error', title: 'No se envió', text: r?.mensaje || 'Revisa tu conexión.' });
  };

  // "Pedir ajuste": el próximo mensaje rehace esa propuesta (la anterior queda reemplazada)
  const ajustar = (propuestaId) => {
    setAjustando(propuestaId);
    setPestana('ia');
    setTimeout(() => entradaRef.current?.focus(), 50);
  };

  const aplicarIdea = async (idea) => {
    const r = await enviar(`Aplica esta idea en el diagrama: ${idea.titulo ? `${idea.titulo}: ` : ''}${idea.texto}`, true);
    if (!r?.ok) Swal.fire({ icon: 'error', title: 'No se envió', text: r?.mensaje || 'Revisa tu conexión.' });
  };

  const elegirArchivo = (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (archivo.size > 10 * 1024 * 1024) {
      Swal.fire({ icon: 'info', title: 'Archivo muy grande', text: 'El máximo es 10 MB.' });
      return;
    }
    setAdjunto({ tipo: archivo.type.startsWith('audio/') ? 'audio' : 'imagen', archivo });
  };

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="fixed right-4 top-36 z-30 flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm text-white shadow-lg hover:bg-violet-700"
        title="Chat del equipo y chat con la IA del equipo"
        data-tour="chat-sala"
      >
        💬 Equipo + 🤖 IA
        {estadoIA.ocupada && <span className="animate-pulse">…</span>}
        {totalSinLeer > 0 && <span className="rounded-full bg-white px-1.5 text-xs font-bold text-violet-700">{totalSinLeer}</span>}
      </button>
    );
  }

  return (
    <div className="fixed right-4 top-36 bottom-24 z-30 flex w-[min(92vw,24rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-2xl" data-tour="chat-sala">
      <div className="flex items-center justify-between gap-1 bg-violet-600 px-2 py-2 text-white">
        <div className="flex flex-wrap gap-1 text-xs" role="tablist">
          {PESTANAS.map(([id, etiqueta]) => (
            <button
              key={id}
              role="tab"
              aria-selected={pestana === id}
              onClick={() => cambiarPestana(id)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 ${pestana === id ? 'bg-white/25' : 'hover:bg-white/10'}`}
            >
              {etiqueta}
              {id === 'ia' && estadoIA.ocupada && <span className="animate-pulse">…</span>}
              {sinLeer[id] > 0 && pestana !== id && <span className="rounded-full bg-white px-1.5 text-[10px] font-bold text-violet-700">{sinLeer[id]}</span>}
            </button>
          ))}
        </div>
        <button onClick={() => setAbierto(false)} className="rounded px-2 hover:bg-white/10" aria-label="Cerrar chat">✕</button>
      </div>

      {pestana === 'historial' ? <Historial cambios={cambios} /> : (
        <>
          {bienvenida && (
            <div className="m-2 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
              <div className="flex justify-between gap-2">
                <Texto texto={bienvenida.texto} />
                <button onClick={cerrarBienvenida} className="self-start text-sky-700" aria-label="Cerrar resumen">✕</button>
              </div>
            </div>
          )}
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {hayAnteriores[pestana] && (
              <div className="text-center">
                <button onClick={() => cargarAnteriores(pestana)} className="text-xs text-violet-700 underline">Cargar mensajes anteriores</button>
              </div>
            )}
            {!visibles.length && (deIA ? (
              <div className="mt-6 text-center text-xs text-gray-500">
                <p className="text-2xl">🤖</p>
                <p className="mt-1">La IA es un integrante más del equipo: todos ven lo que le piden y lo que responde.</p>
                <p className="mt-1">Sus cambios llegan como propuesta que el equipo acepta o rechaza.</p>
              </div>
            ) : (
              <div className="mt-6 text-center text-xs text-gray-500">
                <p className="text-2xl">👥</p>
                <p className="mt-1">Chat entre los integrantes de la sala. La IA no interviene aquí.</p>
                <p className="mt-1">Para pedirle algo, usa la pestaña <strong>🤖 IA del equipo</strong> o escribe <strong>@IA</strong>.</p>
              </div>
            ))}
            {visibles.map((m) => (
              <Mensaje
                key={m.id}
                m={m}
                propio={m.tipo === 'usuario' && currentUser && String(m.autorId) === String(currentUser.id)}
                propuesta={m.datos?.propuesta?.id ? propuestaPorId.get(m.datos.propuesta.id) : null}
                onDecidir={decidir}
                onAjustar={ajustar}
                onEnfocarClase={onEnfocarClase}
                onQuitarMarcas={onQuitarMarcas}
                onAplicarIdea={aplicarIdea}
              />
            ))}
            {deIA && estadoIA.ocupada && (
              <div className="text-xs text-violet-700 animate-pulse">
                🤖 La IA está atendiendo a {estadoIA.atendiendoA}…{estadoIA.enCola > 0 ? ` (${estadoIA.enCola} en cola)` : ''}
              </div>
            )}
            <div ref={finRef} />
          </div>
          <div className="border-t bg-white p-2">
            {deIA && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {SUGERENCIAS.map(([etiqueta, pedido]) => (
                  <button key={etiqueta} onClick={() => setTexto(pedido)} className="rounded-full border border-violet-200 px-2 py-0.5 text-[11px] text-violet-800 hover:bg-violet-50">{etiqueta}</button>
                ))}
              </div>
            )}
            {(ajustando || adjunto) && (
              <div className="mb-1.5 flex flex-wrap gap-1 text-[11px]">
                {ajustando && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">
                    Ajustando la propuesta: escribe qué cambiar <button onClick={() => setAjustando(null)} aria-label="Cancelar ajuste">✕</button>
                  </span>
                )}
                {adjunto && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-900">
                    {adjunto.tipo === 'imagen' ? '📷' : '🎙️'} {adjunto.archivo.name} <button onClick={() => setAdjunto(null)} aria-label="Quitar adjunto">✕</button>
                  </span>
                )}
              </div>
            )}
            <textarea
              ref={entradaRef}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(); }
              }}
              rows={2}
              maxLength={4000}
              placeholder={ajustando ? 'Qué cambiar de la propuesta…' : deIA ? 'Pídele algo a la IA (todo el equipo lo ve)…' : 'Escribe al equipo…'}
              className="w-full resize-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
            />
            <div className="mt-1.5 flex gap-1.5">
              <input ref={archivoRef} type="file" accept={deIA ? 'image/*,audio/*' : 'audio/*'} className="hidden" onChange={elegirArchivo} />
              <button onClick={() => archivoRef.current?.click()} className="rounded-lg border border-gray-300 px-2 text-sm hover:bg-gray-50" title={deIA ? 'Adjuntar una foto (pizarra, captura) o un audio' : 'Adjuntar un audio (se transcribe)'}>📎</button>
              <button onClick={dictado.alternar} className={`rounded-lg border px-2 text-sm ${dictado.escuchando ? 'border-red-400 bg-red-50 text-red-700 animate-pulse' : 'border-gray-300 hover:bg-gray-50'}`} title="Dictar con la voz (se escribe en el cuadro)">🎤</button>
              <button onClick={grabadora.alternar} className={`rounded-lg border px-2 text-sm ${grabadora.grabando ? 'border-red-400 bg-red-50 text-red-700 animate-pulse' : 'border-gray-300 hover:bg-gray-50'}`} title={grabadora.grabando ? 'Terminar la grabación' : 'Grabar un audio (se transcribe)'}>{grabadora.grabando ? '⏹' : '🎙️'}</button>
              {deIA ? (
                <button onClick={mandar} disabled={(!texto.trim() && !adjunto) || enviando} className="flex-1 rounded-lg bg-violet-600 px-2 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40">🤖 Pedir a la IA</button>
              ) : (
                <button onClick={mandar} disabled={(!texto.trim() && !adjunto) || enviando} className="flex-1 rounded-lg bg-gray-800 px-2 py-1.5 text-sm text-white hover:bg-gray-900 disabled:opacity-40">Enviar al equipo</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
