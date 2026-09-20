import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Tour guiado sobre la interfaz real: resalta un elemento y explica qué hace.
 *
 * No usa librerías externas. Cada paso apunta a un selector CSS; si el elemento
 * no está en pantalla (por ejemplo, un botón que solo existe en el editor), el
 * paso se muestra centrado en lugar de romperse.
 *
 * Props:
 *   pasos   [{ selector?, titulo, texto, posicion? }]
 *   abierto boolean
 *   onCerrar()  se llama al terminar o al saltar
 */
const MARGEN = 8;

const Tour = ({ pasos = [], abierto = false, onCerrar = () => {} }) => {
  const [indice, setIndice] = useState(0);
  const [rect, setRect] = useState(null);

  const paso = pasos[indice];

  const medir = useCallback(() => {
    if (!paso?.selector) {
      setRect(null);
      return;
    }
    const el = document.querySelector(paso.selector);
    if (!el) {
      setRect(null);
      return;
    }
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch (e) {
      /* navegadores sin scroll suave */
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [paso]);

  useLayoutEffect(() => {
    if (!abierto) return;
    medir();
    const t = setTimeout(medir, 250); // recolocar tras el scroll suave
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [abierto, medir]);

  const siguiente = useCallback(() => {
    if (indice < pasos.length - 1) setIndice(indice + 1);
    else {
      setIndice(0);
      onCerrar();
    }
  }, [indice, pasos.length, onCerrar]);

  const anterior = useCallback(() => setIndice((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setIndice(0); onCerrar(); }
      if (e.key === 'ArrowRight') siguiente();
      if (e.key === 'ArrowLeft') anterior();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto, siguiente, anterior, onCerrar]);

  if (!abierto || !paso) return null;

  // Tarjeta: debajo del elemento si cabe, si no encima; centrada si no hay elemento
  let estiloTarjeta;
  if (rect) {
    const debajo = rect.top + rect.height + 190 < window.innerHeight;
    estiloTarjeta = {
      position: 'fixed',
      top: debajo ? rect.top + rect.height + MARGEN + 6 : Math.max(12, rect.top - 190),
      left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 372)),
      width: 360,
      zIndex: 10002,
    };
  } else {
    estiloTarjeta = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 380,
      zIndex: 10002,
    };
  }

  return (
    <>
      {/* Foco: el recuadro deja ver el elemento y oscurece el resto */}
      {rect ? (
        <div
          style={{
            position: 'fixed',
            top: rect.top - MARGEN,
            left: rect.left - MARGEN,
            width: rect.width + MARGEN * 2,
            height: rect.height + MARGEN * 2,
            borderRadius: 10,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.68)',
            border: '2px solid #a855f7',
            zIndex: 10001,
            pointerEvents: 'none',
            transition: 'all 0.2s ease',
          }}
        />
      ) : (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.68)',
            zIndex: 10001,
          }}
          onClick={() => { setIndice(0); onCerrar(); }}
        />
      )}

      <div style={estiloTarjeta} className="bg-white rounded-lg shadow-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-purple-600">
            Paso {indice + 1} de {pasos.length}
          </span>
          <button
            onClick={() => { setIndice(0); onCerrar(); }}
            className="text-gray-500 hover:text-gray-800 text-sm"
            aria-label="Cerrar el tutorial"
          >
            Saltar ✕
          </button>
        </div>

        <h3 className="text-lg font-bold text-gray-800 mb-1">{paso.titulo}</h3>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">{paso.texto}</p>

        <div className="h-1 bg-gray-200 rounded mb-4">
          <div
            className="h-1 bg-purple-500 rounded transition-all"
            style={{ width: `${((indice + 1) / pasos.length) * 100}%` }}
          />
        </div>

        <div className="flex justify-between items-center">
          <button
            onClick={anterior}
            disabled={indice === 0}
            className={`px-3 py-1.5 rounded text-sm ${
              indice === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            ← Anterior
          </button>
          <button
            onClick={siguiente}
            className="px-4 py-1.5 rounded text-sm bg-purple-600 text-white hover:bg-purple-700"
          >
            {indice === pasos.length - 1 ? 'Terminar' : 'Siguiente →'}
          </button>
        </div>
      </div>
    </>
  );
};

export default Tour;
