/* Configuración de la bandeja. Los tres valores salen de `sam deploy`:
 * DominioDeLogin, ClienteDeLogin y UrlDeLaBandeja. */
window.BANDEJA_CONFIG = {
    API: "https://494soi0jdj.execute-api.us-east-1.amazonaws.com/v1/admin/hojas",             // .../v1/admin/hojas
    LOGIN: "https://libro-reclamaciones-p1-773672342094.auth.us-east-1.amazoncognito.com",           // https://<dominio>.auth.<region>.amazoncognito.com
    CLIENTE: "1u8mfcm7p6jebvsmksodsal0tt",         // ID del cliente de Cognito
    REDIRECCION: window.location.origin + "/libro-de-reclamaciones/bandeja/",
    // "PRUEBA" o "PRODUCCION", igual que en el config.js del formulario y que el
    // parámetro `Modo` del despliegue. Aquí solo decide si se ofrece el filtro
    // de hojas de prueba: purgadas y en producción, ese filtro no puede devolver
    // nada nunca más, y un filtro que siempre sale vacío hace dudar de si falla.
    MODO: "PRUEBA"
};
