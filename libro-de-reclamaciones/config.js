/* Configuración del Libro de Reclamaciones.
 *
 * Vive en su propio archivo a propósito: poner el libro en marcha es cambiar
 * dos líneas, sin tocar el formulario ni arriesgarse a romperlo.
 *
 * ENDPOINT  la URL que devuelve `sam deploy` como `UrlDelEndpoint`.
 *           Mientras esté vacío la página lo dice con todas sus letras y ofrece
 *           el correo de soporte. Lo que nunca hace es inventar un número.
 *
 * MODO      "PRUEBA" o "PRODUCCION". Debe coincidir con el parámetro `Modo` del
 *           despliegue. Sirve para avisar ANTES de enviar; quien manda de verdad
 *           es el servidor, y la constancia muestra el modo que él devuelve, así
 *           que si los dos se desalinean se nota en pantalla en vez de en
 *           silencio.
 */
window.LIBRO_CONFIG = {
    ENDPOINT: "https://494soi0jdj.execute-api.us-east-1.amazonaws.com/v1/hojas",
    MODO: "PRUEBA",
    CORREO_SOPORTE: "soporte@aonnix.com"
};
