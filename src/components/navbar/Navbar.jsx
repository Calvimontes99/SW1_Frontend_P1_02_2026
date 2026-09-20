import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
// Use backend session endpoints instead of Firebase Auth
import ThemeToggle from "../ThemeToggle";
import BotonInstalar from "../BotonInstalar";
import useTheme from "../../hooks/useTheme";

const NavBar = () => {
  const [user, setUser] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();

  // Consulta quién tiene la sesión abierta. Se repite al cambiar de página y cuando alguien
  // inicia o cierra sesión (evento "sesion-cambiada"), para que la barra no quede desactualizada.
  useEffect(() => {
    let vigente = true;
    const consultarSesion = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_WS_URL || window.location.origin}/apis`, { credentials: 'include' });
        if (!vigente) return;
        if (!res.ok) return setUser(null);
        const cuerpo = await res.json();
        // El servidor responde { error, data: { id, name, email } }
        const perfil = cuerpo?.data || cuerpo;
        setUser(perfil?.id ? { id: perfil.id, name: perfil.name, email: perfil.email } : null);
      } catch (err) {
        if (vigente) setUser(null);
      }
    };
    consultarSesion();
    window.addEventListener('sesion-cambiada', consultarSesion);
    return () => {
      vigente = false;
      window.removeEventListener('sesion-cambiada', consultarSesion);
    };
  }, [location.pathname]);

  const iniciales = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  const handleLogout = async () => {
    try {
      await fetch(`${import.meta.env.VITE_WS_URL || window.location.origin}/apis/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      localStorage.removeItem('token');
      setUser(null);
      window.dispatchEvent(new Event('sesion-cambiada'));
      navigate("/login");
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <>
      {/* Navbar principal con nueva paleta tecnológica */}
      <nav style={{background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))'}} className="shadow-lg">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between h-16">
            {/* Brand / Logo */}
            <div className="flex items-center">
              <Link to="/" className="flex items-center">
                <span className="text-2xl font-bold tracking-wide" style={{color: 'var(--color-neutral-light)'}}>
                  Diagramador UML
                </span>
              </Link>
            </div>

            {/* Menú de escritorio */}
            <div className="hidden md:flex items-center space-x-4">
              <Link
                to="/"
                className="nav-link-modern"
              >
                Inicio
              </Link>
              {user && (
                <Link
                  to="/board"
                  className="nav-link-modern"
                >
                  Mis Diagramas
                </Link>
              )}
              
              <BotonInstalar />

              {/* Toggle de tema */}
              <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
              
              {user ? (
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2" title={user.email || ''}>
                    <span
                      className="flex items-center justify-center h-9 w-9 rounded-full font-bold"
                      style={{ background: 'var(--color-neutral-light)', color: 'var(--color-primary)' }}
                    >
                      {iniciales}
                    </span>
                    <span className="flex flex-col leading-tight" style={{ color: 'var(--color-neutral-light)' }}>
                      <span className="font-semibold">{user.name || 'Mi cuenta'}</span>
                      {user.email && <span className="text-xs opacity-80">{user.email}</span>}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="btn-danger-modern"
                  >
                    Cerrar Sesión
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="btn-login-modern"
                >
                  Iniciar Sesión
                </Link>
              )}
            </div>

            {/* Botón móvil (hamburguesa) */}
            <div className="md:hidden flex items-center">
              <button
                onClick={toggleMenu}
                className="inline-flex items-center justify-center p-2 rounded-md hover:bg-white/10" 
                style={{color: 'var(--color-neutral-light)'}}
              >
                {/* Icono hamburguesa */}
                <svg
                  className={`h-6 w-6 ${isMenuOpen ? "hidden" : "block"}`}
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
                {/* Icono cerrar (X) */}
                <svg
                  className={`h-6 w-6 ${isMenuOpen ? "block" : "hidden"}`}
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Menú móvil */}
        <div className={`md:hidden ${isMenuOpen ? "block" : "hidden"}`} style={{background: 'rgba(var(--color-primary-rgb), 0.9)'}}>
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            <Link
              to="/"
              className="block nav-link-modern"
              onClick={() => setIsMenuOpen(false)}
            >
              Inicio
            </Link>
            {user && (
              <Link
                to="/board"
                className="block nav-link-modern"
                onClick={() => setIsMenuOpen(false)}
              >
                Mis Diagramas
              </Link>
            )}
            <BotonInstalar compacto />
            {user ? (
              <>
                <div className="flex items-center space-x-2 px-3 py-2" style={{ color: 'var(--color-neutral-light)' }}>
                  <span
                    className="flex items-center justify-center h-9 w-9 rounded-full font-bold"
                    style={{ background: 'var(--color-neutral-light)', color: 'var(--color-primary)' }}
                  >
                    {iniciales}
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold">{user.name || 'Mi cuenta'}</span>
                    {user.email && <span className="text-xs opacity-80">{user.email}</span>}
                  </span>
                </div>
                <button
                  onClick={() => {
                    handleLogout();
                    setIsMenuOpen(false);
                  }}
                  className="w-full text-left block btn-danger-modern"
                >
                  Cerrar Sesión
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="block btn-login-modern"
                onClick={() => setIsMenuOpen(false)}
              >
                Iniciar Sesión
              </Link>
            )}
          </div>
        </div>
      </nav>
    </>
  );
};

export default NavBar;
