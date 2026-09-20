import React from 'react';
import { useNavigate } from 'react-router-dom';

const BoardList = ({ boards = [], user, onInvite, onEdit, onDelete }) => {
  const navigate = useNavigate();

  // BoardList renders array of board summaries

  // Si no hay tableros, mostramos un mensaje "vacío" (proteger contra boards undefined/null)
  if (!Array.isArray(boards) || boards.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 rounded-lg shadow-sm">
        <p className="text-gray-600 font-medium">No hay tableros disponibles</p>
        <p className="text-sm text-gray-500 mt-1">
          Crea un nuevo tablero para comenzar
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {boards.map((board) => {
        // Normalize single board for display safety
        const b = board || {};
  // Determine owner id/email from possible backend shapes (userId, userid, host)
  const rawHost = b.host ?? null;
  // If rawHost is numeric (stored userId), treat as ownerId; otherwise as ownerEmail
  const ownerId = b.userId ?? b.userid ?? (rawHost !== null && !isNaN(Number(rawHost)) ? rawHost : null);
  const ownerEmail = (rawHost !== null && isNaN(Number(rawHost))) ? rawHost : null;
        const isHost = Boolean(
          user && (
            (ownerId !== null && String(ownerId) === String(user.id)) ||
            (ownerEmail !== null && String(ownerEmail) === String(user.email))
          )
        );

        return (
          <div
            key={b.id ?? Math.random()}
            className={`
              board-item 
              transition-all duration-200 
              hover:shadow-md 
              flex-col sm:flex-row
            `}
          >
            {/* Información del tablero */}
            <div className="flex-1 mb-2 sm:mb-0">
              <h3 className="text-lg font-semibold text-gray-800 mb-1">
                {b.title || b.description || `Tablero #${b.id ?? 's/contenido'}`}
              </h3>
              <p className="text-sm text-gray-500">
                Creado por: <span className="font-medium">{ownerEmail || ownerId || 'Desconocido'}</span>
              </p>
              {/* Debug: if no title/description, show JSON preview to help debugging */}
              {!(b.title || b.description) && (
                <pre className="text-xs text-gray-400 mt-2 overflow-auto max-h-24">{JSON.stringify(b, null, 2)}</pre>
              )}
            </div>

            {/* Botones de acción */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Botón Invitar Usuarios */}
              <button
                onClick={() => onInvite(board.id)}
                className={`
                  btn-success flex items-center 
                  px-3 py-2 text-sm
                `}
                title="Invitar usuarios"
                data-tour="invitar"
              >
                <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth="2" 
                    d="M12 4v16m8-8H4" 
                  />
                </svg>
                Invitar
              </button>

              {/* Botón Ver Tablero */}
              <button
                onClick={() => navigate(`/board/${board.id}`)}
                className={`
                  btn-primary flex items-center 
                  px-3 py-2 text-sm
                `}
                title="Ver Tablero"
                data-tour="ver-tablero"
              >
                <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth="2" 
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" 
                  />
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5
                       c4.478 0 8.268 2.943 9.542 7
                       -1.274 4.057-5.064 7-9.542 7
                       -4.477 0-8.268-2.943-9.542-7z" 
                  />
                </svg>
                Ver
              </button>

              {/* Editar y Eliminar: solo renderizar si es host */}
              {isHost && (
                <>
                  <button
                    onClick={() => onEdit(board)}
                    className={`btn-secondary flex items-center px-3 py-2 text-sm`}
                    title={"Editar tablero"}
                  >
                    <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth="2" 
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" 
                      />
                    </svg>
                    Editar
                  </button>

                  <button
                    onClick={() => onDelete(board.id)}
                    className={`btn-danger flex items-center px-3 py-2 text-sm`}
                    title={"Eliminar tablero"}
                  >
                    <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BoardList;