import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
// Use backend endpoints instead of Firestore
import Swal from "sweetalert2";
import BoardList from "../components/board/BoardList";
import BoardModals from "../components/board/BoardModals";
import { prepararImportacionXmi } from "../utils/xmlImporter.js";
import { prepararImportacionEAP } from "../utils/eapImporter.js";
import Tour from "../components/tutorial/Tour.jsx";
import BotonAyuda from "../components/tutorial/BotonAyuda.jsx";
import { TOUR_TABLEROS, tourVisto, marcarTourVisto, marcarTarea } from "../components/tutorial/guiones.js";
import { borrarUsuarioLocal, esErrorDeRed, guardarListaLocal, guardarUsuarioLocal, leerListaLocal, leerUsuarioLocal } from "../offline/almacenTableros.js";
import { errorDeRespuesta, mensajeDeError } from '../utils/mensajesError';

const useBoardState = () => {
  const [description, setDescription] = useState("");
  const [boardList, setBoardList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentBoardId, setCurrentBoardId] = useState(null);
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [editModalIsOpen, setEditModalIsOpen] = useState(false);
  const [inviteModalIsOpen, setInviteModalIsOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [xmlContent, setXmlContent] = useState(""); // Nuevo estado para XML

  return {
    description,
    setDescription,
    boardList,
    setBoardList,
    loading,
    setLoading,
    currentBoardId,
    setCurrentBoardId,
    modalIsOpen,
    setModalIsOpen,
    editModalIsOpen,
    setEditModalIsOpen,
    inviteModalIsOpen,
    setInviteModalIsOpen,
    inviteEmail,
    setInviteEmail,
    xmlContent,      // Añadir estas
    setXmlContent    // dos líneas
  };
};

const Board = () => {
  const navigate = useNavigate();
  const boardApiBase = `${import.meta.env.VITE_WS_URL || window.location.origin}/apis/sala`;

  const [user, setUser] = useState(null);
  const [tourAbierto, setTourAbierto] = useState(false);
  const boardState = useBoardState();
  const {
    description,
    setDescription,
    boardList,
    setBoardList,
    loading,
    setLoading,
    currentBoardId,
    setCurrentBoardId,
    modalIsOpen,
    setModalIsOpen,
    editModalIsOpen,
    setEditModalIsOpen,
    inviteModalIsOpen,
    setInviteModalIsOpen,
    inviteEmail,
    setInviteEmail,
    xmlContent,        // Añadir estas
    setXmlContent     // dos líneas
  } = boardState;


  useEffect(() => {
    // Check session via backend profile
    let mounted = true;
    (async () => {
      try {
        const base = import.meta.env.VITE_WS_URL || window.location.origin;
        const url = `${base}/apis`;

        // First attempt: cookie-based credentialed request
        let res = await fetch(url, { credentials: 'include' });
        if (!mounted) return;

        // Parse payload carefully: backend sometimes wraps { error, data }
        let payload = await res.json().catch(() => null);

        // If we got a wrapper like { error, data } use payload.data
        let profile = payload && payload.data ? payload.data : payload;

        // If unauthorized or profile looks empty, try Authorization fallback using localStorage token
        if ((!res.ok || !profile || Object.keys(profile).length === 0) && res.status !== 200) {
          // try fallback token
          const token = localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('accessToken');
          if (token) {
            res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            payload = await res.json().catch(() => null);
            profile = payload && payload.data ? payload.data : payload;
          }
        }

        if (!mounted) return;

        if (res.ok && profile && profile.id) {
          setUser({ email: profile.email, id: profile.id, name: profile.name || profile.fullname || profile.username });
          guardarUsuarioLocal({ email: profile.email, id: profile.id, name: profile.name || profile.fullname || profile.username });
          setLoading(false);
        } else {
          // Not authenticated - go to login
          setUser(null);
          borrarUsuarioLocal();
          navigate('/login');
        }
      } catch (err) {
        // Sin conexión con el servidor: se muestran los tableros guardados en este equipo
        const guardado = leerUsuarioLocal();
        if (guardado && mounted) {
          setUser(guardado);
          setLoading(false);
          return;
        }
        console.error('Error fetching profile:', err);
        setUser(null);
        navigate('/login');
      }
    })();
    return () => { mounted = false; };
  }, [navigate]);

  const getBoardList = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const res = await fetch(`${boardApiBase}`, { credentials: 'include', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      const status = res.status;
  const raw = await res.json().catch(() => null);
  // console.debug('getBoardList response status:', status, 'raw:', raw);
  if (!res.ok) {
        // If server returned 401/403, force logout or redirect
        if (status === 401 || status === 403) {
          navigate('/login');
          return;
        }
        throw errorDeRespuesta(res, raw, 'No se pudieron cargar tus tableros.');
      }

      // Normalize rows to expected shape (id, title, description)
      // Backend returns { error: boolean, data: [] } so accept either that wrapper or a direct array
      const unwrap = (payload) => Array.isArray(payload)
        ? payload
        : (payload && Array.isArray(payload.data) ? payload.data : (payload && Array.isArray(payload.rows) ? payload.rows : []));

      let rows = unwrap(raw);

      // Añadir tableros donde el usuario fue invitado (tabla Usersala)
      try {
        const invitedRes = await fetch(`${import.meta.env.VITE_WS_URL || window.location.origin}/apis/usersala`, { credentials: 'include', cache: 'no-store' });
        if (invitedRes.ok) {
          const invitedRaw = await invitedRes.json().catch(() => null);
          const invitedRows = unwrap(invitedRaw);
          const ownIds = new Set(rows.map(r => r.id));
          invitedRows.forEach(r => {
            if (!ownIds.has(r.id)) rows.push({ ...r, invited: true });
          });
        }
      } catch (invErr) {
        console.warn('No se pudieron cargar los tableros invitados:', invErr);
      }

      const normalized = rows.map(item => {
        // tolerate different casing and DB column names
        const id = item.id ?? item.pk ?? item.ID ?? item.Id ?? item.pk_id ?? item.PK;
        const title = item.title ?? item.description ?? item.name ?? item.titulo ?? item.Title;
        const descriptionField = item.description ?? item.title ?? item.descripcion ?? '';
        const host = item.host ?? item.userId ?? item.userid ?? item.user_id ?? item.userid ?? item.UserId;
        const participantes = item.participantes ?? item.participans ?? item.participants ?? [];
        return {
          id,
          title,
          description: descriptionField,
          host,
          participantes,
          invited: !!item.invited
        };
      });
  // console.debug('Normalized boards:', normalized);
      setBoardList(normalized || []);
      guardarListaLocal(normalized || []);
    } catch (error) {
      if (esErrorDeRed(error)) {
        // Sin conexión: la última lista conocida (cada tablero abre con su copia local)
        setBoardList(leerListaLocal());
        return;
      }
      console.error("Error al obtener tableros:", error);
      Swal.fire({ icon: "error", title: "Error", text: "No se pudieron cargar los tableros" });
      // ensure UI receives an array to avoid downstream crashes
      setBoardList([]);
    } finally {
      setLoading(false);
    }
  }, [user, setBoardList, boardApiBase]);

  useEffect(() => {
    if (user) {
      getBoardList();
    }
  }, [getBoardList, user]);

  // El tour de bienvenida se muestra una sola vez, ya con sesión iniciada
  useEffect(() => {
    if (user && !tourVisto('tableros')) {
      const t = setTimeout(() => setTourAbierto(true), 700);
      return () => clearTimeout(t);
    }
  }, [user]);

  useEffect(() => {
    if (xmlContent && user) {
      getBoardList();
    }
  }, [xmlContent, getBoardList, user]);




  // Modal actions
  const closeAllModals = useCallback(() => {
    setModalIsOpen(false);
    setEditModalIsOpen(false);
    setInviteModalIsOpen(false);
    setDescription("");
    setInviteEmail("");
  }, [setModalIsOpen, setEditModalIsOpen, setInviteModalIsOpen, setDescription, setInviteEmail]);

  // CRUD operations
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "El nombre del tablero es obligatorio",
      });
      return;
    }

    try {
      const res = await fetch(boardApiBase, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Backend expects `title` (required) and optional `description` and `xml`.
        body: JSON.stringify({ title: description, description })
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('Create board failed:', res.status, result);
        const msg = result.message || (result.messages && result.messages.join(', ')) || 'No se pudo crear el tablero';
        Swal.fire({ icon: 'error', title: 'Error', text: msg });
        return;
      }

      // success
      marcarTarea('tablero');
      await getBoardList();
      closeAllModals();

      Swal.fire({
        icon: "success",
        title: "¡Tablero creado!",
        text: "Tu tablero ha sido agregado exitosamente",
      });
    } catch (error) {
      console.error("Error al crear tablero:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo crear el tablero",
      });
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "El nombre del tablero es obligatorio",
      });
      return;
    }

    try {
      const res = await fetch(`${boardApiBase}/${currentBoardId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Send title/description fields expected by backend
        body: JSON.stringify({ title: description, description, updatedAt: new Date() })
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('Edit board failed:', res.status, result);
        const msg = result.message || (result.messages && result.messages.join(', ')) || 'No se pudo editar el tablero';
        Swal.fire({ icon: 'error', title: 'Error', text: msg });
        return;
      }

      await getBoardList();
      closeAllModals();

      Swal.fire({
        icon: "success",
        title: "¡Tablero actualizado!",
        text: "Tu tablero ha sido editado exitosamente",
      });
    } catch (error) {
      console.error("Error al editar tablero:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo editar el tablero",
      });
    }
  };

  const handleInviteUser = async (email) => {
    if (!email || !currentBoardId) return;

    try {
      const res = await fetch(`${import.meta.env.VITE_WS_URL || window.location.origin}/apis/usersala`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salas_id: Number(currentBoardId), email })
      });

      const result = await res.json().catch(() => ({}));
      // El backend envuelve las respuestas como { error, data }; el error real viene en data
      const payload = result && result.data ? result.data : result;

      if (!res.ok || (payload && payload.error)) {
        const msg = (payload && payload.message) || result.message || 'No se pudo invitar al usuario';
        Swal.fire({
          icon: res.status === 409 ? 'warning' : 'error',
          title: res.status === 409 ? 'Usuario ya invitado' : 'Error',
          text: msg,
        });
        return;
      }

      Swal.fire({
        icon: "success",
        title: "¡Usuario invitado!",
        text: "El usuario ha sido invitado exitosamente",
      });

      closeAllModals();
    } catch (error) {
      console.error("Error al invitar usuario:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo invitar al usuario",
      });
    }
  };

  const handleDeleteBoard = async (boardId) => {
    try {
      const result = await Swal.fire({
        title: "¿Estás seguro?",
        text: "No podrás revertir esta acción",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Sí, eliminar",
        cancelButtonText: "Cancelar"
      });

      if (result.isConfirmed) {
    await fetch(`${boardApiBase}/${boardId}`, { method: 'DELETE', credentials: 'include' });
        await getBoardList();

        Swal.fire(
          "¡Eliminado!",
          "El tablero ha sido eliminado.",
          "success"
        );
      }
    } catch (error) {
      console.error("Error al eliminar tablero:", error);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo eliminar el tablero",
      });
    }
  };

  const handleCopyLink = (boardId) => {
    const link = `${window.location.origin}/board/${boardId}`;
    navigator.clipboard.writeText(link);
    Swal.fire({
      icon: "success",
      title: "¡Enlace copiado!",
      text: "El enlace ha sido copiado al portapapeles",
      timer: 2000,
      showConfirmButton: false
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    );
  }
  // Importar un diagrama: XMI (.xmi / .xml) o proyecto de Enterprise Architect (.eap)
  const handleXmlUpload = async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    const nombreBase = file.name.replace(/\.[^.]+$/, '');

    try {
      let importacion;
      if (/\.eap$/i.test(file.name)) {
        // El .EAP es una base de datos Access: la lee el backend
        Swal.fire({
          title: 'Leyendo el proyecto de Enterprise Architect...',
          allowOutsideClick: false,
          showConfirmButton: false,
          willOpen: () => Swal.showLoading()
        });
        const datos = new FormData();
        datos.append('archivo', file);
        const res = await fetch(`${import.meta.env.VITE_WS_URL || window.location.origin}/apis/importar/eap`, {
          method: 'POST',
          credentials: 'include',
          body: datos
        });
        const cuerpo = await res.json().catch(() => ({}));
        Swal.close();
        if (!res.ok) throw errorDeRespuesta(res, cuerpo, 'No se pudo leer el proyecto de Enterprise Architect.');
        importacion = prepararImportacionEAP(cuerpo.data);
      } else {
        importacion = prepararImportacionXmi(await file.text());
      }

      const opcion = await elegirQueImportar(importacion.opciones);
      if (!opcion) return;
      const { nodes, edges, titulo } = importacion.construir(opcion);
      if (!nodes.length) throw new Error('El archivo no contiene clases UML.');
      await createBoardFromXml(titulo || nombreBase, nodes, edges);
    } catch (error) {
      console.error("Error importando el diagrama:", error);
      Swal.fire({
        icon: "error",
        title: "No se pudo importar el archivo",
        text: mensajeDeError(error, 'Revisa que sea un XMI o un proyecto .EAP de Enterprise Architect.'),
        showConfirmButton: true
      });
    }
  };

  // Si el archivo trae varios diagramas, se elige cuál convertir en tablero
  const elegirQueImportar = async (opciones) => {
    if (opciones.length === 1) return opciones[0].valor;
    const { isConfirmed, value } = await Swal.fire({
      title: '¿Qué quieres importar?',
      text: 'El archivo contiene varios diagramas.',
      input: 'select',
      inputOptions: Object.fromEntries(opciones.map(o => [o.valor, o.etiqueta.replace(/[<>]/g, '')])),
      inputValue: opciones[0].valor,
      showCancelButton: true,
      confirmButtonText: 'Importar',
      cancelButtonText: 'Cancelar'
    });
    return isConfirmed ? value : null;
  };

  // Crea el tablero con el diagrama importado usando la API del backend.
  // (Antes esta función llamaba a addDoc/boardCollection de Firestore, que ya no
  // existen en el proyecto: la importación fallaba siempre con ReferenceError.)
  const createBoardFromXml = async (title, nodes, edges) => {
    try {
      const res = await fetch(boardApiBase, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: title,
          xml: JSON.stringify({ nodes, edges })
        })
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw errorDeRespuesta(res, result, 'No se pudo crear el tablero importado.');
      }

      await getBoardList();
      Swal.fire({
        icon: "success",
        title: "¡Diagrama importado!",
        html: `<div class="text-left"><p>Se creó el tablero <strong>${title}</strong></p>` +
              `<p class="text-sm text-gray-600 mt-2">${nodes.length} clases y ${edges.length} relaciones.</p></div>`,
        confirmButtonText: 'Abrir la lista'
      });
    } catch (error) {
      console.error("Error creando tablero desde XMI:", error);
      Swal.fire({ icon: "error", title: "No se pudo crear el tablero", text: mensajeDeError(error, "Intenta de nuevo en unos segundos.") });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header con título y botones principales */}
        <div className="header-container">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Mis Tableros
          </h1>

          <div className="flex items-center gap-3">
            {/* Botón importar XML */}
            <label
              htmlFor="fileInput"
              data-tour="importar-xml"
              className="btn-success cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Importar XMI / EAP
            </label>
            <input
              type="file"
              id="fileInput"
              accept=".xmi,.xml,.eap"
              onChange={handleXmlUpload}
              className="hidden"
            />

            {/* Botón nuevo tablero */}
            <button
              onClick={() => setModalIsOpen(true)}
              data-tour="nuevo-tablero"
              className="btn-primary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M12 4v16m8-8H4" />
              </svg>
              Nuevo Tablero
            </button>
          </div>
        </div>

        {/* Contenedor principal de la lista de tableros */}
        <div className="card-container">
          <BoardList
            boards={boardList}
            user={user}
            onInvite={(id) => {
              setCurrentBoardId(id);
              setInviteModalIsOpen(true);
            }}
            onEdit={(board) => {
              setDescription(board.description);
              setCurrentBoardId(board.id);
              setEditModalIsOpen(true);
            }}
            onDelete={handleDeleteBoard}
          />
        </div>

        {/* Modales */}
        <BoardModals
          modalStates={{ modalIsOpen, editModalIsOpen, inviteModalIsOpen }}
          modalActions={{
            closeModal: () => setModalIsOpen(false),
            closeEditModal: () => setEditModalIsOpen(false),
            closeInviteModal: () => setInviteModalIsOpen(false)
          }}
          description={description}
          setDescription={setDescription}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          handleSubmit={handleSubmit}
          handleEditSubmit={handleEditSubmit}
          handleInviteUser={handleInviteUser}
          handleCopyLink={handleCopyLink}
          currentBoardId={currentBoardId}
        />

        <Tour
          pasos={TOUR_TABLEROS}
          abierto={tourAbierto}
          onCerrar={() => { setTourAbierto(false); marcarTourVisto('tableros'); }}
        />
        <BotonAyuda onRelanzarTour={() => setTourAbierto(true)} />
      </div>
    </div>
  );
};

export default Board;