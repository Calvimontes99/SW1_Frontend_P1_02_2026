import { useEffect, useState } from 'react';
import Swal from 'sweetalert2';

/**
 * Botón "Instalar app".
 *
 * Chrome y Edge avisan con el evento beforeinstallprompt cuando la aplicación se puede
 * instalar; entonces el botón abre el diálogo del navegador. Si el evento no llega (Safari,
 * Firefox, o porque ya se descartó antes), el botón explica cómo instalarla a mano, para que
 * la opción siempre esté a la vista. Instalada, la app abre en su propia ventana y funciona
 * sin internet con los modelos de IA ya descargados.
 */
export default function BotonInstalar({ compacto = false }) {
  const [evento, setEvento] = useState(null);
  const [instalada, setInstalada] = useState(false);

  useEffect(() => {
    const yaInstalada = () => window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
    setInstalada(yaInstalada());
    const alPoderInstalar = (e) => {
      e.preventDefault(); // el navegador mostraría su propio aviso; se usa nuestro botón
      setEvento(e);
    };
    const alInstalar = () => { setInstalada(true); setEvento(null); };
    window.addEventListener('beforeinstallprompt', alPoderInstalar);
    window.addEventListener('appinstalled', alInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', alPoderInstalar);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);

  if (instalada) return null;

  const instalar = async () => {
    if (evento) {
      evento.prompt();
      const { outcome } = await evento.userChoice;
      if (outcome === 'accepted') setInstalada(true);
      setEvento(null);
      return;
    }
    const enIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    Swal.fire({
      icon: 'info',
      title: 'Instalar la aplicación',
      html: enIOS
        ? '<div class="text-left text-sm">En iPhone o iPad, desde Safari:<ol class="list-decimal pl-5 mt-2 space-y-1">'
          + '<li>Pulsa el botón <strong>Compartir</strong>.</li>'
          + '<li>Elige <strong>Añadir a pantalla de inicio</strong>.</li></ol></div>'
        : '<div class="text-left text-sm">Desde Chrome o Edge:<ol class="list-decimal pl-5 mt-2 space-y-1">'
          + '<li>Abre el menú del navegador (⋮ o …).</li>'
          + '<li>Elige <strong>Instalar</strong> o <strong>Aplicaciones → Instalar esta página</strong>.</li></ol>'
          + '<p class="mt-2 text-gray-600">También aparece un icono de instalación al final de la barra de direcciones. '
          + 'Instalada, la app abre en su propia ventana y funciona sin internet.</p></div>',
      confirmButtonText: 'Entendido',
    });
  };

  return (
    <button
      type="button"
      onClick={instalar}
      title="Instalar la aplicación en este equipo"
      className={compacto
        ? 'w-full text-left block nav-link-modern'
        : 'nav-link-modern flex items-center gap-1'}
    >
      <span aria-hidden="true">⬇️</span> Instalar app
    </button>
  );
}
