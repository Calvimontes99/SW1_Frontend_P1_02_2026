import { useState, useEffect } from 'react';

const useTheme = () => {
  // Obtener tema inicial desde localStorage o usar 'light' por defecto
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  });

  // Aplicar el tema al documento
  useEffect(() => {
    const theme = isDark ? 'dark' : 'light';
    
    // Agregar clase de animación temporal
    document.documentElement.classList.add('theme-changing');
    
    // Aplicar el atributo data-theme
    document.documentElement.setAttribute('data-theme', theme);
    
    // Guardar en localStorage
    localStorage.setItem('theme', theme);
    
    // Remover clase de animación después de la transición
    const timer = setTimeout(() => {
      document.documentElement.classList.remove('theme-changing');
    }, 300);

    return () => clearTimeout(timer);
  }, [isDark]);

  // Función para alternar tema
  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  // Función para establecer tema específico
  const setTheme = (theme) => {
    setIsDark(theme === 'dark');
  };

  return {
    isDark,
    theme: isDark ? 'dark' : 'light',
    toggleTheme,
    setTheme
  };
};

export default useTheme;