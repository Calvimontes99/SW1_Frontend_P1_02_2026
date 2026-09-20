import { useCallback, useEffect, useState } from 'react';
import {
  CATALOGO_TEXTO, CATALOGO_VOZ, NOMBRE_NIVEL, configuracionDeTexto, configuracionDeVoz,
  detectarCapacidades, guardarPreferenciasIA, nivelActual, preferenciasIA, textoRecomendado,
  usaGraficaIntegrada, vozRecomendada,
} from '../ia-local/configuracionIA.js';
import { modeloDescargado, prepararModelo } from '../ia-local/motorIA.js';
import { iaNubeDisponible, olvidarEstadoNube } from '../ia-local/asistenteLocal.js';
import { EJEMPLOS_ORDENES } from '../ia-local/interpreteOrdenes.js';
import { estadoOllama, modeloOllamaPorDefecto, olvidarEstadoOllama } from '../ia-local/ollama.js';

const mb = (bytes) => `${Math.round((bytes || 0) / 1048576)} MB`;

/**
 * Panel "IA sin internet": muestra qué puede usar este equipo, deja elegir el modelo según
 * la gráfica y la memoria, los descarga y permite forzar la IA local (por ejemplo, para la defensa).
 */
export default function PanelIALocal({ onCerrar, onCambio }) {
  const [capacidades, setCapacidades] = useState(null);
  const [nivel, setNivel] = useState(null);
  const [claveTexto, setClaveTexto] = useState(null);
  const [claveVoz, setClaveVoz] = useState(null);
  const [siempreLocal, setSiempreLocal] = useState(preferenciasIA().siempreLocal);
  const [nube, setNube] = useState(null);
  const [estado, setEstado] = useState({ voz: {}, texto: {} });
  const [ollama, setOllama] = useState(null);
  const [motorTexto, setMotorTexto] = useState(preferenciasIA().motorTexto || 'auto');
  const [modeloOllama, setModeloOllama] = useState(preferenciasIA().modeloOllama || '');
  const [copiado, setCopiado] = useState(null);

  /** Enlace de descarga según el sistema operativo del equipo. */
  const descargaOllama = () => {
    const s = navigator.userAgent;
    if (/Windows/i.test(s)) return 'https://ollama.com/download/OllamaSetup.exe';
    if (/Mac/i.test(s)) return 'https://ollama.com/download/Ollama-darwin.zip';
    return 'https://ollama.com/download';
  };

  const copiar = async (texto, que) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      setTimeout(() => setCopiado(null), 4000);
    } catch {
      setCopiado(null);
    }
  };

  const opcionTexto = CATALOGO_TEXTO.find((o) => o.clave === claveTexto) || null;
  const opcionVoz = CATALOGO_VOZ.find((o) => o.clave === claveVoz) || null;
  const usaModeloDeTexto = nivel === 'gpu';
  const configDe = useCallback((tipo, cTexto, cVoz, n) => (tipo === 'texto'
    ? (n === 'gpu' ? configuracionDeTexto(CATALOGO_TEXTO.find((o) => o.clave === cTexto)) : null)
    : configuracionDeVoz(CATALOGO_VOZ.find((o) => o.clave === cVoz), n)), []);

  const revisar = useCallback(async (n, cTexto, cVoz) => {
    const [voz, texto] = await Promise.all([
      modeloDescargado(configDe('voz', cTexto, cVoz, n)),
      modeloDescargado(configDe('texto', cTexto, cVoz, n)),
    ]);
    setEstado({ voz: { listo: voz }, texto: { listo: texto } });
  }, [configDe]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const c = await detectarCapacidades();
      const n = await nivelActual();
      const hayNube = await iaNubeDisponible();
      if (!vivo) return;
      const prefs = preferenciasIA();
      const cTexto = prefs.modeloTexto || textoRecomendado(c, n);
      const cVoz = prefs.modeloVoz || vozRecomendada(c, n);
      setCapacidades(c);
      setNivel(n);
      setClaveTexto(cTexto);
      setClaveVoz(cVoz);
      setNube(hayNube);
      await revisar(n, cTexto, cVoz);
      const enEquipo = await estadoOllama();
      if (vivo) setOllama(enEquipo);
    })();
    return () => { vivo = false; };
  }, [revisar]);

  const cambiarNivel = async (n) => {
    guardarPreferenciasIA({ nivel: n === capacidades?.recomendado ? undefined : n });
    setNivel(n);
    await revisar(n, claveTexto, claveVoz);
    onCambio?.();
  };

  const cambiarModelo = async (tipo, clave) => {
    if (tipo === 'texto') {
      guardarPreferenciasIA({ modeloTexto: clave === textoRecomendado(capacidades, nivel) ? undefined : clave });
      setClaveTexto(clave);
      await revisar(nivel, clave, claveVoz);
    } else {
      guardarPreferenciasIA({ modeloVoz: clave === vozRecomendada(capacidades, nivel) ? undefined : clave });
      setClaveVoz(clave);
      await revisar(nivel, claveTexto, clave);
    }
    onCambio?.();
  };

  const revisarOllama = async () => {
    setOllama(null);
    olvidarEstadoOllama();
    setOllama(await estadoOllama({ forzar: true }));
  };

  const cambiarMotorTexto = (valor) => {
    guardarPreferenciasIA({ motorTexto: valor === 'auto' ? undefined : valor });
    setMotorTexto(valor);
    onCambio?.();
  };

  const cambiarModeloOllama = (valor) => {
    guardarPreferenciasIA({ modeloOllama: valor || undefined });
    setModeloOllama(valor);
    onCambio?.();
  };

  const cambiarSiempreLocal = (valor) => {
    guardarPreferenciasIA({ siempreLocal: valor });
    olvidarEstadoNube();
    setSiempreLocal(valor);
    onCambio?.();
  };

  const preparar = async (tipo) => {
    const config = configDe(tipo, claveTexto, claveVoz, nivel);
    if (!config) return;
    setEstado((e) => ({ ...e, [tipo]: { cargando: true, progreso: 0 } }));
    try {
      await prepararModelo(tipo, config, (p) => setEstado((e) => ({
        ...e,
        [tipo]: { cargando: true, progreso: p.progreso, cargado: p.cargado, total: p.total },
      })));
      setEstado((e) => ({ ...e, [tipo]: { listo: true } }));
      onCambio?.();
    } catch (error) {
      setEstado((e) => ({ ...e, [tipo]: { error: error.message } }));
    }
  };

  /** Bloque de un modelo: selector de opciones, tamaño, estado y descarga. */
  const filaModelo = (tipo, titulo, opciones, opcion, recomendada, pesoDe) => {
    const e = estado[tipo] || {};
    const deshabilitado = tipo === 'texto' && !usaModeloDeTexto;
    return (
      <div className="p-3 border rounded-lg bg-white space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-gray-800">{titulo}</div>
          {!deshabilitado && (e.listo
            ? <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full whitespace-nowrap">✓ Descargado</span>
            : (
              <button
                type="button"
                onClick={() => preparar(tipo)}
                disabled={e.cargando || (nube === false && !navigator.onLine)}
                className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 whitespace-nowrap"
              >
                {e.cargando ? 'Descargando…' : `Descargar ${pesoDe(opcion)} MB`}
              </button>
            ))}
        </div>

        {deshabilitado ? (
          <div className="text-xs text-gray-600">
            En el nivel «{NOMBRE_NIVEL[nivel]}» no se usa modelo de lenguaje: en procesador tardaría más de un
            minuto por respuesta. El intérprete de órdenes resuelve el texto al instante.
          </div>
        ) : (
          <>
            <select
              className="w-full border rounded p-2 text-sm text-gray-900 bg-white"
              value={opcion?.clave || ''}
              onChange={(ev) => cambiarModelo(tipo, ev.target.value)}
              disabled={e.cargando}
            >
              {opciones.map((o) => (
                <option key={o.clave} value={o.clave}>
                  {o.nombre} · {pesoDe(o)} MB{o.clave === recomendada ? ' — recomendado para tu equipo' : ''}
                </option>
              ))}
            </select>
            {opcion && <div className="text-xs text-gray-500">{opcion.detalle}</div>}
            {opcion?.memoriaMinimaGB && capacidades?.memoriaGB && capacidades.memoriaGB < opcion.memoriaMinimaGB && (
              <div className="text-xs text-amber-700">
                Este modelo suele pedir {opcion.memoriaMinimaGB} GB de memoria y tu equipo reporta {capacidades.memoriaGB} GB:
                si falla al cargar, elige uno más pequeño.
              </div>
            )}
          </>
        )}

        {e.cargando && (
          <div>
            <div className="h-1.5 bg-gray-200 rounded">
              <div className="h-1.5 bg-indigo-500 rounded transition-all" style={{ width: `${Math.round((e.progreso || 0) * 100)}%` }} />
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              {e.total ? `${mb(e.cargado)} de ${mb(e.total)}` : 'Preparando…'}
            </div>
          </div>
        )}
        {e.error && <div className="text-xs text-red-700">No se pudo preparar: {e.error}</div>}
      </div>
    );
  };

  return (
    <div className="p-3 space-y-3 text-sm" data-tour="panel-ia-local">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-gray-800">💻 IA sin internet</div>
        <button type="button" onClick={onCerrar} className="text-xs text-gray-500 hover:text-gray-800">Volver ✕</button>
      </div>

      <div className="p-3 rounded-lg border bg-gray-50 text-xs text-gray-700 space-y-1">
        <div>
          IA en la nube:{' '}
          {nube === null ? 'comprobando…' : nube ? <span className="text-green-700 font-semibold">disponible</span> : <span className="text-amber-700 font-semibold">no disponible (se usa la IA local)</span>}
        </div>
        {capacidades && (
          <>
            <div>
              Tu equipo: WebGPU {capacidades.webgpu ? `sí${capacidades.f16 ? ' (f16)' : ''}` : 'no'}
              {capacidades.memoriaGB ? ` · memoria ≥ ${capacidades.memoriaGB} GB` : ''}
              {capacidades.nucleos ? ` · ${capacidades.nucleos} núcleos` : ''}
              {capacidades.libreMB ? ` · ${Math.round(capacidades.libreMB / 1024)} GB libres para la app` : ''}
            </div>
            {capacidades.adaptador && (
              <div className="text-gray-500">Gráfica en uso: {capacidades.adaptador}</div>
            )}
            {usaGraficaIntegrada(capacidades) && (
              <div className="text-amber-700">
                El navegador está usando la gráfica integrada. Si tu equipo tiene una dedicada (NVIDIA o AMD),
                actívala para el navegador y la IA local irá mucho más rápida: Configuración de Windows → Sistema →
                Pantalla → Gráficos → elige tu navegador → Alto rendimiento, y vuelve a abrirlo.
              </div>
            )}
          </>
        )}
      </div>

      <label className="block text-xs font-semibold text-gray-700">
        Dónde corre la IA local
        <select
          className="mt-1 w-full border rounded p-2 text-sm text-gray-900 bg-white"
          value={nivel || ''}
          onChange={(e) => cambiarNivel(e.target.value)}
        >
          {Object.keys(NOMBRE_NIVEL).map((n) => (
            <option key={n} value={n} disabled={n === 'gpu' && capacidades && !(capacidades.webgpu && capacidades.f16)}>
              {NOMBRE_NIVEL[n]}{capacidades?.recomendado === n ? ' — recomendado' : ''}
            </option>
          ))}
        </select>
      </label>

      {/* Ollama: modelos instalados en el equipo, no en el navegador */}
      <div className="p-3 border rounded-lg bg-white space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-800">🖥️ Ollama en tu equipo</div>
          <button type="button" onClick={revisarOllama} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100">
            Volver a comprobar
          </button>
        </div>

        {ollama === null && <div className="text-xs text-gray-500">Comprobando…</div>}

        {ollama?.disponible && (
          <>
            <div className="text-xs text-green-700 font-semibold">
              Detectado con {ollama.modelos.length} {ollama.modelos.length === 1 ? 'modelo instalado' : 'modelos instalados'}
            </div>
            {ollama.modelos.length > 0 ? (
              <>
                <select
                  className="w-full border rounded p-2 text-sm text-gray-900 bg-white"
                  value={modeloOllama || modeloOllamaPorDefecto(ollama.modelos) || ''}
                  onChange={(ev) => cambiarModeloOllama(ev.target.value)}
                >
                  {ollama.modelos.map((m) => (
                    <option key={m.nombre} value={m.nombre}>{m.nombre} · {m.mb} MB</option>
                  ))}
                </select>
                <label className="block text-xs text-gray-700">
                  Qué usar para los pedidos libres
                  <select
                    className="mt-1 w-full border rounded p-2 text-sm text-gray-900 bg-white"
                    value={motorTexto}
                    onChange={(ev) => cambiarMotorTexto(ev.target.value)}
                  >
                    <option value="auto">Ollama si está disponible, si no el del navegador (recomendado)</option>
                    <option value="ollama">Solo Ollama</option>
                    <option value="navegador">Solo el modelo del navegador</option>
                  </select>
                </label>
                <div className="text-xs text-gray-500">
                  Los modelos de Ollama viven en tu equipo: no se descargan de nuevo en cada navegador y usan tu
                  tarjeta gráfica con sus propios controladores.
                </div>
              </>
            ) : (
              <div className="text-xs text-amber-700">
                Ollama está corriendo pero no tiene modelos. Descarga uno desde la terminal, por ejemplo:
                <code className="block mt-1 p-1 bg-gray-100 rounded text-gray-800">ollama pull llama3.2</code>
              </div>
            )}
          </>
        )}

        {ollama && !ollama.disponible && (
          <div className="text-xs text-gray-600 space-y-2">
            <div>No se detectó Ollama en este equipo ({ollama.motivo}). Es opcional: sin él se usa el modelo del navegador.</div>

            <div className="flex flex-wrap gap-2">
              <a
                href={descargaOllama()}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
              >
                ⬇️ Descargar Ollama
              </a>
              <button
                type="button"
                onClick={() => copiar('ollama pull llama3.2', 'descarga del modelo')}
                className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                Copiar: descargar un modelo
              </button>
              <button
                type="button"
                onClick={() => copiar(`setx OLLAMA_ORIGINS "${window.location.origin}"`, 'permiso para esta página')}
                className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                Copiar: permitir esta página
              </button>
            </div>
            {copiado && <div className="text-green-700">Copiado: {copiado}. Pégalo en una terminal.</div>}

            <div>Pasos, una sola vez:</div>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Instala Ollama con el botón de arriba y ábrelo (queda en la bandeja del sistema).</li>
              <li>
                En una terminal, descarga un modelo:
                <code className="block mt-1 p-1 bg-gray-100 rounded text-gray-800">ollama pull llama3.2</code>
              </li>
              <li>
                Permite que esta página lo use y vuelve a abrir Ollama:
                <code className="block mt-1 p-1 bg-gray-100 rounded text-gray-800 break-all">setx OLLAMA_ORIGINS "{window.location.origin}"</code>
              </li>
              <li>Vuelve aquí y pulsa «Volver a comprobar».</li>
            </ol>
            <div className="text-gray-500">
              El modelo queda guardado en tu equipo: no se descarga otra vez en cada navegador y usa tu tarjeta gráfica.
            </div>
          </div>
        )}
      </div>

      {filaModelo('texto', '🧠 Modelo de lenguaje del navegador (si no usas Ollama)', CATALOGO_TEXTO, opcionTexto,
        textoRecomendado(capacidades, nivel), (o) => o?.mb ?? 0)}

      {filaModelo('voz', '🎙️ Voz a texto (Whisper)', CATALOGO_VOZ, opcionVoz,
        vozRecomendada(capacidades, nivel), (o) => (nivel === 'gpu' ? o?.mbGpu : o?.mbCpu) ?? 0)}

      <label className="flex items-start gap-2 text-xs text-gray-700">
        <input type="checkbox" className="mt-0.5" checked={siempreLocal} onChange={(e) => cambiarSiempreLocal(e.target.checked)} />
        <span>Usar siempre la IA local, aunque haya internet (útil para probar o para la defensa).</span>
      </label>

      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer font-semibold text-gray-700">Órdenes que se entienden sin ningún modelo</summary>
        <ul className="mt-1 space-y-1 list-disc pl-4">
          {EJEMPLOS_ORDENES.map((e) => <li key={e}>{e}</li>)}
        </ul>
      </details>
      <div className="text-[11px] text-gray-500">
        Cada modelo se descarga una sola vez y queda guardado en este navegador; si cambias de modelo, el anterior
        sigue guardado. Sin internet también funciona el modo Texto, Voz y Editar; el modo Imagen necesita la IA en la nube.
      </div>
    </div>
  );
}
