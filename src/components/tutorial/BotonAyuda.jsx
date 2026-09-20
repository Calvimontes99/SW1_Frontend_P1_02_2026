import React, { useEffect, useState } from 'react';
import { TAREAS, leerProgreso } from './guiones.js';

/**
 * Botón flotante "?" que relanza el tour y muestra el progreso de aprendizaje.
 * El checklist se marca solo cuando el usuario realiza cada acción de verdad.
 */
const BotonAyuda = ({ onRelanzarTour }) => {
  const [abierto, setAbierto] = useState(false);
  const [progreso, setProgreso] = useState(leerProgreso());

  useEffect(() => {
    const actualizar = () => setProgreso(leerProgreso());
    window.addEventListener('tutorial:progreso', actualizar);
    return () => window.removeEventListener('tutorial:progreso', actualizar);
  }, []);

  const hechas = TAREAS.filter((t) => progreso[t.id]).length;

  return (
    <>
      <button
        onClick={() => setAbierto((v) => !v)}
        title="Ayuda y tutorial"
        aria-label="Ayuda y tutorial"
        style={{
          position: 'fixed',
          left: 18,
          bottom: 18,
          zIndex: 9998,
          width: 44,
          height: 44,
          borderRadius: '50%',
        }}
        className="bg-purple-600 hover:bg-purple-700 text-white text-xl font-bold shadow-lg flex items-center justify-center"
      >
        ?
      </button>

      {abierto && (
        <div
          style={{ position: 'fixed', left: 18, bottom: 74, zIndex: 9999, width: 300 }}
          className="bg-white rounded-lg shadow-2xl p-4 border border-gray-200"
        >
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-gray-800">Aprende la herramienta</h4>
            <button
              onClick={() => setAbierto(false)}
              className="text-gray-500 hover:text-gray-800"
              aria-label="Cerrar ayuda"
            >
              ✕
            </button>
          </div>

          <button
            onClick={() => {
              setAbierto(false);
              onRelanzarTour?.();
            }}
            className="w-full mb-3 px-3 py-2 rounded bg-purple-600 text-white text-sm hover:bg-purple-700"
          >
            ▶ Ver el tutorial guiado
          </button>

          <div className="text-xs font-semibold text-gray-500 mb-2">
            Tu progreso ({hechas} de {TAREAS.length})
          </div>
          <ul className="space-y-1.5">
            {TAREAS.map((t) => {
              const hecha = !!progreso[t.id];
              return (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <span className={hecha ? 'text-green-600' : 'text-gray-300'}>
                    {hecha ? '✓' : '○'}
                  </span>
                  <span className={hecha ? 'text-gray-400 line-through' : 'text-gray-700'}>
                    {t.texto}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
};

export default BotonAyuda;
