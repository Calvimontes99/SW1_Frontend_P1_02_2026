import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { leerJSON, errorDeRespuesta, mensajeDeError } from '../utils/mensajesError';
// Use backend register endpoint instead of Firebase

const RegisterPage = () => {
  const [user, setUser] = useState('');
  const [correo, setCorreo] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${import.meta.env.VITE_WS_URL || window.location.origin}/apis/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: user, email: correo, password: pass })
      });
      const data = await leerJSON(res);
      if (!res.ok) {
        console.warn('Register failed response:', data);
        throw errorDeRespuesta(res, data, 'No se pudo crear la cuenta.');
      }
      const token = data?.token || data?.data?.token;
      if (token) localStorage.setItem('token', token);
      // La barra superior se actualiza con los datos del perfil
      window.dispatchEvent(new Event('sesion-cambiada'));
      navigate('/');
    } catch (error) {
      console.error("Registration error:", error);
      setError(mensajeDeError(error, 'No se pudo crear la cuenta. Intenta de nuevo.'));
    }
  };

  return (
    <>
      <div className="text-center mt-24">
        <div className="flex items-center justify-center">
          <svg fill="none" viewBox="0 0 24 24" className="w-12 h-12 text-blue-500" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-4xl tracking-tight">Registrarse</h2>
        <span className="text-sm">o <Link to="/login" className="text-green-500">Iniciar sesión</Link></span>
    </div>

      <div className="flex justify-center my-2 mx-4 md:mx-0">
        <form onSubmit={handleRegister} className="w-full max-w-xl bg-white rounded-lg p-6">
          <div className="flex flex-wrap -mx-3 mb-6">
            <div className="w-full px-3 mb-6">
              <label className="block uppercase tracking-wide text-gray-700 text-xs font-bold mb-2">Nombre Completo</label>
              <input id="fullname" name="fullname" autoComplete="name" className="appearance-none block w-full bg-white text-gray-900 font-medium border border-gray-400 rounded-lg py-3 px-3 leading-tight focus:outline-none" type="text" required value={user} onChange={(e) => setUser(e.target.value)} />
            </div>
            <div className="w-full px-3 mb-6">
              <label className="block uppercase tracking-wide text-gray-700 text-xs font-bold mb-2">Correo Electrónico</label>
              <input id="email" name="email" autoComplete="email" className="appearance-none block w-full bg-white text-gray-900 font-medium border border-gray-400 rounded-lg py-3 px-3 leading-tight focus:outline-none" type="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
            </div>
            <div className="w-full px-3 mb-6">
              <label className="block uppercase tracking-wide text-gray-700 text-xs font-bold mb-2">Contraseña</label>
              <input id="password" name="password" autoComplete="new-password" className="appearance-none block w-full bg-white text-gray-900 font-medium border border-gray-400 rounded-lg py-3 px-3 leading-tight focus:outline-none" type="password" required value={pass} onChange={(e) => setPass(e.target.value)} />
            </div>

            {/* Mostrar mensaje de error si ocurre */}
            {error && <p className="text-red-500 text-xs italic">{error}</p>}

            <div className="w-full px-3 mb-6">
              <button className="appearance-none block w-full bg-blue-600 text-gray-100 font-bold border border-gray-200 rounded-lg py-3 px-3 leading-tight hover:bg-blue-500 focus:outline-none">Registrarse</button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
};

export default RegisterPage;
