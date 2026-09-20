import { ArrowRightIcon } from '@heroicons/react/20/solid';
import React from 'react';
import { Link } from 'react-router-dom';

const HomePage = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-blue-100">
      <div className="card-container text-center max-w-xl">
        <h1 className="text-4xl font-bold mb-4 text-gray-800">
          Diagramador de Clase UML
        </h1>
        <p className="mb-8 text-lg text-gray-700">
          Crea y gestiona tus diagramas de clases UML.
        </p>

        <Link 
          to="/board"
          className="btn-primary bg-gradient-to-r from-purple-600 to-indigo-600 shadow-lg inline-flex items-center gap-2 px-6 py-3 text-lg font-semibold"
        >
          Iniciar
          <ArrowRightIcon className="h-6 w-6" />
        </Link>
      </div>
    </div>
  );
};

export default HomePage;
